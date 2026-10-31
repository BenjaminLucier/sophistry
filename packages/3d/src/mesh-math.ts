/**
 * The pure vector math behind `<MeshFaces>` — split out
 * because `box.ts` and `ring.ts` build `MeshFace[]` lists for the "solid" 3D
 * primitives (`Cube3D`, `Prism3D`, `Cylinder3D`, `Cone3D`) and need the
 * `MeshFace` type, and those are core, not JSX. The `Point3` vector helpers
 * (`subtract3`, `cross3`, `dot3`, `normalize3`) are object-shaped twins of
 * `wgpu-matrix`'s array `vec3`, for the mesh code's `{x, y, z}` points; they
 * are exported from `@sophistry/core/internal`, not `/3d`.
 */

import type { Point3 } from "@sophistry/core/internal";

/**
 * Component-wise `a - b`, returning a new vector.
 *
 * @category Math & helpers
 */
export function subtract3(a: Point3, b: Point3): Point3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Cross product `a x b` (right-handed), returning a new vector.
 *
 * @category Math & helpers
 */
export function cross3(a: Point3, b: Point3): Point3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

/**
 * Dot product of two vectors.
 *
 * @category Math & helpers
 */
export function dot3(a: Point3, b: Point3): number {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Unit vector in the direction of `v`; returns `v` unchanged if its length is near zero.
 *
 * @category Math & helpers
 */
export function normalize3(v: Point3): Point3 {
	const len = Math.hypot(v.x, v.y, v.z);
	return len > 1e-9 ? { x: v.x / len, y: v.y / len, z: v.z / len } : v;
}

/**
 * True 3D backface cull: is `point` (any corner of a planar face) facing
 * the eye, i.e. does the face's outward `normal` have a positive component
 * toward the camera? This is `N·V` culling — the real thing, as opposed to
 * the 2D screen-space winding test it replaces at both call sites
 * (`MeshFaces` and `SurfacePlot3D`).
 *
 * Uses `> 0`, not `>= 0`: a face exactly edge-on to the eye (`dot === 0`)
 * culls rather than surviving to z-fight with whatever's behind it.
 *
 * @category Math & helpers
 */
export function isFrontFacing(
	normal: Point3,
	eye: Point3,
	point: Point3,
): boolean {
	return dot3(normal, subtract3(eye, point)) > 0;
}

/**
 * Flat-shading light for mesh solids. A face's colour channels are scaled by
 * `ambient + diffuse * max(0, normal . -direction)`, so faces turned away from
 * the light still get the ambient floor.
 *
 * @category Math & helpers
 */
export interface MeshLight {
	/**
	 * Intensity every face receives regardless of angle (a multiplier on its colour).
	 * @default 0.35
	 */
	ambient?: number;
	/**
	 * Extra intensity for a face directly facing the light.
	 * @default 0.75
	 */
	diffuse?: number;
	/**
	 * Direction the light comes *from*, in world space; normalized internally.
	 * @default `{x:-0.4,y:0.8,z:0.4}`
	 */
	direction?: Point3;
}

/**
 * One planar face, as its world-space corners in winding order.
 *
 * Winding matters because the first three corners set the face normal
 * (`(p1-p0) × (p2-p0)`) both flat shading and backface culling
 * (`isFrontFacing`) are computed from. Consistent winding across a solid's
 * own faces (typically: front-facing when its corners run counter-clockwise
 * as seen from outside the solid, i.e. the normal points outward) is a
 * primitive's job, not this module's — a face with the wrong winding culls
 * or shades backwards, not incorrectly-but-visibly.
 *
 * @category Math & helpers
 */
export interface MeshFace {
	/** Corners in world units, at least 3, in winding order. */
	points: Point3[];
}
