/**
 * A torus: the standard parametrization as one closure, sampled by
 * `surfacePlot3D`'s face builder (`surfaceFaces`), the same way `cube3D`
 * shares `prism3D`'s box. Everything about projecting, shading, culling,
 * style and interaction already lives in `defineMesh3D`; there is no
 * separate torus geometry engine here.
 *
 * The parametrization's "hole" naturally points along one axis; the other two
 * `axis` choices are handled by relabelling which world axis the parametric
 * x/y/z land on, not by composing a rotation matrix: a torus is symmetric
 * enough (revolve a circle around an axis) that a coordinate swap is exactly
 * as correct as a rotation and a great deal cheaper to read.
 */

import { Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { defineMesh3D, type Mesh3DProps, mesh3DProps } from "../mesh";
import type { Axis } from "../ring";
import { surfaceFaces } from "./surface-plot3d";

/** @category Primitives */
export interface Torus3DProps extends Mesh3DProps {
	/** World-space centre. Defaults to the world origin. */
	center?: Point3;
	/**
	 * Distance from the centre to the tube's centreline, in world units.
	 * @default 1
	 */
	majorRadius?: number;
	/**
	 * Radius of the tube itself, in world units.
	 * @default 0.3
	 */
	minorRadius?: number;
	/**
	 * Which world axis the torus's "hole" points along (its axis of
	 * symmetry). Defaults to `"y"`.
	 */
	axis?: Axis;
	/**
	 * Grid resolution per parametric axis, as on `surfacePlot3D`. Defaults to
	 * 20, a touch below `surfacePlot3D`'s own 24, since a torus' doubly-curved
	 * but perfectly regular surface reads smoothly at a lower per-axis count
	 * than a general parametric surface needs.
	 * @default 20
	 */
	resolution?: number;
}

const DEFAULT_CENTER: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_MAJOR_RADIUS = 1;
const DEFAULT_MINOR_RADIUS = 0.3;
const DEFAULT_AXIS: Axis = "y";
const DEFAULT_RESOLUTION = 20;

const TAU = Math.PI * 2;

/** The torus's parametric surface, `u` and `v` in [0,1]. */
function torusSurface(
	props: Readonly<Torus3DProps>,
): (u: number, v: number) => Point3 {
	const center = props.center ?? DEFAULT_CENTER;
	const majorRadius = props.majorRadius ?? DEFAULT_MAJOR_RADIUS;
	const minorRadius = props.minorRadius ?? DEFAULT_MINOR_RADIUS;
	const axis = props.axis ?? DEFAULT_AXIS;

	return (u: number, v: number): Point3 => {
		const theta = u * TAU;
		const phi = v * TAU;
		// The tube's centreline circle (radius `majorRadius`) lies in the plane
		// perpendicular to `axis`; `ring` is how far out from that centreline
		// the tube's own cross-section circle (radius `minorRadius`) pushes at
		// this `phi`, and `tube` is how far it rises along `axis`.
		const ring = majorRadius + minorRadius * Math.cos(phi);
		const tube = minorRadius * Math.sin(phi);
		const a = ring * Math.cos(theta);
		const b = ring * Math.sin(theta);

		// The standard formula's hole points along z; the other two axes are
		// reached by relabelling which world coordinate gets `a`/`b` (the
		// centreline circle) and which gets `tube` (the rise through the hole):
		// a coordinate swap, not a rotation.
		switch (axis) {
			case "x":
				return { x: center.x + tube, y: center.y + a, z: center.z + b };
			case "y":
				return { x: center.x + a, y: center.y + tube, z: center.z + b };
			default:
				return { x: center.x + a, y: center.y + b, z: center.z + tube };
		}
	};
}

/**
 * A flat-shaded torus (a ring or doughnut) centred on `center`.
 *
 * `majorRadius` is the distance from the centre to the middle of the tube and
 * `minorRadius` is the tube's own radius; `axis` is the direction the hole
 * points along (`"y"` by default). It is sampled like a `surfacePlot3D` from
 * the standard `(R + r·cos v)·(cos u, sin u) , r·sin v` parametrization, u
 * and v both in `[0,1]` mapped to `[0, 2π)`. Must be inside a `camera3D`;
 * see {@link Mesh3DProps} for paint and light.
 *
 * @example
 * ```ts
 * import { torus3D } from "@sophistry/3d";
 *
 * const ring = torus3D.create({ majorRadius: 1.2, minorRadius: 0.25, axis: "z" });
 * ```
 *
 * @category Primitives
 */
export const torus3D = defineMesh3D<Torus3DProps>({
	name: "Torus3D",
	props: {
		...mesh3DProps,
		center: { default: DEFAULT_CENTER, invalidates: Invalidate.GEOMETRY },
		majorRadius: {
			default: DEFAULT_MAJOR_RADIUS,
			invalidates: Invalidate.GEOMETRY,
		},
		minorRadius: {
			default: DEFAULT_MINOR_RADIUS,
			invalidates: Invalidate.GEOMETRY,
		},
		axis: { default: DEFAULT_AXIS, invalidates: Invalidate.GEOMETRY },
		resolution: {
			default: DEFAULT_RESOLUTION,
			invalidates: Invalidate.GEOMETRY,
		},
	},
	faces: (props) =>
		surfaceFaces(torusSurface(props), props.resolution ?? DEFAULT_RESOLUTION),
});
