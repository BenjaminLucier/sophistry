/**
 * Circles and ellipses: the reference shapes. Each is a descriptor plus a
 * `geometry` function building the outline about the origin; the centre is
 * the shape's `offset`, so moving one changes a matrix, never its outline.
 */

import type { Point } from "../geometry";
import { arcCurvePath, ellipseCurvePath } from "../geometry";
import { Invalidate } from "../scene/context";
import {
	defineShape,
	type ShapeGeometry,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape";

/** The radius {@link lastCircle} was built for. */
let lastRadius = Number.NaN;
let lastCircle: ShapeGeometry | null = null;

/**
 * A circle's outline about the origin. Outlines are immutable, so circles of
 * one radius share the last one built: a scene rebuilt with thousands of
 * equal dots traces the arcs once, and the renderer, whose path caches key on
 * the outline's identity, builds one path for all of them.
 */
function circleOutline(radius: number): ShapeGeometry {
	if (lastCircle && Object.is(radius, lastRadius)) return lastCircle;
	lastCircle = {
		closed: true,
		curvePaths: [
			{
				// `arcCurvePath` returns an open arc (see its own doc comment); a
				// full circle just needs `closed: true` on top, the same pattern
				// as `annulusCurvePaths`'s two full-circle rings.
				...arcCurvePath(0, 0, radius, 0, Math.PI * 2),
				closed: true,
			},
		],
	};
	lastRadius = radius;
	return lastCircle;
}

/** @category Shapes */
export interface CircleProps extends ShapeProps {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** Radius in scene units. */
	radius: number;
}

/**
 * A circle of `radius` centred on `center`, in scene units.
 *
 * It is drawn as exact bezier curves, so it stays smooth at any zoom. Pass
 * `fill` for a disc, and drive `progress` (via `draw()`) to draw the outline
 * from the +x axis counter-clockwise.
 *
 * @example
 * ```ts
 * import { circle, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const node = scene.root.add(circle.create({ radius: 2, fill: "tomato" }));
 * node.set("center", { x: 1, y: 0 }); // a move: the outline is kept
 * node.set("radius", 3); // reruns the outline
 * ```
 *
 * @see {@link ellipse}
 *
 * @category Shapes
 */
export const circle = defineShape<
	CircleProps,
	ShapeInstanceable | "center" | "radius"
>({
	name: "Circle",
	props: {
		...shapeProps,
		// Read by `offset` alone: a move is a new matrix, never a new outline.
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		radius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	// The outline about the origin, rebuilt only when the radius changes.
	geometry: (props) => circleOutline(props.radius),
	// The centre is read on its own, so a move never reruns the outline.
	offset: (props) => props.center,
	// `instances(circle, ...)` draws discs: the renderer's splat fast path.
	instanceMark: (props) => ({ kind: "circle", radius: props.radius }),
});

/** @category Shapes */
export interface EllipseProps extends ShapeProps {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** Horizontal semi-axis in scene units (before `tilt`). */
	radiusX: number;
	/** Vertical semi-axis in scene units (before `tilt`). */
	radiusY: number;
	/**
	 * Rotation of the ellipse about its centre, in radians.
	 * @default 0
	 */
	tilt?: number;
}

/**
 * An ellipse with semi-axes `radiusX` and `radiusY`, optionally rotated by `tilt`.
 *
 * `tilt` rotates the ellipse as part of its geometry; the generic `rotation`
 * prop rotates it again afterwards, about the shape's centre by default.
 *
 * @example
 * ```ts
 * import { createScene, ellipse } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(ellipse.create({ radiusX: 2, radiusY: 1, tilt: Math.PI / 6 }));
 * ```
 *
 * @see {@link circle}
 *
 * @category Shapes
 */
export const ellipse = defineShape<
	EllipseProps,
	ShapeInstanceable | "center" | "radiusX" | "radiusY" | "tilt"
>({
	name: "Ellipse",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		radiusX: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		radiusY: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		tilt: { default: 0, invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	geometry: (props) => {
		// `props.tilt` is radians (see prop doc); `ellipseCurvePath`'s
		// `rotationDeg` expects degrees, matching `arcCubics`'s own convention
		// (`phi = (rotationDeg * Math.PI) / 180` in geometry/path/cubic.ts).
		const tiltDeg = ((props.tilt ?? 0) * 180) / Math.PI;
		return {
			closed: true,
			curvePaths: [
				ellipseCurvePath(0, 0, props.radiusX, props.radiusY, tiltDeg),
			],
		};
	},
	// The centre is read on its own, so a move never reruns the outline.
	offset: (props) => props.center,
});
