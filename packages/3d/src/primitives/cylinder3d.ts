/**
 * A cylinder, built the same way every "solid" in this package is: an
 * explicit list of flat `MeshFace`s (two ring caps, `resolution` side quads)
 * handed to `defineMesh3D`, which does the projecting, culling, shading and
 * the style/reveal/interaction plumbing. There is nothing curved here: a
 * cylinder is a `resolution`-sided prism, the same trade `sphere3D`'s
 * polygon-as-circle silhouette and `surfacePlot3D`'s quad grid both make: a
 * polygon dense enough to read as smooth at the sizes a scene actually draws
 * one at.
 */

import { Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { defineMesh3D, type Mesh3DProps, mesh3DProps } from "../mesh.js";
import type { MeshFace } from "../mesh-math.js";
import type { Axis } from "../ring.js";
import { axisVector, ringPoints } from "../ring.js";

/** @category Primitives */
export interface Cylinder3DProps extends Mesh3DProps {
	/** World-space centre of the cylinder's axis. Defaults to the world origin. */
	center?: Point3;
	/**
	 * World-unit radius.
	 * @default 0.5
	 */
	radius?: number;
	/**
	 * Full height, in world units, centred on `center`.
	 * @default 1
	 */
	height?: number;
	/**
	 * Which world axis the cylinder's axis runs along. Defaults to `"y"`
	 * (matching this framework's y-up convention: a cylinder standing
	 * upright by default).
	 */
	axis?: Axis;
	/**
	 * Sides of the polygon approximating the circular cross-section.
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
 * The faces of a cylinder: the top cap, the bottom cap, then one side quad
 * per segment, all wound counter-clockwise seen from outside.
 */
function cylinderFaces(props: Readonly<Cylinder3DProps>): MeshFace[] {
	const center = props.center ?? DEFAULT_CENTER;
	const radius = props.radius ?? DEFAULT_RADIUS;
	const height = props.height ?? DEFAULT_HEIGHT;
	const axis = props.axis ?? DEFAULT_AXIS;
	const segments = Math.max(
		3,
		Math.round(props.resolution ?? DEFAULT_RESOLUTION),
	);

	const half = axisVector(axis);
	const halfHeight = height / 2;
	const topCenter: Point3 = {
		x: center.x + half.x * halfHeight,
		y: center.y + half.y * halfHeight,
		z: center.z + half.z * halfHeight,
	};
	const bottomCenter: Point3 = {
		x: center.x - half.x * halfHeight,
		y: center.y - half.y * halfHeight,
		z: center.z - half.z * halfHeight,
	};

	// Same world points, same projection, front and back of every seam: the
	// top ring's `top[i]` is exactly the vertex the adjacent side quad uses,
	// so there is no gap-hiding trick to apply the way `vector3D`'s
	// shaft/head split needs one.
	const top = ringPoints(topCenter, radius, axis, segments);
	const bottom = ringPoints(bottomCenter, radius, axis, segments);

	const faces: MeshFace[] = [];

	// `ringPoints` is already counter-clockwise as seen from the positive-axis
	// end, i.e. from outside the top cap: used as-is.
	faces.push({ points: top });
	// The bottom cap is outside-facing from the *negative*-axis end, the
	// opposite viewpoint, so the same ring order reads clockwise there:
	// reverse it.
	faces.push({ points: [...bottom].reverse() });

	for (let i = 0; i < segments; i++) {
		const next = (i + 1) % segments;
		// [top[i], bottom[i], bottom[next], top[next]] is the order that works
		// out to an outward-pointing normal for a ring wound this way (checked
		// by hand against `MeshFace`'s `(p1-p0)×(p2-p0)` normal convention):
		// `[top[i], top[next], bottom[next], bottom[i]]` looks equally
		// plausible at a glance but is backwards.
		faces.push({
			points: [top[i], bottom[i], bottom[next], top[next]],
		});
	}

	return faces;
}

/**
 * A flat-shaded cylinder whose axis runs along a world axis (`"y"` by
 * default, so it stands upright), centred on `center`.
 *
 * It is a `resolution`-sided prism: two capping polygons plus a ring of side
 * quads, so raise `resolution` for large or close-up cylinders. Must be
 * inside a `camera3D`. Projection, culling, shading, style and interaction
 * are `meshFaces`'; see {@link Mesh3DProps}.
 *
 * @example
 * ```ts
 * import { cylinder3D } from "@sophistry/3d";
 *
 * const can = cylinder3D.create({ radius: 0.4, height: 1.2, fill: "#4af" });
 * ```
 *
 * @see {@link cone3D}
 * @category Primitives
 */
export const cylinder3D = defineMesh3D<Cylinder3DProps>({
	name: "Cylinder3D",
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
	faces: cylinderFaces,
});
