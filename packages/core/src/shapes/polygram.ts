/**
 * Stars and polygrams: closed loops built where they sit (the centre is part
 * of the geometry).
 */

import type { Point, Polyline } from "../geometry";
import {
	closePolyline,
	polygramPolyline,
	polylineToCurvePath,
	starInnerRadius,
	starPolygon,
} from "../geometry";
import { Invalidate } from "../scene/context";
import {
	defineShape,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape";
import { openRing } from "./rect";

/** @category Shapes */
export interface StarProps extends ShapeProps {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** Distance from the centre to a spike. */
	outerRadius: number;
	/**
	 * Distance to a valley. Defaults to where the `{points/density}` polygram's
	 * chords cross, which is the star everyone actually draws.
	 */
	innerRadius?: number;
	/**
	 * Spike count.
	 * @default 5
	 */
	points?: number;
	/**
	 * Step between joined spikes when deriving the default `innerRadius`.
	 * @default 2
	 */
	density?: number;
	/**
	 * Absolute angle of the first spike, in radians, anticlockwise from +x.
	 * Defaults to `Math.PI / 2` (pointing up). This is geometry; to turn the
	 * whole shape use `ShapeProps.rotation`, which composes with it.
	 */
	startAngle?: number;
}

/**
 * A star with `points` spikes: Manim's `Star`.
 *
 * Spike tips sit on a circle of `outerRadius` and valleys on `innerRadius`, in
 * scene units.
 *
 * @example
 * ```ts
 * import { createScene, star } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(star.create({ outerRadius: 1, fill: "gold" }));
 * ```
 *
 * @see {@link regularPolygram}
 *
 * @category Shapes
 */
export const star = defineShape<
	StarProps,
	| ShapeInstanceable
	| "center"
	| "outerRadius"
	| "innerRadius"
	| "points"
	| "density"
	| "startAngle"
>({
	name: "Star",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		outerRadius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		innerRadius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		points: {
			default: 5,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		density: {
			default: 2,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		startAngle: {
			default: Math.PI / 2,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => {
		const points = props.points ?? 5;
		const ring = starPolygon(
			props.center?.x ?? 0,
			props.center?.y ?? 0,
			props.outerRadius,
			props.innerRadius ??
				starInnerRadius(props.outerRadius, points, props.density ?? 2),
			points,
			props.startAngle,
		);
		return {
			closed: true,
			curvePaths: [polylineToCurvePath(openRing(ring), true)],
		};
	},
});

/** @category Shapes */
export interface RegularPolygramProps extends ShapeProps {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** Circumradius in scene units. */
	radius: number;
	/** Number of vertices on the circle. */
	sides: number;
	/**
	 * Step between joined vertices: {5/2} is the pentagram.
	 * @default 2
	 */
	density?: number;
	/**
	 * Absolute angle of the first vertex, in radians, anticlockwise from +x.
	 * Defaults to `Math.PI / 2` (pointing up). This is geometry; to turn the
	 * whole shape use `ShapeProps.rotation`, which composes with it.
	 */
	startAngle?: number;
}

/**
 * Manim's `RegularPolygram`. When `density` shares a factor with `sides` the
 * figure really is several disjoint loops ({6/2} is two triangles), so this
 * emits one subpath per loop and a `draw` reveal draws them in turn.
 *
 * @example
 * ```ts
 * import { createScene, regularPolygram } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(regularPolygram.create({ radius: 1, sides: 5, density: 2 }));
 * ```
 *
 * @category Shapes
 */
export const regularPolygram = defineShape<
	RegularPolygramProps,
	ShapeInstanceable | "center" | "radius" | "sides" | "density" | "startAngle"
>({
	name: "RegularPolygram",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		radius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		sides: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		density: {
			default: 2,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		startAngle: {
			default: Math.PI / 2,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => {
		const rings = polygramPolyline(
			props.center?.x ?? 0,
			props.center?.y ?? 0,
			props.radius,
			props.sides,
			props.density ?? 2,
			props.startAngle,
		);
		return {
			closed: true,
			curvePaths: rings.map((ring) =>
				polylineToCurvePath(openRing(ring), true),
			),
		};
	},
});

/** @category Shapes */
export interface PolygramProps extends ShapeProps {
	/** One closed loop per group, vertices in scene units; the ring is closed for you. */
	vertexGroups: Polyline[];
}

/**
 * Manim's `Polygram`: an arbitrary bundle of closed loops as one shape.
 *
 * Use it when several outlines must reveal, fill and animate together as a
 * single node; for one loop, {@link polygon} is simpler.
 *
 * @example
 * ```ts
 * import { createScene, polygram } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	polygram.create({
 * 		vertexGroups: [
 * 			[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
 * 			[{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 1 }],
 * 		],
 * 	}),
 * );
 * ```
 *
 * @category Shapes
 */
export const polygram = defineShape<PolygramProps, ShapeInstanceable>({
	name: "Polygram",
	props: {
		...shapeProps,
		vertexGroups: { invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => {
		const rings = props.vertexGroups.map((group) => closePolyline(group));
		return {
			closed: true,
			curvePaths: rings.map((ring) =>
				polylineToCurvePath(openRing(ring), true),
			),
		};
	},
});
