/**
 * The arc family: arcs, pie slices, rings and ring slices. The outline is
 * built where it sits (the centre is part of the geometry).
 */

import type { Point } from "../geometry/index.js";
import {
	annularSectorCurvePath,
	annulusCurvePaths,
	arcBetweenPointsCurvePath,
	arcCurvePath,
	sectorCurvePath,
} from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import {
	defineShape,
	type ShapeGeometry,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape.js";

/** No sweep, nothing to draw: a zero-length stroke's round caps would paint a dot (an angle mark before its angle opens). */
const NOTHING: ShapeGeometry = { polylines: [], closed: false };

/** Whether a sweep is too small to draw. */
function noSweep(sweep: number): boolean {
	return !(Math.abs(sweep) > 1e-9);
}

/**
 * The arc family follows Manim's parameterization (a *start* angle plus a
 * signed *sweep*, not two absolute angles) because that's what animates
 * cleanly: growing an arc means driving one number from 0.
 *
 * @category Shapes
 */
export interface ArcProps extends ShapeProps {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** Radius in scene units. */
	radius: number;
	/**
	 * Where the arc starts, in radians measured from +x.
	 * @default 0
	 */
	startAngle?: number;
	/**
	 * Signed turn in radians; positive is counter-clockwise.
	 * @default Math.PI / 2
	 */
	angle?: number;
}

/** Descriptor entries for the centre, radius and sweep every arc-like shape takes. */
const arcProps = {
	center: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	radius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	startAngle: {
		default: 0,
		invalidates: Invalidate.GEOMETRY,
		instanceable: true,
	},
	angle: {
		default: Math.PI / 2,
		invalidates: Invalidate.GEOMETRY,
		instanceable: true,
	},
} as const;

/** The props an arc lets `instances()` drive per item. */
type ArcInstanceable =
	| ShapeInstanceable
	| "center"
	| "radius"
	| "startAngle"
	| "angle";

/**
 * A partial circle, drawn from `startAngle` through a signed sweep of `angle`.
 *
 * Open by default, so `fill` does nothing; use {@link sector} for a filled pie
 * slice. Because the sweep is a single number, growing an arc is just driving
 * `angle` from 0 with `valueTo`.
 *
 * @example
 * ```ts
 * import { arc, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(arc.create({ radius: 1, startAngle: 0, angle: Math.PI }));
 * ```
 *
 * @see {@link sector}
 * @see {@link arcBetweenPoints}
 *
 * @category Shapes
 */
export const arc = defineShape<ArcProps, ArcInstanceable>({
	name: "Arc",
	props: { ...shapeProps, ...arcProps },
	geometry: (props) => {
		const start = props.startAngle ?? 0;
		const sweep = props.angle ?? Math.PI / 2;
		if (noSweep(sweep)) return NOTHING;
		return {
			// Native curve geometry: the canvas renderer prefers `curvePaths` when
			// present, so this draws as an exact circular bézier.
			curvePaths: [
				arcCurvePath(
					props.center?.x ?? 0,
					props.center?.y ?? 0,
					props.radius,
					start,
					start + sweep,
				),
			],
			closed: false,
		};
	},
});

/** @category Shapes */
export interface ArcBetweenPointsProps extends ShapeProps {
	/** Start point in scene units. */
	from: Point;
	/** End point in scene units. */
	to: Point;
	/**
	 * Turn in radians; 0 degenerates to a straight line.
	 * @default Math.PI / 2
	 */
	angle?: number;
}

/**
 * The circular arc that leaves `from`, turns through `angle`, and lands on `to`.
 *
 * Use it for a curved connector between two known points; {@link arc} is the
 * one to reach for when you know the centre and radius instead.
 *
 * @example
 * ```ts
 * import { arcBetweenPoints, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(arcBetweenPoints.create({ from: { x: -1, y: 0 }, to: { x: 1, y: 0 } }));
 * ```
 *
 * @see {@link curvedArrow}
 *
 * @category Shapes
 */
export const arcBetweenPoints = defineShape<
	ArcBetweenPointsProps,
	ShapeInstanceable | "from" | "to" | "angle"
>({
	name: "ArcBetweenPoints",
	props: {
		...shapeProps,
		from: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		to: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		angle: {
			default: Math.PI / 2,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => ({
		// Native curve geometry: same `curvePaths`-preferred rendering as `arc`.
		curvePaths: [
			arcBetweenPointsCurvePath(
				props.from,
				props.to,
				props.angle ?? Math.PI / 2,
			),
		],
		closed: false,
	}),
});

/**
 * Props for {@link sector}; identical to {@link ArcProps}.
 *
 * @category Shapes
 */
export type SectorProps = ArcProps;

/**
 * A pie slice: the arc closed back through the centre, so it fills.
 *
 * Takes the same centre, radius, `startAngle` and `angle` as {@link arc}.
 *
 * @example
 * ```ts
 * import { createScene, sector } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(sector.create({ radius: 1, angle: Math.PI / 3, fill: "gold" }));
 * ```
 *
 * @category Shapes
 */
export const sector = defineShape<SectorProps, ArcInstanceable>({
	name: "Sector",
	props: { ...shapeProps, ...arcProps },
	geometry: (props) => {
		const start = props.startAngle ?? 0;
		const sweep = props.angle ?? Math.PI / 2;
		if (noSweep(sweep)) return NOTHING;
		return {
			// Native curve geometry: same `curvePaths`-preferred rendering as `arc`.
			curvePaths: [
				sectorCurvePath(
					props.center?.x ?? 0,
					props.center?.y ?? 0,
					props.radius,
					start,
					start + sweep,
				),
			],
			closed: true,
		};
	},
});

/** @category Shapes */
export interface AnnulusProps extends ShapeProps {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** Radius of the hole, in scene units. */
	innerRadius: number;
	/** Outer radius, in scene units. */
	outerRadius: number;
}

/** Descriptor entries for a ring's centre and radii. */
const ringProps = {
	center: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	innerRadius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	outerRadius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
} as const;

/** The props a ring lets `instances()` drive per item. */
type RingInstanceable =
	| ShapeInstanceable
	| "center"
	| "innerRadius"
	| "outerRadius";

/**
 * A ring between `innerRadius` and `outerRadius`; `fill` colours only the band
 * between them.
 *
 * The two circles are wound in opposite directions, which the canvas's
 * non-zero fill rule reads as a genuine hole: see `annulusPolylines` for why
 * that is a trick rather than a feature.
 *
 * @example
 * ```ts
 * import { annulus, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(annulus.create({ innerRadius: 0.5, outerRadius: 1, fill: "teal" }));
 * ```
 *
 * @see {@link annularSector}
 *
 * @category Shapes
 */
export const annulus = defineShape<AnnulusProps, RingInstanceable>({
	name: "Annulus",
	props: { ...shapeProps, ...ringProps },
	geometry: (props) => ({
		// Native curve geometry: same `curvePaths`-preferred rendering as `arc`.
		curvePaths: annulusCurvePaths(
			props.center?.x ?? 0,
			props.center?.y ?? 0,
			props.innerRadius,
			props.outerRadius,
		),
		closed: true,
	}),
});

/** @category Shapes */
export interface AnnularSectorProps extends AnnulusProps {
	/**
	 * Where the slice starts, in radians from +x.
	 * @default 0
	 */
	startAngle?: number;
	/**
	 * Signed sweep in radians; positive is counter-clockwise.
	 * @default Math.PI / 2
	 */
	angle?: number;
}

/**
 * A slice of a ring: one simple closed loop, so it fills without tricks.
 *
 * @example
 * ```ts
 * import { annularSector, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	annularSector.create({ innerRadius: 0.5, outerRadius: 1, angle: Math.PI / 2, fill: "teal" }),
 * );
 * ```
 *
 * @see {@link annulus}
 *
 * @category Shapes
 */
export const annularSector = defineShape<
	AnnularSectorProps,
	RingInstanceable | "startAngle" | "angle"
>({
	name: "AnnularSector",
	props: {
		...shapeProps,
		...ringProps,
		startAngle: arcProps.startAngle,
		angle: arcProps.angle,
	},
	geometry: (props) => {
		const start = props.startAngle ?? 0;
		const sweep = props.angle ?? Math.PI / 2;
		if (noSweep(sweep)) return NOTHING;
		return {
			// Native curve geometry: same `curvePaths`-preferred rendering as `arc`.
			curvePaths: [
				annularSectorCurvePath(
					props.center?.x ?? 0,
					props.center?.y ?? 0,
					props.innerRadius,
					props.outerRadius,
					start,
					start + sweep,
				),
			],
			closed: true,
		};
	},
});
