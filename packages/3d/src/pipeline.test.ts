import { track } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { camera3D } from "./camera3d";
import { cube3D, prism3D } from "./primitives/prism3d";
import { sphere3D } from "./primitives/sphere3d";
import { mount } from "./test/scene";

describe("the 3D pipeline", () => {
	it("draws a cube's three visible faces, and nothing outside a camera throws", () => {
		const scene = mount(
			camera3D.create({ children: [cube3D.create({ size: 2, fill: "#f00" })] }),
		);
		expect(scene.shapes()).toHaveLength(3);
		for (const spec of scene.shapes()) {
			expect(spec.polylines[0]).toHaveLength(5);
			expect(spec.zIndex).toBeLessThan(0);
		}
	});

	it("throws for a 3D shape outside a camera", () => {
		expect(() => mount(cube3D.create({}))).toThrow(/camera3D/);
	});

	it("a camera move re-projects without rebuilding world geometry", () => {
		const eye = track({ x: 6, y: 4, z: 8 });
		const cube = cube3D.create({ size: 2 });
		const scene = mount(camera3D.create({ eye, children: [cube] }));
		const world = cube.world;
		const before = scene.shapes().map((s) => s.polylines[0]);
		eye.set({ x: -6, y: 4, z: 8 });
		scene.commit();
		expect(cube.world).toBe(world);
		const after = scene.shapes().map((s) => s.polylines[0]);
		expect(after).not.toEqual(before);
	});

	it("orders faces of separate solids by depth, whatever the declaration order", () => {
		const near = sphere3D.create({
			center: { x: 0, y: 0, z: 3 },
			radius: 0.5,
			fill: "#0f0",
		});
		const far = prism3D.create({
			center: { x: 0, y: 0, z: -3 },
			width: 4,
			height: 4,
			depth: 0.2,
			fill: "#00f",
		});
		mount(
			camera3D.create({ eye: { x: 0, y: 0, z: 10 }, children: [near, far] }),
		);
		const sphereSpec = near.children[0] as unknown as {
			spec: { zIndex: number };
		};
		const slabZ = far.children.map(
			(c) => (c as unknown as { spec: { zIndex: number } }).spec.zIndex,
		);
		for (const z of slabZ) expect(sphereSpec.spec.zIndex).toBeGreaterThan(z);
	});

	it("moving one primitive leaves the other's specs untouched", () => {
		const center = track({ x: 2, y: 0, z: 0 });
		const ball = sphere3D.create({ center, radius: 0.5 });
		const cube = cube3D.create({ center: { x: -2, y: 0, z: 0 } });
		const scene = mount(camera3D.create({ children: [ball, cube] }));
		const cubeSpecs = cube.children.map(
			(c) => (c as unknown as { spec: object }).spec,
		);
		center.set({ x: 2, y: 1, z: 0 });
		scene.commit();
		const after = cube.children.map(
			(c) => (c as unknown as { spec: object }).spec,
		);
		expect(after).toEqual(cubeSpecs);
		for (let i = 0; i < after.length; i++) expect(after[i]).toBe(cubeSpecs[i]);
	});

	it("an explicit zIndex opts a solid out of the sort", () => {
		const cube = cube3D.create({ zIndex: 5 });
		const scene = mount(camera3D.create({ children: [cube] }));
		for (const spec of scene.shapes()) expect(spec.zIndex).toBe(5);
	});
});
