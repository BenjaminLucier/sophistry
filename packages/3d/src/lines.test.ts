/**
 * Tests for the line-like 3D primitives (`curve3D`, `line3D`, `vector3D`,
 * `grid3D`, `axes3D`) and the claims about them: 3D projects to scene units, independent of the 2D
 * view; the depth sort orders a sphere on a grid; a moved curve re-runs only
 * its own spec.
 */

import { track } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { camera3D } from "./camera3d";
import { axes3D } from "./primitives/axes3d";
import { curve3D } from "./primitives/curve3d";
import { grid3D, gridLineCount } from "./primitives/grid3d";
import { line3D } from "./primitives/line3d";
import { cube3D } from "./primitives/prism3d";
import { highlightPosition, sphere3D } from "./primitives/sphere3d";
import { vector3D } from "./primitives/vector3d";
import { mount } from "./test/scene";

type Shapes = ReturnType<ReturnType<typeof mount>["shapes"]>;

/** Paint-order positions of the specs stroked `stroke`. */
function positions(frame: Shapes, stroke: string): number[] {
	const out: number[] = [];
	frame.forEach((spec, i) => {
		if (spec.style.stroke === stroke) out.push(i);
	});
	return out;
}

/** The horizontal extent of every point in `frame`. */
function extent(frame: Shapes): number {
	const xs = frame.flatMap((spec) =>
		spec.polylines.flat().map((p: { x: number }) => p.x),
	);
	return Math.max(...xs) - Math.min(...xs);
}

describe("Sphere3D highlight", () => {
	it("moves toward the light: default upper-left light puts it upper-left (y up)", () => {
		const h = highlightPosition({ x: 0, y: 0 }, 2, { x: -1, y: 1, z: 1 }, 1);
		expect(h.x).toBeLessThan(0);
		expect(h.y).toBeGreaterThan(0);
	});
});

describe("Vector3D", () => {
	function polylineCount(from: Point3, to: Point3): number {
		const scene = mount(
			camera3D.create({
				eye: { x: 5, y: 3, z: 8 },
				children: [vector3D.create({ from, to })],
			}),
		);
		let count = 0;
		for (const spec of scene.shapes()) count += spec.polylines.length;
		return count;
	}

	it("draws nothing for a zero-length vector", () => {
		const p = { x: 1, y: 1, z: 1 };
		expect(polylineCount(p, { ...p })).toBe(0);
	});

	it("still draws a shaft and head for a real vector", () => {
		expect(polylineCount({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })).toBe(2);
	});

	it("drops the head when the tip is behind the eye", () => {
		const scene = mount(
			camera3D.create({
				eye: { x: 0, y: 0, z: 5 },
				children: [
					vector3D.create({
						from: { x: 0, y: 0, z: 0 },
						to: { x: 0, y: 1, z: 10 },
					}),
				],
			}),
		);
		const [spec] = scene.shapes();
		expect(spec.polylines).toHaveLength(1);
	});
});

describe("Curve3D and Line3D", () => {
	it("splits a curve passing behind the eye into separate polylines", () => {
		// A straight run through the eye's plane and out again: x from -3 to 3
		// at z 5 (the eye's depth plane) bends behind the eye in the middle.
		const scene = mount(
			camera3D.create({
				eye: { x: 0, y: 0, z: 5 },
				children: [
					curve3D.create({
						function: (t) => ({
							x: -3 + 6 * t,
							y: 0,
							z: 2 + 6 * Math.sin(Math.PI * t),
						}),
						samples: 32,
					}),
				],
			}),
		);
		const [spec] = scene.shapes();
		expect(spec.polylines.length).toBe(2);
	});

	it("a camera move re-projects without re-sampling the function", () => {
		let calls = 0;
		const eye = track({ x: 4, y: 3, z: 5 });
		const curve = curve3D.create({
			function: (t) => {
				calls++;
				return { x: t, y: t * t, z: 0 };
			},
			samples: 8,
		});
		const scene = mount(camera3D.create({ eye, children: [curve] }));
		expect(calls).toBe(9);
		const before = scene.shapes()[0].polylines;
		eye.set({ x: -4, y: 3, z: 5 });
		scene.commit();
		expect(calls).toBe(9);
		expect(scene.shapes()[0].polylines).not.toEqual(before);
	});

	it("worldWidth is perspective-scaled; strokeWidth is ignored", () => {
		const width = (z: number) => {
			const scene = mount(
				camera3D.create({
					eye: { x: 0, y: 0, z: 10 },
					children: [
						line3D.create({
							from: { x: -1, y: 0, z },
							to: { x: 1, y: 0, z },
							worldWidth: 0.1,
							strokeWidth: 3,
						}),
					],
				}),
			);
			return scene.shapes()[0].style.strokeWidth;
		};
		expect(width(5)).toBeGreaterThan(width(0));
		expect(width(0)).toBeLessThan(1);
	});

	it("a line is the two-point curve through its ends", () => {
		const from = { x: -1, y: 0.5, z: 0.25 };
		const to = { x: 2, y: 1, z: -1 };
		const lineScene = mount(
			camera3D.create({ children: [line3D.create({ from, to })] }),
		);
		const curveScene = mount(
			camera3D.create({
				children: [
					curve3D.create({
						function: (t) => ({
							x: from.x + (to.x - from.x) * t,
							y: from.y + (to.y - from.y) * t,
							z: from.z + (to.z - from.z) * t,
						}),
						samples: 1,
					}),
				],
			}),
		);
		const withoutId = ({ id: _id, ...spec }: { id: unknown }) => spec;
		expect(lineScene.plainShapes().map(withoutId)).toEqual(
			curveScene.plainShapes().map(withoutId),
		);
	});
});

describe("gridLineCount", () => {
	it("floors so lines never overshoot the extent", () => {
		expect(gridLineCount(5, 2)).toBe(2);
		expect(gridLineCount(5, 1)).toBe(5);
	});

	it("caps the line count and guards bad steps", () => {
		expect(gridLineCount(1e6, 1)).toBe(100);
		expect(gridLineCount(5, 0)).toBe(5);
		expect(gridLineCount(5, -1)).toBe(5);
		expect(gridLineCount(5, Number.NaN)).toBe(5);
		expect(gridLineCount(0.1, 1)).toBe(1);
	});
});

describe("Grid3D", () => {
	it("draws 2 * (2 * count + 1) lines, muted at 0.35 opacity by default", () => {
		const scene = mount(
			camera3D.create({ children: [grid3D.create({ extent: 2, step: 1 })] }),
		);
		const [spec] = scene.shapes();
		expect(spec.polylines).toHaveLength(10);
		expect(spec.style.opacity).toBeCloseTo(0.35, 9);
	});
});

describe("Axes3D", () => {
	it("draws three arrows, their ticks, and labels that follow the camera", () => {
		const eye = track({ x: 6, y: 4, z: 8 });
		const scene = mount(
			camera3D.create({
				eye,
				children: [axes3D.create({ length: 2, ticks: true })],
			}),
		);
		const texts = () => scene.graph.frame.filter((s) => s.kind === "text");
		// Three arrows plus two ticks per axis.
		expect(scene.shapes()).toHaveLength(9);
		// Two tick numbers and a name per axis.
		expect(texts()).toHaveLength(9);
		const before = texts().map((s) => ({ ...s }));
		eye.set({ x: -6, y: 4, z: 8 });
		scene.commit();
		expect(texts().map((s) => ({ ...s }))).not.toEqual(before);
	});

	it("hides a label whose anchor is behind the eye", () => {
		const scene = mount(
			camera3D.create({
				eye: { x: 0, y: 0, z: 3 },
				children: [axes3D.create({ length: 4 })],
			}),
		);
		// The z axis's name sits at z 4.32, behind the eye.
		expect(scene.graph.frame.filter((s) => s.kind === "text")).toHaveLength(2);
	});
});

describe("3D projects to scene units, like every 2D spec", () => {
	it("a solid's bounds are the union of its faces' scene-unit polylines (no pixel conversion)", () => {
		const cube = cube3D.create({ size: 1 });
		const scene = mount(
			camera3D.create({ eye: { x: 4, y: 3, z: 5 }, children: [cube] }),
		);
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const spec of scene.shapes()) {
			for (const line of spec.polylines) {
				for (const p of line) {
					minX = Math.min(minX, p.x);
					maxX = Math.max(maxX, p.x);
					minY = Math.min(minY, p.y);
					maxY = Math.max(maxY, p.y);
				}
			}
		}
		const box = cube.bounds();
		expect(box).toBeTruthy();
		expect(box?.minX).toBeCloseTo(minX, 9);
		expect(box?.maxX).toBeCloseTo(maxX, 9);
		expect(box?.minY).toBeCloseTo(minY, 9);
		expect(box?.maxY).toBeCloseTo(maxY, 9);
		// A unit cube a few units from the eye projects to a few scene units at
		// most, not the hundreds a pixel conversion would give.
		expect(maxX - minX).toBeLessThan(10);
	});
});

describe("3D content is independent of the 2D view", () => {
	/** A camera3D + sphere3D under the harness's drivable visible frame. */
	function mountWithFrame(viewHeight?: number) {
		return mount(
			camera3D.create({
				eye: { x: 4, y: 3, z: 5 },
				viewHeight,
				children: [
					sphere3D.create({ center: { x: 0, y: 0, z: 0 }, radius: 1 }),
				],
			}),
		);
	}

	it("changing the stage's visible frame does not re-project (same spec identity)", () => {
		const scene = mountWithFrame();
		const [before] = scene.shapes();
		expect(before).toBeDefined();
		// A 4.5x zoom of the stage.
		scene.frame.set({ minX: -1.6, minY: -1, maxX: 1.6, maxY: 1 });
		scene.commit();
		expect(scene.shapes()[0]).toBe(before);
	});

	it("an explicit viewHeight sets the projection scale; the default is the mount-time frame height", () => {
		const implicit = mountWithFrame();
		// The default frame is 9 tall.
		const same = mountWithFrame(9);
		const doubled = mountWithFrame(18);
		expect(extent(same.shapes())).toBeCloseTo(extent(implicit.shapes()), 9);
		expect(extent(doubled.shapes())).toBeCloseTo(
			2 * extent(implicit.shapes()),
			9,
		);
	});
});

describe("depth order across primitives under one camera3D", () => {
	it("a sphere resting on a grid paints after the grid", () => {
		const scene = mount(
			camera3D.create({
				eye: { x: 0, y: 3, z: 8 },
				children: [
					sphere3D.create({
						center: { x: 0, y: 0.5, z: -3 },
						radius: 0.5,
						stroke: "#000001",
					}),
					grid3D.create({ extent: 4, step: 1, stroke: "#000002" }),
				],
			}),
		);
		const [sphere] = positions(scene.shapes(), "#000001");
		const [grid] = positions(scene.shapes(), "#000002");
		expect(sphere).toBeGreaterThan(grid);
	});
});

describe("depth order fan-out", () => {
	it("moving one curve re-runs only its own spec, not every 3D spec", () => {
		// Far apart on screen, so nudging one never reorders the others.
		const curves = [-4, 0, 4].map((x, i) =>
			curve3D.create({
				function: (t) => ({ x: x + t, y: 0, z: -i }),
				samples: 4,
			}),
		);
		const scene = mount(
			camera3D.create({ eye: { x: 0, y: 0, z: 10 }, children: curves }),
		);
		const before = scene.shapes();
		curves[0].set("function", (t) => ({ x: -4 + t, y: 0, z: 0.5 }));
		scene.commit();
		const after = scene.shapes();
		// The other two curves' slices of the sort came out unchanged, so their
		// specs are the same objects as before.
		expect(after).toHaveLength(3);
		expect(after.filter((spec) => before.includes(spec))).toHaveLength(2);
	});
});
