/**
 * A cone, built the same way `cylinder3D` is (an explicit `MeshFace[]`: one
 * base n-gon, `resolution` triangular side faces meeting at a shared apex,
 * handed to `defineMesh3D`), with the base ring shared with `cylinder3D` via
 * `ring.ts` rather than re-derived. The only real difference from a cylinder
 * is that the "other end" collapses to a single point, so each side face is
 * a triangle instead of a quad and there is only one cap.
 */

import { Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { defineMesh3D, type Mesh3DProps, mesh3DProps } from "../mesh";
import type { MeshFace } from "../mesh-math";
import type { Axis } from "../ring";
import { axisVector, ringPoints } from "../ring";

/** @category Primitives */
export interface Cone3DProps extends Mesh3DProps {
	/**
	 * World-space centre of the cone's bounding solid: the point halfway between
	 * the base and the apex. Defaults to the world origin.
	 */
	center?: Point3;
	/**
	 * World-unit base radius.
	 * @default 0.5
	 */
	radius?: number;
	/**
	 * Height from base to apex, in world units.
	 * @default 1
	 */
	height?: number;
	/**
	 * Which world axis the cone points along, from its base toward the apex.
	 * Defaults to `"y"`.
	 */
	axis?: Axis;
	/**
	 * Sides of the polygon approximating the circular base.
	 * @default 24
	 */
	resolution?: number;
}

const DEFAULT_CENTER: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_RADIUS = 0.5;
const DEFAULT_HEIGHT = 1;
const DEFAULT_AXIS: Axis = "y";
const DEFAULT_RESOLUTION = 24;

/**
 * The faces of a cone: the base, then one side triangle per segment, all
 * wound counter-clockwise seen from outside.
 */
function coneFaces(props: Readonly<Cone3DProps>): MeshFace[] {
	const center = props.center ?? DEFAULT_CENTER;
	const radius = props.radius ?? DEFAULT_RADIUS;
	const height = props.height ?? DEFAULT_HEIGHT;
	const axis = props.axis ?? DEFAULT_AXIS;
	const segments = Math.max(
		3,
		Math.round(props.resolution ?? DEFAULT_RESOLUTION),
	);

	const direction = axisVector(axis);
	const half = height / 2;
	const apex: Point3 = {
		x: center.x + direction.x * half,
		y: center.y + direction.y * half,
		z: center.z + direction.z * half,
	};
	const baseCenter: Point3 = {
		x: center.x - direction.x * half,
		y: center.y - direction.y * half,
		z: center.z - direction.z * half,
	};

	// Same world point everywhere it's used (the apex, and every base vertex
	// shared between the cap and its two adjacent side triangles), so, as with
	// `cylinder3D`, no seam-hiding trick is needed.
	const base = ringPoints(baseCenter, radius, axis, segments);

	const faces: MeshFace[] = [];

	// The base is the negative-axis end (the apex is the positive-axis end),
	// so it's outside-facing from the opposite viewpoint `ringPoints` assumes:
	// reverse it, same reasoning as `cylinder3D`'s bottom cap.
	faces.push({ points: [...base].reverse() });

	for (let i = 0; i < segments; i++) {
		const next = (i + 1) % segments;
		// [apex, base[i], base[next]] is `cylinder3D`'s side-quad order
		// [top[i], bottom[i], bottom[next], top[next]] with `top[i]` and
		// `top[next]` collapsed to the single shared apex point: the same
		// outward-normal check applies.
		faces.push({ points: [apex, base[i], base[next]] });
	}

	return faces;
}

/**
 * A flat-shaded cone centred on `center`, its base `height / 2` behind and its
 * apex `height / 2` ahead along `axis` (`"y"` by default, so it points up).
 *
 * Like every 3D primitive, `center` is the middle of the bounding solid, the
 * same as `cylinder3D`. It is drawn as a capping polygon plus a fan of
 * `resolution` triangles. Must be inside a `camera3D`; see
 * {@link Mesh3DProps} for paint, light and interaction.
 *
 * @example
 * ```ts
 * import { cone3D } from "@sophistry/3d";
 *
 * const spike = cone3D.create({ radius: 0.3, height: 1, axis: "z", fill: "orange" });
 * ```
 *
 * @see {@link cylinder3D}
 * @category Primitives
 */
export const cone3D = defineMesh3D<Cone3DProps>({
	name: "Cone3D",
	props: {
		...mesh3DProps,
		center: { default: DEFAULT_CENTER, invalidates: Invalidate.GEOMETRY },
		radius: { default: DEFAULT_RADIUS, invalidates: Invalidate.GEOMETRY },
		height: { default: DEFAULT_HEIGHT, invalidates: Invalidate.GEOMETRY },
		axis: { default: DEFAULT_AXIS, invalidates: Invalidate.GEOMETRY },
		resolution: {
			default: DEFAULT_RESOLUTION,
			invalidates: Invalidate.GEOMETRY,
		},
	},
	faces: coneFaces,
});
