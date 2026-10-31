import type { SceneNode } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { camera3D } from "./camera3d";
import { cross3, dot3, subtract3 } from "./mesh-math";
import {
	convexHullFaces,
	orientFaces,
	PLATONIC_SOLIDS,
	polyhedronMeshFaces,
} from "./polyhedra";
import {
	convexHull3D,
	dodecahedron3D,
	icosahedron3D,
	octahedron3D,
	polyhedron3D,
	tetrahedron3D,
} from "./primitives/polyhedron3d";
import { mount } from "./test/scene";

const centroid = (ps: readonly Point3[]): Point3 => ({
	x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
	y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
	z: ps.reduce((s, p) => s + p.z, 0) / ps.length,
});

/** Every face's normal points away from the solid's centre. */
function facesOutward(
	vertices: readonly Point3[],
	faces: readonly (readonly number[])[],
): boolean {
	const centre = centroid(vertices);
	return faces.every((face) => {
		const [a, b, c] = face.map((i) => vertices[i]);
		const normal = cross3(subtract3(b, a), subtract3(c, a));
		return (
			dot3(normal, subtract3(centroid(face.map((i) => vertices[i])), centre)) >
			0
		);
	});
}

function edges(faces: readonly (readonly number[])[]): [number, number][] {
	const set = new Map<string, [number, number]>();
	for (const face of faces)
		face.forEach((i, k) => {
			const j = face[(k + 1) % face.length];
			set.set([i, j].sort((x, y) => x - y).join("-"), [i, j]);
		});
	return [...set.values()];
}

describe("PLATONIC_SOLIDS", () => {
	const expected = {
		tetrahedron: { v: 4, f: 4, sides: 3 },
		cube: { v: 8, f: 6, sides: 4 },
		octahedron: { v: 6, f: 8, sides: 3 },
		icosahedron: { v: 12, f: 20, sides: 3 },
		dodecahedron: { v: 20, f: 12, sides: 5 },
	} as const;

	for (const [name, want] of Object.entries(expected)) {
		const solid = PLATONIC_SOLIDS[name as keyof typeof expected];
		it(`${name}: ${want.f} faces of ${want.sides} sides, unit edges, wound outward`, () => {
			expect(solid.vertices).toHaveLength(want.v);
			expect(solid.faces).toHaveLength(want.f);
			for (const face of solid.faces) expect(face).toHaveLength(want.sides);
			const all = edges(solid.faces);
			// Euler: V − E + F = 2.
			expect(want.v - all.length + want.f).toBe(2);
			for (const [i, j] of all) {
				const d = subtract3(solid.vertices[i], solid.vertices[j]);
				expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
			}
			expect(facesOutward(solid.vertices, solid.faces)).toBe(true);
		});
	}
});

describe("convexHullFaces", () => {
	it("merges coplanar points into one face and ignores points inside", () => {
		const cube = PLATONIC_SOLIDS.cube.vertices;
		const faces = convexHullFaces([...cube, { x: 0, y: 0, z: 0 }]);
		expect(faces).toHaveLength(6);
		for (const face of faces) {
			expect(face).toHaveLength(4);
			expect(face).not.toContain(8);
		}
	});

	it("gives nothing for too few or coplanar points", () => {
		expect(convexHullFaces([{ x: 0, y: 0, z: 0 }])).toEqual([]);
		const flat = [0, 1, 2, 3, 4].map((i) => ({ x: i, y: i * i, z: 0 }));
		expect(convexHullFaces(flat)).toEqual([]);
	});
});

describe("orientFaces and polyhedronMeshFaces", () => {
	it("reverses a face listed inward-facing", () => {
		const { vertices, faces } = PLATONIC_SOLIDS.tetrahedron;
		const flipped = faces.map((face, i) =>
			i % 2 ? [...face].reverse() : face,
		);
		expect(facesOutward(vertices, flipped)).toBe(false);
		expect(facesOutward(vertices, orientFaces(vertices, flipped))).toBe(true);
	});

	it("scales then moves", () => {
		const [face] = polyhedronMeshFaces(
			[
				{ x: 1, y: 0, z: 0 },
				{ x: 0, y: 1, z: 0 },
				{ x: 0, y: 0, z: 1 },
			],
			[[0, 1, 2]],
			{ x: 10, y: 0, z: 0 },
			2,
		);
		expect(face.points[0]).toEqual({ x: 12, y: 0, z: 0 });
		expect(face.points[2]).toEqual({ x: 10, y: 0, z: 2 });
	});
});

/** How many faces a solid draws from a default eye. */
function visibleFaces(solid: SceneNode): number {
	const scene = mount(
		camera3D.create({ eye: { x: 4, y: 3, z: 5 }, children: [solid] }),
	);
	const count = scene.shapes().length;
	scene.graph.dispose();
	return count;
}

describe("the polyhedron primitives", () => {
	it.each([
		["tetrahedron3D", () => tetrahedron3D.create({}), 4],
		["octahedron3D", () => octahedron3D.create({ edgeLength: 2 }), 8],
		["icosahedron3D", () => icosahedron3D.create({}), 20],
		[
			"dodecahedron3D",
			() => dodecahedron3D.create({ center: { x: 0, y: 1, z: 0 } }),
			12,
		],
	] as const)(
		"%s shows its near faces and culls its far ones",
		(_, build, total) => {
			const shown = visibleFaces(build());
			expect(shown).toBeGreaterThan(0);
			expect(shown).toBeLessThan(total);
		},
	);

	it("polyhedron3D draws faces listed in either winding", () => {
		const vertices = [
			{ x: -1, y: 0, z: -1 },
			{ x: 1, y: 0, z: -1 },
			{ x: 1, y: 0, z: 1 },
			{ x: -1, y: 0, z: 1 },
			{ x: 0, y: 1.5, z: 0 },
		];
		const outward = orientFaces(vertices, [
			[0, 1, 2, 3],
			[0, 1, 4],
			[1, 2, 4],
			[2, 3, 4],
			[3, 0, 4],
		]);
		const inward = outward.map((face) => [...face].reverse());
		const a = visibleFaces(polyhedron3D.create({ vertices, faces: outward }));
		const b = visibleFaces(polyhedron3D.create({ vertices, faces: inward }));
		expect(a).toBeGreaterThan(0);
		expect(b).toBe(a);
	});

	it("convexHull3D wraps its points", () => {
		const shown = visibleFaces(
			convexHull3D.create({ points: [...PLATONIC_SOLIDS.octahedron.vertices] }),
		);
		expect(shown).toBeGreaterThan(0);
		expect(shown).toBeLessThan(8);
	});

	it("moving a polyhedron rebuilds its faces at the new centre", () => {
		const vertices = [...PLATONIC_SOLIDS.tetrahedron.vertices];
		const faces = PLATONIC_SOLIDS.tetrahedron.faces;
		const solid = polyhedron3D.create({ vertices, faces });
		const scene = mount(camera3D.create({ children: [solid] }));
		const before = solid.world;
		solid.set("center", { x: 1, y: 0, z: 0 });
		scene.commit();
		expect(solid.world).not.toBe(before);
		expect(solid.world[0].points[0].x).toBeCloseTo(
			before[0].points[0].x + 1,
			12,
		);
	});
});
