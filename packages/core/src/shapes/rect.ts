/**
 * Rectangles and squares, positioned by their centre like `circle`: the
 * outline is built about the origin and the centre is the shape's `offset`.
 */

import type { CornerRadii, Point, Polyline } from "../geometry/index.js";
import { roundedRectCurvePath } from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import {
	defineShape,
	type ShapeGeometry,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape.js";

/**
 * Drops a ring's synthetic closing point (first point repeated at the end),
 * if present: `CurvePath`'s `closed: true` supplies that edge implicitly, so
 * `polylineToCurvePath` wants the bare vertex list, unlike the `Polyline`
 * rings `rectPolyline` builds.
 */
export function openRing(points: Polyline): Polyline {
	if (points.length < 2) return points;
	const first = points[0] as Point;
	const last = points[points.length - 1] as Point;
	return first.x === last.x && first.y === last.y
		? points.slice(0, -1)
		: points;
}

/**
 * A `width` by `height` box about the origin. Corners are true curves:
 * `cornerRadii` gives each its own radius, otherwise `cornerRadius` rounds
 * all four.
 */
function boxGeometry(
	width: number,
	height: number,
	cornerRadius = 0,
	cornerRadii?: CornerRadii,
): ShapeGeometry {
	return {
		closed: true,
		curvePaths: [
			roundedRectCurvePath(
				-width / 2,
				-height / 2,
				width,
				height,
				cornerRadii ?? cornerRadius,
			),
		],
	};
}

/** Whether a box has any rounded corner. */
function isRounded(cornerRadius = 0, cornerRadii?: CornerRadii): boolean {
	if (cornerRadii) {
		return cornerRadii.some((radius) =>
			typeof radius === "number" ? radius > 0 : radius.x > 0 && radius.y > 0,
		);
	}
	return cornerRadius > 0;
}

/** @category Shapes */
export interface RectProps extends ShapeProps {
	/** Centre in scene units, consistent with `circle` and `polygon`. Defaults to the origin. */
	center?: Point;
	/** Width in scene units. */
	width: number;
	/** Height in scene units. */
	height: number;
	/**
	 * Corner radius. Sharp corners by default.
	 * @default 0
	 */
	cornerRadius?: number;
	/**
	 * A radius per corner, clockwise from the top left (as seen on a y-up
	 * stage); each may be `{ x, y }` for an elliptical corner. Overrides
	 * `cornerRadius`. Radii too large for the box shrink together, as in CSS.
	 */
	cornerRadii?: CornerRadii;
}

/**
 * An axis-aligned rectangle given by its centre, `width` and `height`.
 *
 * Note it is positioned by its *centre* (`center`), not a corner, matching
 * {@link circle}. Use `cornerRadius` for rounded corners, and the generic
 * `rotation` prop to tilt it about its centre.
 *
 * @example
 * ```ts
 * import { createScene, rect } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(rect.create({ width: 4, height: 2, cornerRadius: 0.2 }));
 * ```
 *
 * @see {@link square}
 *
 * @category Shapes
 */
export const rect = defineShape<
	RectProps,
	ShapeInstanceable | "center" | "width" | "height" | "cornerRadius"
>({
	name: "Rect",
	props: {
		...shapeProps,
		// Read by `offset` alone: a move is a new matrix, never a new outline.
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		width: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		height: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		cornerRadius: {
			default: 0,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		cornerRadii: { invalidates: Invalidate.GEOMETRY },
	},
	// The outline about the origin, rebuilt only when the size or corners change.
	geometry: (props) =>
		boxGeometry(
			props.width,
			props.height,
			props.cornerRadius,
			props.cornerRadii,
		),
	// The centre is read on its own, so a move never reruns the outline.
	offset: (props) => props.center,
	// Square-cornered boxes draw as rect marks: the renderer's splat fast path.
	instanceMark: (props) =>
		isRounded(props.cornerRadius, props.cornerRadii)
			? null
			: {
					kind: "rect",
					halfWidth: props.width / 2,
					halfHeight: props.height / 2,
				},
});

/** @category Shapes */
export interface SquareProps extends Omit<RectProps, "width" | "height"> {
	/** Side length in scene units. */
	size: number;
}

/**
 * A {@link rect} with equal sides of length `size`, centred on `center`.
 *
 * @example
 * ```ts
 * import { createScene, square } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(square.create({ size: 1, center: { x: 2, y: 0 } }));
 * ```
 *
 * @category Shapes
 */
export const square = defineShape<
	SquareProps,
	ShapeInstanceable | "center" | "size" | "cornerRadius"
>({
	name: "Square",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		size: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		cornerRadius: {
			default: 0,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		cornerRadii: { invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) =>
		boxGeometry(props.size, props.size, props.cornerRadius, props.cornerRadii),
	offset: (props) => props.center,
	instanceMark: (props) =>
		isRounded(props.cornerRadius, props.cornerRadii)
			? null
			: { kind: "rect", halfWidth: props.size / 2, halfHeight: props.size / 2 },
});
