/**
 * The six-quad geometry shared by `Cube3D` and `Prism3D` — a cube is just a
 * rectangular box with equal extents on every axis, so the winding-order
 * derivation (the part worth getting wrong exactly once, not twice) lives
 * here rather than in either component. See `mesh.tsx`'s `MeshFace` doc for
 * why winding matters; each face below is ordered so its corners run
 * counter-clockwise as seen from outside the box, which is what makes both
 * the backface cull and the flat-shading normal come out right-side-out.
 */

import type { Point3 } from "@sophistry/core/internal";
import type { MeshFace } from "./mesh-math";

/**
 * The six axis-aligned faces of a box centred at `center` with the
 * given full extents on each axis. Degenerate extents (`0` or negative)
 * still produce a face list — `MeshFaces` culls a zero-area face for free
 * via its winding test, so there is no need to special-case it here.
 *
 * @param center - Box centre, in world units.
 * @param sizeX - Full extent along x.
 * @param sizeY - Full extent along y.
 * @param sizeZ - Full extent along z.
 * @returns Six quads, wound counter-clockwise as seen from outside, ready for `MeshFaces`.
 *
 * @category Math & helpers
 */
export function boxFaces(
	center: Point3,
	sizeX: number,
	sizeY: number,
	sizeZ: number,
): MeshFace[] {
	const hx = sizeX / 2;
	const hy = sizeY / 2;
	const hz = sizeZ / 2;

	const xMinus = center.x - hx;
	const xPlus = center.x + hx;
	const yMinus = center.y - hy;
	const yPlus = center.y + hy;
	const zMinus = center.z - hz;
	const zPlus = center.z + hz;

	// The eight corners, named by which side of centre each axis sits on.
	const p000: Point3 = { x: xMinus, y: yMinus, z: zMinus };
	const p001: Point3 = { x: xMinus, y: yMinus, z: zPlus };
	const p010: Point3 = { x: xMinus, y: yPlus, z: zMinus };
	const p011: Point3 = { x: xMinus, y: yPlus, z: zPlus };
	const p100: Point3 = { x: xPlus, y: yMinus, z: zMinus };
	const p101: Point3 = { x: xPlus, y: yMinus, z: zPlus };
	const p110: Point3 = { x: xPlus, y: yPlus, z: zMinus };
	const p111: Point3 = { x: xPlus, y: yPlus, z: zPlus };

	return [
		// +X
		{ points: [p100, p110, p111, p101] },
		// -X
		{ points: [p000, p001, p011, p010] },
		// +Y
		{ points: [p010, p011, p111, p110] },
		// -Y
		{ points: [p000, p100, p101, p001] },
		// +Z
		{ points: [p001, p101, p111, p011] },
		// -Z
		{ points: [p000, p010, p110, p100] },
	];
}
