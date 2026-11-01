/**
 * Tests for the camera-wide depth sort (`depth-sort.ts`): the pure ordering
 * on hand-built pieces, and the paint order real primitives end up with
 * under a `camera3D`, in cases a per-piece centroid order gets wrong.
 */

import type { SceneNode } from "@sophistry/core";
import { track } from "@sophistry/core";
import type { Point3, ShapeSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { camera3D } from "./camera3d.js";
import type { DepthItem } from "./depth-sort.js";
import { sortByDepth } from "./depth-sort.js";
import { meshFaces } from "./mesh.js";
import { cube3D, prism3D } from "./primitives/prism3d.js";
import { sphere3D } from "./primitives/sphere3d.js";
import { mount } from "./test/scene.js";

/**
 * Mounts `children` under a camera at `eye` looking at `target` and returns
 * the frame's shape specs in paint order.
 */
function paint(
	eye: Point3,
	children: SceneNode[],
	target: Point3 = { x: 0, y: 0, z: 0 },
): ShapeSpec[] {
	return mount(camera3D.create({ eye, target, children })).shapes();
}

/** Paint-order positions of the specs stroked `stroke`. */
function positions(frame: readonly ShapeSpec[], stroke: string): number[] {
	const out: number[] = [];
	frame.forEach((spec, i) => {
		if (spec.style.stroke === stroke) out.push(i);
	});
	return out;
}

/** A square face, wound counter-clockwise seen from `+normal`. */
function quad(points: Point3[]): { points: Point3[] } {
	return { points };
}

/** The current spec of each of a 3D primitive's pieces. */
function pieceSpecs(node: { children: readonly SceneNode[] }): object[] {
	return (node.children as unknown as { spec: object }[]).map(
		(child) => child.spec,
	);
}

describe("sortByDepth", () => {
	const disc = (depth: number): DepthItem => ({
		world: [{ x: 0, y: 0, z: -depth }],
		screen: [{ x: 0, y: 0, depth }],
		radius: 0.5,
		screenRadius: 1,
	});

	it("paints the farther of two overlapping discs first, whatever the input order", () => {
		const eye = { x: 0, y: 0, z: 0 };
		const z = sortByDepth([disc(2), disc(5)], eye);
		expect(z[1]).toBeLessThan(z[0]);
		const swapped = sortByDepth([disc(5), disc(2)], eye);
		expect(swapped[0]).toBeLessThan(swapped[1]);
	});

	it("bounds the sweep over a column of pieces that overlap on x alone", () => {
		// 3000 discs stacked on y: every pair overlaps on x and none on y, so
		// no pair counts towards `MAX_DEPTH_PAIRS` and the sweep visited all
		// 4.5M of them. The visit cap ends it early, in centroid order: the
		// order the whole sweep would have reached.
		const column = Array.from({ length: 3000 }, (_, i) => ({
			...disc(i + 1),
			screen: [{ x: 0, y: i * 3, depth: i + 1 }],
		}));
		const z = sortByDepth(column, { x: 0, y: 0, z: 0 });
		for (let i = 1; i < column.length; i++) expect(z[i]).toBeLessThan(z[i - 1]);
	});

	it("keeps the centroid order (and its -depth values) when nothing overlaps", () => {
		const a: DepthItem = { ...disc(3), screen: [{ x: -5, y: 0, depth: 3 }] };
		const b: DepthItem = { ...disc(4), screen: [{ x: 5, y: 0, depth: 4 }] };
		const z = sortByDepth([a, b], { x: 0, y: 0, z: 0 });
		expect(z[0]).toBe(-3);
		expect(z[1]).toBe(-4);
	});

	it("puts a piece below a plane behind it, even with a nearer centroid", () => {
		// Eye at the origin looking down -z. A floor at y = -1 from z = -2 to
		// z = -10 (centroid depth 6) and a small post below it at depth 4.
		const eye = { x: 0, y: 0, z: 0 };
		const project = (p: Point3) => ({
			x: p.x / -p.z,
			y: p.y / -p.z,
			depth: -p.z,
		});
		const floorWorld = [
			{ x: -3, y: -1, z: -2 },
			{ x: 3, y: -1, z: -2 },
			{ x: 3, y: -1, z: -10 },
			{ x: -3, y: -1, z: -10 },
		];
		const postWorld = [
			{ x: -0.5, y: -2, z: -4 },
			{ x: 0.5, y: -2, z: -4 },
			{ x: 0.5, y: -1.5, z: -4 },
			{ x: -0.5, y: -1.5, z: -4 },
		];
		const floor: DepthItem = {
			world: floorWorld,
			screen: floorWorld.map(project),
			normal: { x: 0, y: 1, z: 0 },
		};
		const post: DepthItem = {
			world: postWorld,
			screen: postWorld.map(project),
			normal: { x: 0, y: 0, z: 1 },
		};
		const z = sortByDepth([floor, post], eye);
		expect(z[1]).toBeLessThan(z[0]);
	});

	it("gives coincident pieces distinct z, so the renderer's tie-break can't reorder them", () => {
		const z = sortByDepth([disc(2), disc(2), disc(2)], { x: 0, y: 0, z: 0 });
		expect(z[0]).toBeLessThan(z[1]);
		expect(z[1]).toBeLessThan(z[2]);
	});
});

describe("depth order across primitives under one camera3D", () => {
	it("two cubes: the far one paints first even when declared last", () => {
		const frame = paint({ x: 0, y: 2, z: 8 }, [
			cube3D.create({
				center: { x: 0, y: 0, z: 0 },
				size: 1,
				stroke: "#000001",
			}),
			cube3D.create({
				center: { x: 0.3, y: 0.3, z: -3 },
				size: 1,
				stroke: "#000002",
			}),
		]);
		const near = positions(frame, "#000001");
		const far = positions(frame, "#000002");
		expect(near.length).toBeGreaterThan(0);
		expect(far.length).toBeGreaterThan(0);
		expect(Math.max(...far)).toBeLessThan(Math.min(...near));
	});

	it("a cube standing at the back of a floor slab paints after the slab's top", () => {
		// The slab's top face has its centroid at the origin, nearer than the
		// cube's: a centroid order would paint the slab over the cube.
		const frame = paint({ x: 0, y: 4, z: 10 }, [
			cube3D.create({
				center: { x: 0, y: 0.5, z: -3.4 },
				size: 1,
				stroke: "#000001",
			}),
			prism3D.create({
				center: { x: 0, y: -0.1, z: 0 },
				width: 8,
				height: 0.2,
				depth: 8,
				stroke: "#000002",
			}),
		]);
		const cube = positions(frame, "#000001");
		const slab = positions(frame, "#000002");
		expect(cube.length).toBeGreaterThan(0);
		// Only overlapping faces are ordered: the cube's front face overlaps
		// the slab's top on screen (the cube's top sits above the slab's far
		// edge, the slab's front below the cube), and must paint after it.
		const ys = (i: number) => frame[i].polylines[0].map((p) => p.y);
		const front = cube.reduce((a, b) =>
			Math.min(...ys(a)) < Math.min(...ys(b)) ? a : b,
		);
		const top = slab.reduce((a, b) =>
			Math.max(...ys(a)) > Math.max(...ys(b)) ? a : b,
		);
		expect(front).toBeGreaterThan(top);
	});

	it("a concave mesh hides its own face that lies behind another", () => {
		// One mesh: a floor at y = -1 and a small face below it, facing the
		// eye. Both are front-facing; the small one's centroid is nearer.
		const frame = paint(
			{ x: 0, y: 0, z: 0 },
			[
				meshFaces.create({
					faces: [
						quad([
							{ x: -3, y: -1, z: -10 },
							{ x: -3, y: -1, z: -2 },
							{ x: 3, y: -1, z: -2 },
							{ x: 3, y: -1, z: -10 },
						]),
						quad([
							{ x: -0.5, y: -2, z: -4 },
							{ x: 0.5, y: -2, z: -4 },
							{ x: 0.5, y: -1.5, z: -4 },
							{ x: -0.5, y: -1.5, z: -4 },
						]),
					],
				}),
			],
			{ x: 0, y: 0, z: -1 },
		);
		expect(frame).toHaveLength(2);
		// The floor is the face spanning more of the screen; it paints last.
		const height = (spec: ShapeSpec) => {
			const ys = spec.polylines[0].map((p) => p.y);
			return Math.max(...ys) - Math.min(...ys);
		};
		expect(height(frame[1])).toBeGreaterThan(height(frame[0]));
	});

	it("a sphere in front of a wall paints after every face of it", () => {
		const frame = paint({ x: 0, y: 1, z: 8 }, [
			sphere3D.create({
				center: { x: 0, y: 0, z: 1 },
				radius: 0.5,
				stroke: "#000001",
			}),
			prism3D.create({
				center: { x: 0, y: 0, z: -1 },
				width: 4,
				height: 3,
				depth: 0.2,
				stroke: "#000002",
			}),
		]);
		const [sphere] = positions(frame, "#000001");
		const wall = positions(frame, "#000002");
		expect(wall.length).toBeGreaterThan(0);
		expect(sphere).toBeGreaterThan(Math.max(...wall));
	});

	it("an explicit zIndex opts a solid out of the sort", () => {
		const frame = paint({ x: 4, y: 3, z: 5 }, [
			cube3D.create({ size: 1, zIndex: 5 }),
			prism3D.create({ center: { x: 2, y: 0, z: 0 }, height: 2, zIndex: 7 }),
		]);
		const zs = frame.map((s) => s.zIndex);
		expect(zs.length).toBeGreaterThan(0);
		expect(zs.every((z) => z === 5 || z === 7)).toBe(true);
		expect(zs).toContain(5);
		expect(zs).toContain(7);
	});
});

describe("depth order fan-out", () => {
	it("moving one primitive re-runs only its own pieces, not every 3D spec", () => {
		const lifted = track<Point3>({ x: -4, y: 0, z: 0 });
		// Far apart on screen, so nudging one never reorders the others.
		const moved = prism3D.create({ center: lifted, width: 0.5 });
		const others = [0, 4].map((x, i) =>
			prism3D.create({ center: { x, y: 0, z: -1 - i }, width: 0.5 }),
		);
		const scene = mount(
			camera3D.create({
				eye: { x: 0, y: 0, z: 10 },
				children: [moved, ...others],
			}),
		);
		const movedBefore = pieceSpecs(moved);
		const othersBefore = others.map(pieceSpecs);
		lifted.set({ x: -4, y: 0.5, z: 0 });
		scene.commit();
		// The others' slices of the sort came out unchanged, so their specs are
		// the same objects as before; the moved one's are new.
		others.forEach((node, i) => {
			const after = pieceSpecs(node);
			expect(after).toHaveLength(othersBefore[i].length);
			for (let k = 0; k < after.length; k++) {
				expect(after[k]).toBe(othersBefore[i][k]);
			}
		});
		const movedAfter = pieceSpecs(moved);
		expect(movedAfter.length).toBeGreaterThan(0);
		for (const spec of movedAfter) expect(movedBefore).not.toContain(spec);
	});
});
