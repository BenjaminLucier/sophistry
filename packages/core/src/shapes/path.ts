/**
 * The general-purpose shapes: `path` (SVG path data, or polylines/curves you
 * own and animate) and `plot` (a sampled parametric function).
 */

import type { CurvePath, Polyline } from "../geometry";
import {
	pathDataToCurvePath,
	plotPolyline,
	polylineToCurvePath,
} from "../geometry";
import { Invalidate } from "../scene/context";
import {
	defineShape,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape";

/** @category Shapes */
export interface PathProps extends ShapeProps {
	/** SVG path data. Ignored when `points` or `curvePoints` is given. */
	pathData?: string;
	/**
	 * Explicit polyline geometry: what `morph()` drives. Ignored when
	 * `curvePoints` is given; ignores `pathData`.
	 */
	points?: Polyline | Polyline[];
	/**
	 * Explicit curve geometry: the native-curve sibling of `points`, what
	 * `morphCurve()` drives. Every intermediate frame stays an exact bezier
	 * (control points lerp directly) rather than a resampled polyline, so
	 * prefer this over `points` when animating curve-native shapes
	 * (`cubicBezier`/`quadraticBezier`/curved `pathData`). Takes precedence
	 * over `points` and `pathData` when given.
	 */
	curvePoints?: CurvePath | CurvePath[];
	/**
	 * Treat the path as closed, so it can be filled. Defaults to false for
	 * `points`/`curvePoints`, and for `pathData` to whether any subpath ends in `Z`.
	 */
	closed?: boolean;
}

function normalize(points: Polyline | Polyline[]): Polyline[] {
	if (points.length === 0) return [];
	return Array.isArray(points[0])
		? (points as Polyline[])
		: [points as Polyline];
}

function normalizeCurves(curves: CurvePath | CurvePath[]): CurvePath[] {
	return Array.isArray(curves) ? curves : [curves];
}

/**
 * The general-purpose shape: raw SVG path data, or a polyline/curve you own
 * and animate.
 *
 * Geometry is taken from the first of `curvePoints`, `points`, `pathData` that is
 * given. All coordinates are scene units, with y up. `morph()` writes to an
 * `Animatable<Polyline>` (a `Track<Polyline>` is one) which you bind as
 * `points`; `morphCurve()` writes to an `Animatable<CurvePath>` which you
 * bind as `curvePoints`.
 *
 * @example
 * ```ts
 * import { createScene, path } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(path.create({ pathData: "M 0 0 L 1 1 L 2 0 Z", fill: "plum" }));
 * ```
 *
 * @see {@link plot}
 *
 * @category Shapes
 */
export const path = defineShape<PathProps, ShapeInstanceable>({
	name: "Path",
	props: {
		...shapeProps,
		pathData: { invalidates: Invalidate.GEOMETRY },
		points: { invalidates: Invalidate.GEOMETRY },
		curvePoints: { invalidates: Invalidate.GEOMETRY },
		closed: { invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => {
		if (props.curvePoints) {
			const curves = normalizeCurves(props.curvePoints);
			return {
				closed: props.closed ?? false,
				curvePaths: curves,
			};
		}
		if (props.points) {
			return {
				polylines: normalize(props.points),
				closed: props.closed ?? false,
			};
		}
		if (!props.pathData) return { polylines: [], closed: false };
		const curves = pathDataToCurvePath(props.pathData);
		return {
			closed: props.closed ?? curves.some((curve) => curve.closed),
			curvePaths: curves,
		};
	},
});

/** @category Shapes */
export interface PlotProps extends ShapeProps {
	/** Sampled over `[from, to]`; return a point in scene units. */
	function: (t: number) => { x: number; y: number };
	/** Parameter value where sampling starts. */
	from: number;
	/** Parameter value where sampling ends. */
	to: number;
	/**
	 * Number of samples taken.
	 * @default 160
	 */
	samples?: number;
}

/**
 * Samples a parametric function into an open path: graphs, spirals,
 * trajectories.
 *
 * `function(t)` maps a parameter in `[from, to]` to a point in scene units.
 * For `y = g(x)` return `{ x: t, y: g(t) }`. The curve is resampled when
 * `function`, `from`, `to` or `samples` is written; for a function of some
 * other value, write a new function (or bind one with `derive`).
 *
 * @example
 * ```ts
 * import { createScene, plot } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(plot.create({ function: (t) => ({ x: t, y: Math.sin(t) }), from: -3, to: 3 }));
 * ```
 *
 * @see {@link path}
 *
 * @category Shapes
 */
export const plot = defineShape<
	PlotProps,
	ShapeInstanceable | "from" | "to" | "samples"
>({
	name: "Plot",
	props: {
		...shapeProps,
		function: { invalidates: Invalidate.GEOMETRY },
		from: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		to: { invalidates: Invalidate.GEOMETRY, instanceable: true },
		samples: {
			default: 160,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => {
		const polyline = plotPolyline(
			props.function,
			props.from,
			props.to,
			props.samples ?? 160,
		);
		return {
			curvePaths: [polylineToCurvePath(polyline, false)],
			closed: false,
		};
	},
});
