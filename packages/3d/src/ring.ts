/**
 * "N points evenly spaced around a circle perpendicular to some axis" is the
 * one piece of geometry `Cylinder3D` and `Cone3D` both need and neither has
 * anything else in common with `SurfacePlot3D`'s `u,v` grid sampling to
 * justify pulling into `mesh.tsx` — small enough, and specific enough to
 * "solids with a circular cross-section", to live as its own module rather
 * than duplicated per-file (the `Axes3D`-composes-`Vector3D` precedent, not
 * the `mesh.tsx`-factored-from-`SurfacePlot3D` one: this is reused *code*,
 * not reused *rendering machinery*).
 */

import type { Point3 } from "@sophistry/core/internal";

/**
 * A world axis, used to choose the direction a cylinder, cone or torus points along.
 *
 * @category Math & helpers
 */
export type Axis = "x" | "y" | "z";

/**
 * Per-axis `(u, v)` basis with `u × v = axis`, chosen once here so every ring
 * a caller builds agrees on which way "increasing angle" turns. That
 * agreement is what lets `Cylinder3D`/`Cone3D` reason about winding by a
 * single rule ("a ring is counter-clockwise as seen from its axis's positive
 * end, by the right-hand rule that defines the cross product") instead of
 * re-deriving a sign per axis, per cap.
 */
const BASIS: Record<Axis, { u: Point3; v: Point3; axis: Point3 }> = {
	x: {
		u: { x: 0, y: 1, z: 0 },
		v: { x: 0, y: 0, z: 1 },
		axis: { x: 1, y: 0, z: 0 },
	},
	y: {
		u: { x: 0, y: 0, z: 1 },
		v: { x: 1, y: 0, z: 0 },
		axis: { x: 0, y: 1, z: 0 },
	},
	z: {
		u: { x: 1, y: 0, z: 0 },
		v: { x: 0, y: 1, z: 0 },
		axis: { x: 0, y: 0, z: 1 },
	},
};

/** Unit vector a solid's `axis` prop points along — the direction "height"
 * or "from base to apex" is measured in.
 *
 * @category Math & helpers
 */
export function axisVector(axis: Axis): Point3 {
	return BASIS[axis].axis;
}

/**
 * `segments` points evenly spaced around a circle of `radius`, centred at
 * `center`, in the plane perpendicular to `axis` — wound counter-clockwise
 * as seen from the positive-`axis` direction looking back toward `center`
 * (a direct consequence of `BASIS`'s `u × v = axis`, not something this
 * function checks or could get wrong independently).
 *
 * That single fixed convention is enough for both callers to get every face
 * right without re-deriving a sign: a cap at the positive-`axis` end of a
 * solid is already correctly wound by using this order as-is; a cap at the
 * negative-`axis` end needs it reversed; a side quad/triangle needs it
 * paired against the opposite ring (or apex) in a fixed pattern. See
 * `Cylinder3D`/`Cone3D` for the worked-out cases.
 *
 * @category Math & helpers
 */
export function ringPoints(
	center: Point3,
	radius: number,
	axis: Axis,
	segments: number,
): Point3[] {
	const { u, v } = BASIS[axis];
	const points: Point3[] = new Array(segments);
	for (let i = 0; i < segments; i++) {
		const theta = (i / segments) * Math.PI * 2;
		const cos = Math.cos(theta);
		const sin = Math.sin(theta);
		points[i] = {
			x: center.x + radius * (cos * u.x + sin * v.x),
			y: center.y + radius * (cos * u.y + sin * v.y),
			z: center.z + radius * (cos * u.z + sin * v.z),
		};
	}
	return points;
}
