/**
 * Single bezier segments, cubic and quadratic, built where they sit.
 */

import type { Point } from "../geometry/index.js";
import { quadraticToCubic } from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import {
	defineShape,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape.js";

/** @category Shapes */
export interface CubicBezierProps extends ShapeProps {
	/** Start point in scene units. */
	from: Point;
	/** Control point pulling the curve away from `from`, in scene units. */
	control1: Point;
	/** Control point pulling the curve toward `to`, in scene units. */
	control2: Point;
	/** End point in scene units. */
	to: Point;
}

/**
 * A single cubic bezier from `from` to `to`, shaped by two control points.
 *
 * Open, so `fill` has no effect. `path.create({ pathData: "…C…" })` is the
 * multi-segment version.
 *
 * @example
 * ```ts
 * import { createScene, cubicBezier } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	cubicBezier.create({
 * 		from: { x: -2, y: 0 },
 * 		control1: { x: -1, y: 2 },
 * 		control2: { x: 1, y: -2 },
 * 		to: { x: 2, y: 0 },
 * 	}),
 * );
 * ```
 *
 * @see {@link quadraticBezier}
 * @see {@link path}
 *
 * @category Shapes
 */
export const cubicBezier = defineShape<
	CubicBezierProps,
	ShapeInstanceable | "from" | "control1" | "control2" | "to"
>({
	name: "CubicBezier",
	props: {
		...shapeProps,
		from: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		control1: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		control2: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		to: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	geometry: (props) => ({
		closed: false,
		curvePaths: [
			{
				start: props.from,
				segments: [
					{
						c1: props.control1,
						c2: props.control2,
						to: props.to,
					},
				],
				closed: false,
			},
		],
	}),
});

/** @category Shapes */
export interface QuadraticBezierProps extends ShapeProps {
	/** Start point in scene units. */
	from: Point;
	/** The single control point, in scene units. */
	control: Point;
	/** End point in scene units. */
	to: Point;
}

/**
 * A quadratic bezier from `from` to `to` with one control point.
 *
 * Drawn as the equivalent cubic. Open, so `fill` has no effect.
 *
 * @example
 * ```ts
 * import { createScene, quadraticBezier } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	quadraticBezier.create({ from: { x: -1, y: 0 }, control: { x: 0, y: 2 }, to: { x: 1, y: 0 } }),
 * );
 * ```
 *
 * @see {@link cubicBezier}
 *
 * @category Shapes
 */
export const quadraticBezier = defineShape<
	QuadraticBezierProps,
	ShapeInstanceable | "from" | "control" | "to"
>({
	name: "QuadraticBezier",
	props: {
		...shapeProps,
		from: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		control: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		to: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	geometry: (props) => {
		const [p0, c1, c2, p1] = quadraticToCubic(
			props.from,
			props.control,
			props.to,
		);
		return {
			closed: false,
			curvePaths: [
				{
					start: p0,
					segments: [{ c1, c2, to: p1 }],
					closed: false,
				},
			],
		};
	},
});
