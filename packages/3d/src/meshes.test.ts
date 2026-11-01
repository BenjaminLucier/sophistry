/**
 * Tests for the scene side of the 3D primitives: not pixel output, but the
 * structural claims the 3D layer turns on.
 *
 *  1. Every 3D primitive, whether a mesh (`cube3D`) or a single projected
 *     disc (`sphere3D`), ends up as ordinary shape specs in the same frame a
 *     2D `circle` paints into: the "shared registration path" claim.
 *  2. A 3D primitive that asks for interaction (`onTap`, here) makes its
 *     pieces focusable, hit-testable interaction records; the 3D node itself
 *     never has one.
 *  3. `center` is the middle of the bounding solid for cones and cylinders.
 */

import type { SceneNode } from "@sophistry/core";
import { createInteractionRegistry } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { camera3D } from "./camera3d.js";
import { cone3D } from "./primitives/cone3d.js";
import { cylinder3D } from "./primitives/cylinder3d.js";
import { cube3D } from "./primitives/prism3d.js";
import { sphere3D } from "./primitives/sphere3d.js";
import { mount } from "./test/scene.js";

/** Mounts `solid` under a camera at a default eye. */
function mountSolid(solid: SceneNode) {
	return mount(
		camera3D.create({ eye: { x: 4, y: 3, z: 5 }, children: [solid] }),
	);
}

describe("3D primitive centres are the middle of the bounding solid", () => {
	function verticalExtent(solid: SceneNode): [number, number] {
		const scene = mount(
			camera3D.create({ eye: { x: 50, y: 0, z: 0 }, children: [solid] }),
		);
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		for (const spec of scene.shapes()) {
			for (const line of spec.polylines) {
				for (const p of line) {
					low = Math.min(low, p.y);
					high = Math.max(high, p.y);
				}
			}
		}
		return [low, high];
	}

	it("cone3D spans center +- height / 2 along its axis, like cylinder3D", () => {
		const cone = verticalExtent(cone3D.create({ height: 2, radius: 0.5 }));
		const cylinder = verticalExtent(
			cylinder3D.create({ height: 2, radius: 0.5 }),
		);
		expect(cone[0] + cone[1]).toBeCloseTo(0, 1);
		expect(cone[1] - cone[0]).toBeCloseTo(cylinder[1] - cylinder[0], 1);
	});

	it.each(["x", "y", "z"] as const)(
		"cone3D and cylinder3D along %s keep their world extent centred on center",
		(axis) => {
			const center = { x: 1, y: -2, z: 0.5 };
			for (const solid of [
				cone3D.create({ center, axis, height: 2 }),
				cylinder3D.create({ center, axis, height: 2 }),
			]) {
				mountSolid(solid);
				const points = solid.world.flatMap((face) => face.points);
				const along = points.map((p) => p[axis] - center[axis]);
				expect(Math.min(...along)).toBeCloseTo(-1, 12);
				expect(Math.max(...along)).toBeCloseTo(1, 12);
			}
		},
	);
});

describe("3D primitives share the 2D registration path", () => {
	it("a mesh solid (cube3D) becomes visible shape specs", () => {
		const scene = mountSolid(
			cube3D.create({ center: { x: 0, y: 0, z: 0 }, size: 1 }),
		);
		// A cube facing a default eye shows some subset of its 6 faces (the far
		// 3 are backface-culled): at least one visible face, each a real shape
		// spec with drawable polylines, is the claim.
		const specs = scene.shapes();
		expect(specs.length).toBeGreaterThan(0);
		expect(specs.length).toBeLessThan(6);
		for (const spec of specs) {
			expect(spec.kind).toBe("shape");
			expect(spec.polylines.length).toBeGreaterThan(0);
		}
	});

	it("a sphere3D becomes one shape spec", () => {
		const scene = mountSolid(
			sphere3D.create({ center: { x: 0, y: 0, z: 0 }, radius: 1 }),
		);
		const specs = scene.shapes();
		expect(specs).toHaveLength(1);
		expect(specs[0].kind).toBe("shape");
	});
});

describe("3D primitives become hit-testable and focusable through Shape3DProps", () => {
	it("a sphere3D with onTap gives its disc a focusable interaction record", () => {
		const sphere = sphere3D.create({
			center: { x: 0, y: 0, z: 0 },
			radius: 1,
			onTap: () => {},
		});
		const scene = mountSolid(sphere);
		expect(scene.graph.interactive.size).toBe(1);
		expect(scene.graph.interactive.has(sphere)).toBe(false);
		const registry = createInteractionRegistry(scene.graph);
		expect(registry.records()).toHaveLength(1);
		expect(registry.focusable()).toHaveLength(1);
		registry.dispose();
	});

	it("a plain sphere3D with no interaction props has no record", () => {
		const scene = mountSolid(
			sphere3D.create({ center: { x: 0, y: 0, z: 0 }, radius: 1 }),
		);
		expect(scene.graph.interactive.size).toBe(0);
	});

	it("a cube3D with onTap gives a focusable record to every visible face", () => {
		const cube = cube3D.create({
			center: { x: 0, y: 0, z: 0 },
			size: 1,
			onTap: () => {},
		});
		const scene = mountSolid(cube);
		const faces = scene.shapes().length;
		expect(faces).toBeGreaterThan(0);
		expect(scene.graph.interactive.size).toBe(faces);
		expect(scene.graph.interactive.has(cube)).toBe(false);
		const registry = createInteractionRegistry(scene.graph);
		expect(registry.records()).toHaveLength(faces);
		expect(registry.focusable()).toHaveLength(faces);
		registry.dispose();
	});
});
