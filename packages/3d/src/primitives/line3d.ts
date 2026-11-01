/**
 * `line3D`: a plain 3D segment, no arrowhead. A two-point curve: its world
 * geometry is its endpoints and it projects through `curve3D`'s
 * `projectCurve`, so it gets near-plane clipping, `progress`, handles and
 * interaction the same way.
 */

import { Invalidate } from "@sophistry/core";
import { lerpPoint3 } from "@sophistry/core/geometry";
import type { Point3 } from "@sophistry/core/internal";
import { shape3DProps } from "../props3d.js";
import { defineShape3D } from "../shape3d.js";
import { type Curve3DProps, projectCurve } from "./curve3d.js";

/** @category Primitives */
export interface Line3DProps
	extends Omit<Curve3DProps, "function" | "samples"> {
	/**
	 * Start of the segment, in world units. Defaults to the world origin,
	 * matching `vector3D`'s convention.
	 */
	from?: Point3;
	/** End of the segment, in world units. */
	to: Point3;
}

const DEFAULT_FROM: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_WORLD_WIDTH = 0.04;

/**
 * A straight 3D line segment from `from` to `to`, with no arrowhead.
 *
 * Thickness is `worldWidth` (world units, perspective-scaled), not
 * `strokeWidth`. The part of the segment behind the camera is clipped away.
 * Must be inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { line3D } from "@sophistry/3d";
 *
 * const edge = line3D.create({ from: { x: -1, y: 0, z: 0 }, to: { x: 1, y: 2, z: 0 } });
 * ```
 *
 * @see {@link vector3D} for an arrow.
 * @category Primitives
 */
export const line3D = defineShape3D<Line3DProps, Point3[]>({
	name: "Line3D",
	props: {
		...shape3DProps,
		stroke: { invalidates: Invalidate.UPDATE },
		from: { default: DEFAULT_FROM, invalidates: Invalidate.GEOMETRY },
		to: { invalidates: Invalidate.GEOMETRY },
		worldWidth: {
			default: DEFAULT_WORLD_WIDTH,
			invalidates: Invalidate.UPDATE,
		},
	},
	// The curve `t => lerp(from, to, t)` sampled once, as a two-point
	// `curve3D` would sample it.
	world: (props) => {
		const from = props.from ?? DEFAULT_FROM;
		const to = props.to;
		if (!to) return [];
		return [lerpPoint3(from, to, 0), lerpPoint3(from, to, 1)];
	},
	project: (points, camera, props, theme) =>
		projectCurve(
			points,
			camera,
			{
				stroke: props.stroke,
				worldWidth: props.worldWidth ?? DEFAULT_WORLD_WIDTH,
			},
			theme,
		),
});
