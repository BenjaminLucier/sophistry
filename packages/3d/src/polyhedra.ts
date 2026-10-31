/**
 * Polyhedron geometry — Manim's `Polyhedron`, `ConvexHull3D` and the platonic
 * solids, as face lists for `MeshFaces`.
 *
 * The one thing a face list must get right is winding: `MeshFaces` culls and
 * shades by each face's normal, so every face has to run counter-clockwise as
 * seen from outside. Hand-written index tables are where that goes wrong, so
 * none are written here. The platonic solids are given by their vertices
 * alone (Manim's coordinates) and their faces are *found*: a face of a convex
 * solid is a plane with every vertex on one side, and the vertices on it,
 * ordered round their centre, are its corners. `orientFaces` does the same
 * winding fix for faces a caller lists by hand.
 */

import type { Point3 } from "@sophistry/core/internal";
import type { MeshFace } from "./mesh-math";
import { cross3, dot3, normalize3, subtract3 } from "./mesh-math";

/** The golden ratio, which every icosahedron and dodecahedron is built from. */
const PHI = (1 + Math.sqrt(5)) / 2;

function centroid(points: readonly Point3[]): Point3 {
	let x = 0;
	let y = 0;
	let z = 0;
	for (const p of points) {
		x += p.x;
		y += p.y;
		z += p.z;
	}
	const n = points.length || 1;
	return { x: x / n, y: y / n, z: z / n };
}

/** Largest distance from the centroid: the scale coplanarity is judged against. */
function extent(points: readonly Point3[]): number {
	const c = centroid(points);
	let r = 0;
	for (const p of points)
		r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z));
	return r;
}

/**
 * Orders the indices of points lying in one plane round their centre,
 * counter-clockwise as seen from the side `outward` points to.
 */
function windAround(
	points: readonly Point3[],
	indices: number[],
	outward: Point3,
): number[] {
	const c = centroid(indices.map((i) => points[i]));
	const n = normalize3(outward);
	// Any direction in the plane, and the one a quarter turn from it.
	const u = normalize3(subtract3(points[indices[0]], c));
	const v = cross3(n, u);
	return indices
		.map((i) => {
			const d = subtract3(points[i], c);
			return { i, angle: Math.atan2(dot3(d, v), dot3(d, u)) };
		})
		.sort((a, b) => a.angle - b.angle)
		.map((entry) => entry.i);
}

/**
 * The faces of the convex hull of `points`, each a list of indices into
 * `points` wound counter-clockwise as seen from outside: Manim's
 * `ConvexHull3D`. Coplanar points share one face, so a cube's hull is six
 * squares, not twelve triangles. Points strictly inside the hull belong to no
 * face.
 *
 * Brute force (every triple of points is a candidate plane), which is exact
 * and needs no care with degenerate input, but grows with the fourth power
 * of the point count: meant for solids of tens of vertices, not point clouds.
 * Fewer than four points, or all of them in one plane, have no hull and give
 * no faces.
 *
 * @param points - The points, in world units.
 * @returns Each face's point indices, wound outward.
 *
 * @category Math & helpers
 */
export function convexHullFaces(points: readonly Point3[]): number[][] {
	const n = points.length;
	if (n < 4) return [];
	const eps = extent(points) * 1e-9;
	const faces: number[][] = [];
	const seen = new Set<string>();
	for (let a = 0; a < n; a++)
		for (let b = a + 1; b < n; b++)
			for (let c = b + 1; c < n; c++) {
				const normal = cross3(
					subtract3(points[b], points[a]),
					subtract3(points[c], points[a]),
				);
				const length = Math.hypot(normal.x, normal.y, normal.z);
				if (!(length > eps * eps)) continue;
				const unit = {
					x: normal.x / length,
					y: normal.y / length,
					z: normal.z / length,
				};
				let above = 0;
				let below = 0;
				const on: number[] = [];
				for (let i = 0; i < n; i++) {
					const d = dot3(unit, subtract3(points[i], points[a]));
					if (d > eps) above++;
					else if (d < -eps) below++;
					else on.push(i);
					if (above > 0 && below > 0) break;
				}
				if (above > 0 && below > 0) continue;
				if (above === 0 && below === 0) return []; // all coplanar: no solid
				const key = on.join(",");
				if (seen.has(key)) continue;
				seen.add(key);
				// Outward is away from the points the plane has behind it.
				const outward =
					above > 0 ? { x: -unit.x, y: -unit.y, z: -unit.z } : unit;
				faces.push(windAround(points, on, outward));
			}
	return faces;
}

/**
 * Winds each face counter-clockwise as seen from outside: a face whose
 * normal points toward the solid's centre (the mean of every vertex) is
 * reversed. Right for any convex solid, and for any solid whose faces all
 * face away from that centre; a deeply concave one can fool it.
 *
 * @param vertices - The solid's vertices, in world units.
 * @param faces - Each face's vertex indices, in either winding.
 * @returns The same faces, wound outward.
 *
 * @category Math & helpers
 */
export function orientFaces(
	vertices: readonly Point3[],
	faces: readonly (readonly number[])[],
): number[][] {
	const centre = centroid(vertices);
	return faces.map((face) => {
		const corners = face.map((i) => vertices[i]);
		if (corners.length < 3) return [...face];
		const middle = centroid(corners);
		// Newell's normal: robust for a slightly non-planar or concave polygon.
		let nx = 0;
		let ny = 0;
		let nz = 0;
		for (let i = 0; i < corners.length; i++) {
			const p = corners[i];
			const q = corners[(i + 1) % corners.length];
			nx += (p.y - q.y) * (p.z + q.z);
			ny += (p.z - q.z) * (p.x + q.x);
			nz += (p.x - q.x) * (p.y + q.y);
		}
		const outward = dot3({ x: nx, y: ny, z: nz }, subtract3(middle, centre));
		return outward < 0 ? [...face].reverse() : [...face];
	});
}

/**
 * Turns vertices and index faces into the world-space faces `MeshFaces`
 * draws, scaled by `scale` about the origin and then moved to `center`.
 *
 * @category Math & helpers
 */
export function polyhedronMeshFaces(
	vertices: readonly Point3[],
	faces: readonly (readonly number[])[],
	center: Point3 = { x: 0, y: 0, z: 0 },
	scale = 1,
): MeshFace[] {
	const placed = vertices.map((v) => ({
		x: center.x + v.x * scale,
		y: center.y + v.y * scale,
		z: center.z + v.z * scale,
	}));
	return faces.map((face) => ({ points: face.map((i) => placed[i]) }));
}

/** A platonic solid: its vertices at edge length 1, and its faces, found once. */
export interface PlatonicSolid {
	vertices: readonly Point3[];
	faces: readonly (readonly number[])[];
}

function solid(vertices: Point3[], unit: number): PlatonicSolid {
	const scaled = vertices.map((v) => ({
		x: v.x * unit,
		y: v.y * unit,
		z: v.z * unit,
	}));
	return { vertices: scaled, faces: convexHullFaces(scaled) };
}

const signs = [1, -1];

/** Every sign combination of `(x, y, z)`, skipping repeats where a coordinate is 0. */
function allSigns(x: number, y: number, z: number): Point3[] {
	const out: Point3[] = [];
	for (const sx of x === 0 ? [1] : signs)
		for (const sy of y === 0 ? [1] : signs)
			for (const sz of z === 0 ? [1] : signs)
				out.push({ x: sx * x, y: sy * y, z: sz * z });
	return out;
}

/**
 * The five platonic solids at edge length 1, centred on the origin, in
 * Manim's orientation (its `Tetrahedron`, `Cube`, `Octahedron`,
 * `Icosahedron` and `Dodecahedron` vertex coordinates). Scale by an edge
 * length with {@link polyhedronMeshFaces}.
 *
 * @category Math & helpers
 */
export const PLATONIC_SOLIDS = {
	tetrahedron: solid(
		[
			{ x: 1, y: 1, z: 1 },
			{ x: 1, y: -1, z: -1 },
			{ x: -1, y: 1, z: -1 },
			{ x: -1, y: -1, z: 1 },
		],
		Math.SQRT2 / 4,
	),
	cube: solid(allSigns(1, 1, 1), 0.5),
	octahedron: solid(
		[...allSigns(1, 0, 0), ...allSigns(0, 1, 0), ...allSigns(0, 0, 1)],
		Math.SQRT2 / 2,
	),
	icosahedron: solid(
		[...allSigns(0, 1, PHI), ...allSigns(1, PHI, 0), ...allSigns(PHI, 0, 1)],
		0.5,
	),
	dodecahedron: solid(
		[
			...allSigns(1, 1, 1),
			...allSigns(0, 1 / PHI, PHI),
			...allSigns(1 / PHI, PHI, 0),
			...allSigns(PHI, 0, 1 / PHI),
		],
		PHI / 2,
	),
} satisfies Record<string, PlatonicSolid>;
