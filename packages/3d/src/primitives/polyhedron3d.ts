/**
 * Polyhedra: Manim's `Polyhedron`, `ConvexHull3D`, `Tetrahedron`,
 * `Octahedron`, `Icosahedron` and `Dodecahedron`, drawn by `defineMesh3D`
 * like every other solid. The geometry, including how faces come out wound
 * the right way without anyone writing an index table, is in `polyhedra.ts`.
 *
 * Manim draws a polyhedron's edges and vertices as a graph on top of its
 * faces; here a solid is its faces, and `stroke` outlines each one, which
 * draws the visible edges.
 */

import { Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { defineMesh3D, type Mesh3DProps, mesh3DProps } from "../mesh.js";
import type { PlatonicSolid } from "../polyhedra.js";
import {
	convexHullFaces,
	orientFaces,
	PLATONIC_SOLIDS,
	polyhedronMeshFaces,
} from "../polyhedra.js";

/** @category Primitives */
export interface Polyhedron3DProps extends Mesh3DProps {
	/** The vertices, in world units (before `center` and `scale`). */
	vertices: readonly Point3[];
	/**
	 * Each face as indices into `vertices`, in either winding: each is turned
	 * to face away from the solid's centre (see `orientFaces`).
	 */
	faces: readonly (readonly number[])[];
	/** Where the vertices' origin goes. Defaults to the world origin. */
	center?: Point3;
	/**
	 * Scales the vertices about their origin.
	 * @default 1
	 */
	scale?: number;
}

/** @category Primitives */
export interface ConvexHull3DProps extends Mesh3DProps {
	/** The points to wrap, in world units. Points inside the hull are ignored. */
	points: readonly Point3[];
}

/** @category Primitives */
export interface PlatonicSolid3DProps extends Mesh3DProps {
	/** World-space centre. Defaults to the world origin. */
	center?: Point3;
	/**
	 * Length of every edge, in world units. The default matches Manim's.
	 * @default 1
	 */
	edgeLength?: number;
}

const DEFAULT_CENTER: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const NO_POINTS: readonly Point3[] = Object.freeze([]);
const NO_FACES: readonly (readonly number[])[] = Object.freeze([]);

/**
 * The last orientation per `faces` array, so moving or scaling a polyhedron
 * re-places its vertices without re-winding its faces. Keyed by identity: a new `faces` or `vertices` array
 * re-orients.
 */
const orientedCache = new WeakMap<
	readonly (readonly number[])[],
	{ vertices: readonly Point3[]; oriented: number[][] }
>();

function orientedFaces(
	vertices: readonly Point3[],
	faces: readonly (readonly number[])[],
): number[][] {
	const cached = orientedCache.get(faces);
	if (cached && cached.vertices === vertices) return cached.oriented;
	const oriented = orientFaces(vertices, faces);
	orientedCache.set(faces, { vertices, oriented });
	return oriented;
}

/**
 * `Polyhedron`: any solid given as vertices and the faces between them,
 * flat-shaded and backface-culled like every mesh.
 *
 * Faces may be listed in either winding; each is reversed if it faces toward
 * the solid's centre. That is right for every convex solid and most others,
 * but a deeply concave one can need its faces wound by hand, outward, and a
 * solid with holes through it is beyond a single centre. For a convex solid
 * from points alone, use {@link convexHull3D}. Must be inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { polyhedron3D } from "@sophistry/3d";
 *
 * const pyramid = polyhedron3D.create({
 * 	vertices: [
 * 		{ x: -1, y: 0, z: -1 },
 * 		{ x: 1, y: 0, z: -1 },
 * 		{ x: 1, y: 0, z: 1 },
 * 		{ x: -1, y: 0, z: 1 },
 * 		{ x: 0, y: 1.5, z: 0 },
 * 	],
 * 	faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
 * });
 * ```
 *
 * @category Primitives
 */
export const polyhedron3D = defineMesh3D<Polyhedron3DProps>({
	name: "Polyhedron3D",
	props: {
		...mesh3DProps,
		vertices: { default: NO_POINTS, invalidates: Invalidate.GEOMETRY },
		faces: { default: NO_FACES, invalidates: Invalidate.GEOMETRY },
		center: { default: DEFAULT_CENTER, invalidates: Invalidate.GEOMETRY },
		scale: { default: 1, invalidates: Invalidate.GEOMETRY },
	},
	faces: (props) => {
		const vertices = props.vertices ?? NO_POINTS;
		return polyhedronMeshFaces(
			vertices,
			orientedFaces(vertices, props.faces ?? NO_FACES),
			props.center,
			props.scale,
		);
	},
});

/**
 * `ConvexHull3D`: the smallest convex solid containing `points`, with
 * coplanar points sharing a face. Built by `convexHullFaces`, which is exact
 * but brute force: fine for tens of points, slow for hundreds. Must be
 * inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { convexHull3D } from "@sophistry/3d";
 *
 * const hull = convexHull3D.create({
 * 	points: [
 * 		{ x: 1, y: 0, z: 0 },
 * 		{ x: -1, y: 0, z: 0 },
 * 		{ x: 0, y: 1, z: 0 },
 * 		{ x: 0, y: 0, z: 1 },
 * 		{ x: 0, y: 0, z: -1 },
 * 	],
 * });
 * ```
 *
 * @category Primitives
 */
export const convexHull3D = defineMesh3D<ConvexHull3DProps>({
	name: "ConvexHull3D",
	props: {
		...mesh3DProps,
		points: { default: NO_POINTS, invalidates: Invalidate.GEOMETRY },
	},
	faces: (props) => {
		const points = props.points ?? NO_POINTS;
		return polyhedronMeshFaces(points, convexHullFaces(points));
	},
});

/** A platonic solid's definition: its unit faces, scaled and placed. */
function platonicSolid3D(name: string, solid: PlatonicSolid) {
	return defineMesh3D<PlatonicSolid3DProps>({
		name,
		props: {
			...mesh3DProps,
			center: { default: DEFAULT_CENTER, invalidates: Invalidate.GEOMETRY },
			edgeLength: { default: 1, invalidates: Invalidate.GEOMETRY },
		},
		faces: (props) =>
			polyhedronMeshFaces(
				solid.vertices,
				solid.faces,
				props.center,
				props.edgeLength ?? 1,
			),
	});
}

/**
 * `Tetrahedron`: four equilateral triangles, in Manim's orientation. Must be
 * inside a `camera3D`; takes every mesh prop besides `center` and
 * `edgeLength`.
 *
 * @example
 * ```ts
 * import { tetrahedron3D } from "@sophistry/3d";
 *
 * const solid = tetrahedron3D.create({ edgeLength: 2, fill: "#fa4" });
 * ```
 *
 * @category Primitives
 */
export const tetrahedron3D = platonicSolid3D(
	"Tetrahedron3D",
	PLATONIC_SOLIDS.tetrahedron,
);

/**
 * `Octahedron`: eight equilateral triangles, a vertex on each axis. See
 * {@link tetrahedron3D} for the props.
 *
 * @example
 * ```ts
 * import { octahedron3D } from "@sophistry/3d";
 *
 * const solid = octahedron3D.create({ center: { x: 0, y: 1, z: 0 } });
 * ```
 *
 * @category Primitives
 */
export const octahedron3D = platonicSolid3D(
	"Octahedron3D",
	PLATONIC_SOLIDS.octahedron,
);

/**
 * `Icosahedron`: twenty equilateral triangles. See {@link tetrahedron3D} for
 * the props.
 *
 * @example
 * ```ts
 * import { icosahedron3D } from "@sophistry/3d";
 *
 * const solid = icosahedron3D.create({ edgeLength: 1.5 });
 * ```
 *
 * @category Primitives
 */
export const icosahedron3D = platonicSolid3D(
	"Icosahedron3D",
	PLATONIC_SOLIDS.icosahedron,
);

/**
 * `Dodecahedron`: twelve regular pentagons. See {@link tetrahedron3D} for the
 * props.
 *
 * @example
 * ```ts
 * import { dodecahedron3D } from "@sophistry/3d";
 *
 * const solid = dodecahedron3D.create({ stroke: "#000" });
 * ```
 *
 * @category Primitives
 */
export const dodecahedron3D = platonicSolid3D(
	"Dodecahedron3D",
	PLATONIC_SOLIDS.dodecahedron,
);
