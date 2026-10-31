/**
 * Polygons: explicit vertices (built where they sit), or a regular n-gon
 * built about the origin and placed by its `center` (the shape's `offset`).
 */

import type { Point, Polyline } from "../geometry";
import { polylineToCurvePath, regularPolygon } from "../geometry";
import { Invalidate } from "../scene/context";
import {
	defineShape,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape";
import { openRing } from "./rect";

/** @category Shapes */
export interface PolygonProps extends ShapeProps {
	/** Explicit vertices, in scene units. When given, the regular-polygon props are ignored. */
	points?: Polyline;
	/** Centre of a regular polygon. Defaults to the origin. */
	center?: Point;
	/**
	 * Circumradius of a regular polygon.
	 * @default 1
	 */
	radius?: number;
	/**
	 * Side count of a regular polygon.
	 * @default 3
	 */
	sides?: number;
	/** Radians; offsets the first vertex of a regular polygon. */
	tilt?: number;
}

/**
 * A closed polygon: either explicit `points`, or a regular n-gon from
 * `center`/`radius`/`sides`.
 *
 * The outline is closed for you, so do not repeat the first point at the end.
 *
 * @example
 * ```ts
 * import { createScene, polygon } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(polygon.create({ sides: 6, radius: 1, fill: "orange" }));
 * scene.root.add(polygon.create({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }));
 * ```
 *
 * @see {@link polygram}
 *
 * @category Shapes
 */
export const polygon = defineShape<
	PolygonProps,
	ShapeInstanceable | "center" | "radius" | "sides" | "tilt"
>({
	name: "Polygon",
	props: {
		...shapeProps,
		points: { invalidates: Invalidate.GEOMETRY },
		// Read by `offset` alone: a move is a new matrix, never a new outline.
		// `points` decides whether the centre applies at all, and is GEOMETRY.
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		radius: {
			default: 1,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		sides: { default: 3, invalidates: Invalidate.GEOMETRY, instanceable: true },
		tilt: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	},
	geometry: (props) => {
		if (props.points) {
			return {
				closed: true,
				curvePaths: [polylineToCurvePath(openRing(props.points), true)],
			};
		}
		// A regular polygon's outline about the origin.
		const ring = regularPolygon(
			0,
			0,
			props.radius ?? 1,
			props.sides ?? 3,
			props.tilt,
		);
		return {
			closed: true,
			curvePaths: [polylineToCurvePath(openRing(ring), true)],
		};
	},
	// A regular polygon's centre, read on its own; see `rect`. Explicit
	// `points` are already where they go.
	offset: (props) => (props.points ? undefined : props.center),
});
