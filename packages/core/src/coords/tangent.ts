/**
 * `tangentLine` — the tangent to a sampled curve at a point along it.
 *
 * It lives in its own file rather than beside `line`, because it has nothing to
 * do with lines-between-two-points: everything here is about *sampling a curve*,
 * which is the same job `plot` does, and it shares that shape's `function`/`from`/
 * `to` vocabulary.
 */

import type { ArcTable, Point, Polyline } from "../geometry";
import {
	measure,
	plotPolyline,
	pointAtT,
	polylineToCurvePath,
} from "../geometry";
import { Invalidate } from "../scene/context";
import type { ShapeInstanceable, ShapeProps } from "../scene/shape";
import { defineShape, shapeProps } from "../scene/shape";

/**
 * Half-width of the central difference, as a fraction of the curve's arc
 * length. Small enough that the chord hugs the curve on anything smooth, large
 * enough to span several vertices of a default-density `plot` — see the note on
 * `epsilon` below for why both matter.
 */
const DEFAULT_EPSILON = 0.005;
const DEFAULT_SAMPLES = 160;

/** @category Coordinate systems & graphs */
export interface TangentLineProps extends ShapeProps {
	/** An already-sampled curve in scene units. Takes precedence over `function`/`from`/`to`. */
	points?: Polyline;
	/** Or sample one, exactly as `plot` does. */
	function?: (t: number) => Point;
	/**
	 * Parameter value where sampling `function` starts.
	 * @default 0
	 */
	from?: number;
	/**
	 * Parameter value where sampling `function` ends.
	 * @default 1
	 */
	to?: number;
	/**
	 * Number of samples taken from `function`.
	 * @default 160
	 */
	samples?: number;
	/**
	 * Where along the curve, 0..1 by arc length (clamped). Defaults to the midpoint.
	 * @default 0.5
	 */
	proportion?: number;
	/**
	 * Length of the tangent segment, centred on the point.
	 * @default 1
	 */
	length?: number;
	/**
	 * Half-width of the central difference, as a fraction of arc length.
	 *
	 * Shrink it and the difference collapses inside one polyline segment, so you
	 * read that segment's slope — exact for a polyline, faceted on a curve that
	 * was flattened coarsely. Grow it and you read a chord across real curvature,
	 * which under-reports the slope wherever the curve bends. The default sits
	 * between the two for a curve sampled at `plot`'s density. Defaults to 0.005.
	 */
	epsilon?: number;
}

/** Zero-length is not a direction; fall back to horizontal rather than NaN. */
function directionBetween(before: Point, after: Point): Point {
	const dx = after.x - before.x;
	const dy = after.y - before.y;
	const magnitude = Math.hypot(dx, dy);
	if (magnitude === 0) return { x: 1, y: 0 };
	return { x: dx / magnitude, y: dy / magnitude };
}

/** The inputs the curve (and so its arc-length table) was built from. */
interface CurveInputs {
	points: Polyline | undefined;
	function: ((t: number) => Point) | undefined;
	from: number;
	to: number;
	samples: number;
	table: ArcTable;
}

/**
 * Each node's last curve and arc-length table, keyed on its props object.
 *
 * Split from the outline on purpose:
 * `proportion` typically animates, and the arc-length table depends only on
 * the curve. Measuring 160 samples on every frame of a sweep would be the most
 * expensive thing in the scene.
 */
const tables = new WeakMap<object, CurveInputs>();

function tableOf(props: Readonly<TangentLineProps>): ArcTable {
	const from = props.from ?? 0;
	const to = props.to ?? 1;
	const samples = props.samples ?? DEFAULT_SAMPLES;
	const last = tables.get(props);
	if (
		last &&
		last.points === props.points &&
		(props.points !== undefined ||
			(last.function === props.function &&
				last.from === from &&
				last.to === to &&
				last.samples === samples))
	) {
		return last.table;
	}
	let curve: Polyline;
	if (props.points) curve = props.points;
	else if (!props.function) curve = [];
	else curve = plotPolyline(props.function, from, to, samples);
	const table = measure(curve);
	tables.set(props, {
		points: props.points,
		function: props.function,
		from,
		to,
		samples,
		table,
	});
	return table;
}

/**
 * The tangent to a curve at `proportion` of its arc length (Manim's
 * `TangentLine`), from a central difference along the sampled polyline: exact on
 * a polyline, approximate on a smooth curve, one-sided at the ends. Raise
 * `samples` for accuracy; for an exact slope on a graph use `tangentToGraph`.
 *
 * @example
 * ```ts
 * import { createScene, tangentLine } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const tangent = scene.root.add(
 * 	tangentLine.create({ function: (t) => ({ x: t, y: t * t }), from: -2, to: 2, length: 2 }),
 * );
 * tangent.set("proportion", 0.8); // slides along; the curve is not re-measured
 * ```
 *
 * @see {@link plot}
 * @category Coordinate systems & graphs
 */
export const tangentLine = defineShape<
	TangentLineProps,
	ShapeInstanceable | "proportion" | "length"
>({
	name: "TangentLine",
	props: {
		...shapeProps,
		points: { invalidates: Invalidate.GEOMETRY },
		function: { invalidates: Invalidate.GEOMETRY },
		from: { default: 0, invalidates: Invalidate.GEOMETRY },
		to: { default: 1, invalidates: Invalidate.GEOMETRY },
		samples: { default: DEFAULT_SAMPLES, invalidates: Invalidate.GEOMETRY },
		proportion: {
			default: 0.5,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		length: {
			default: 1,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		epsilon: { default: DEFAULT_EPSILON, invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => {
		const table = tableOf(props);
		if (table.points.length < 2) return { polylines: [], closed: false };

		const proportion = Math.min(1, Math.max(0, props.proportion ?? 0.5));
		const epsilon = props.epsilon ?? DEFAULT_EPSILON;
		const before = pointAtT(table, Math.max(0, proportion - epsilon));
		const after = pointAtT(table, Math.min(1, proportion + epsilon));

		const at = pointAtT(table, proportion);
		const direction = directionBetween(before, after);
		const half = (props.length ?? 1) / 2;
		const start: Point = {
			x: at.x - direction.x * half,
			y: at.y - direction.y * half,
		};
		const end: Point = {
			x: at.x + direction.x * half,
			y: at.y + direction.y * half,
		};
		return {
			closed: false,
			curvePaths: [polylineToCurvePath([start, end], false)],
		};
	},
});
