/**
 * `regression`: a fitted trend (least squares or LOESS) with its confidence
 * band, one per `series`, drawn as one path batch (per fit a closed band
 * item, then an open line item) in a group whose clip the reveal sweeps.
 */

import type {
	CompositeContext,
	PathBatchItem,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { cssColor } from "@sophistry/core/internal";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, DateSink, PositionValue } from "../data/channels";
import {
	channelValues,
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
} from "../data/channels";
import type { Mapper } from "../end-space";
import { endSpace } from "../end-space";
import {
	createGroupJoin,
	layerTransition,
	sweepIn,
	transitionColor,
} from "../join";
import { morphArea } from "../math/morph";
import type { RegressionPoint } from "../math/regression";
import { regression as fitRegression, loessBand } from "../math/regression";
import { revealClipAlongX } from "../math/reveal";
import type { AnyDatum, SeriesTransitionProps } from "../props";
import type { Category, GroupKey } from "../series";
import { createSeries, groupIndices } from "../series";
import { keyedMemo } from "../util";
import type { CurveBatch } from "./shared";
import { createCurveBatch, groupColors, slotOf } from "./shared";

const DEFAULT_BAND_OPACITY = 0.2;
/** Robustness passes for `robust={true}`. */
const ROBUST_ITERATIONS = 2;

/**
 * Props of {@link regressionPlot}: `x` and `y` default to the index and the
 * datum when `data` is `number[]`; name them otherwise.
 *
 * @category Charts
 */
export interface RegressionProps<T = unknown> extends SeriesTransitionProps<T> {
	/** The points the fit is through: one per datum. */
	data: readonly T[];
	/**
	 * Predictor, in data units (a `Date` reads as epoch ms). Defaults to the index when `data` is
	 * `number[]`; required otherwise.
	 */
	x?: Channel<T, PositionValue>;
	/**
	 * Response, in data units. Defaults to the datum when `data` is `number[]`; required otherwise.
	 * Pairs with a non-finite member are dropped.
	 */
	y?: Channel<T, number>;
	/**
	 * The fit: `"linear"`, `"poly"` (a polynomial of `degree`) or `"loess"` (a local smooth over
	 * `bandwidth` of the points).
	 * @default "linear"
	 */
	method?: "linear" | "poly" | "loess";
	/**
	 * Polynomial degree for `method="poly"`.
	 * @default 2
	 */
	degree?: number;
	/**
	 * Fraction of the points each local fit uses, for `method="loess"`.
	 * @default 0.3
	 */
	bandwidth?: number;
	/**
	 * Make a `method="loess"` smooth robust to outliers: `true` for 2 re-weighting passes, or a
	 * number of passes.
	 * @default false
	 */
	robust?: boolean | number;
	/**
	 * Confidence level of the band around the fit, 0..1 (0 for no band): the fitted mean's t-band
	 * for least squares, the standard-error band for LOESS (see {@link loessBand}).
	 * @default 0.95
	 */
	level?: number;
	/**
	 * How many x positions the fit is drawn through.
	 * @default 50
	 */
	samples?: number;
	/**
	 * The category of each datum: one fit per category, coloured through the chart's shared colour
	 * scale and legend. `color` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * Line and band colour. Defaults to the `series` colour, else the theme's first series colour.
	 */
	color?: ColorInput;
	/**
	 * Band fill opacity, 0..1.
	 * @default 0.2
	 */
	bandOpacity?: number;
	/** Line width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/**
	 * Reveal, 0..1: the line and its band sweep in left to right together.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * The data to transition to, fits matched by `series`: shared fits morph with their bands, new
	 * ones sweep in, leaving ones fade out. See {@link SeriesTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the fits. */
	visible?: boolean;
}

type Fits = Map<GroupKey, RegressionPoint[]>;
interface FitShape {
	line: Point[];
	band: Point[];
}

/** One dataset's fits, one per group, in data units. */
function fitsOf(
	data: readonly unknown[],
	of: readonly Category[] | undefined,
	props: RegressionProps<AnyDatum>,
	dates: DateSink | null,
): Fits {
	const xs = numberValues(
		data,
		props.x as Channel<unknown, PositionValue>,
		indexOf,
		"x",
		dates,
	);
	const ys = numberValues(
		data,
		props.y as Channel<unknown, number>,
		identity,
		"y",
		dates,
	);
	const method = props.method ?? "linear";
	const out: Fits = new Map();
	for (const [key, indices] of groupIndices(xs.length, of)) {
		const x = indices.map((i) => xs[i] as number);
		const y = indices.map((i) => ys[i] as number);
		out.set(
			key,
			method === "loess"
				? loessBand(x, y, {
						bandwidth: props.bandwidth,
						samples: props.samples,
						level: props.level,
						iterations:
							props.robust === true
								? ROBUST_ITERATIONS
								: typeof props.robust === "number"
									? props.robust
									: 0,
					})
				: fitRegression(x, y, {
						degree: method === "poly" ? (props.degree ?? 2) : 1,
						level: props.level,
						samples: props.samples,
					}),
		);
	}
	return out;
}

/** A fit's line and band in scene units through `system` (an empty band when it has none). */
function shapeOf(points: readonly RegressionPoint[], system: Mapper): FitShape {
	return {
		line: points.map((p) => system.coordsToPoint(p.x, p.y)),
		// Unsigned, so a fit already in scene units under a reversed y keeps its band.
		band: points.some((p) => Math.abs(p.high - p.low) > 0)
			? [
					...points.map((p) => system.coordsToPoint(p.x, p.high)),
					...[...points].reverse().map((p) => system.coordsToPoint(p.x, p.low)),
				]
			: [],
	};
}

/** A fit through `coords`, read left to right, to morph mid-swap in that morph's units. */
function sceneFit(
	points: readonly RegressionPoint[],
	coords: Mapper,
): RegressionPoint[] {
	const out = points.map((p) => {
		const at = coords.coordsToPoint(p.x, p.y);
		return {
			x: at.x,
			y: at.y,
			low: coords.coordsToPoint(p.x, p.low).y,
			high: coords.coordsToPoint(p.x, p.high).y,
		};
	});
	return out.length > 1 &&
		(out[0] as RegressionPoint).x > (out[out.length - 1] as RegressionPoint).x
		? out.reverse()
		: out;
}

/**
 * A fit at update progress `u` between two fits: the fitted value and both band ends resampled onto
 * one shared x grid and blended per x, so the line stays inside its band.
 */
function morphFit(
	a: readonly RegressionPoint[],
	b: readonly RegressionPoint[],
	u: number,
): readonly RegressionPoint[] {
	if (u <= 0) return a;
	if (u >= 1) return b;
	const band = morphArea(
		a.map((p) => ({ x: p.x, y1: p.high, y2: p.low })),
		b.map((p) => ({ x: p.x, y1: p.high, y2: p.low })),
		u,
	);
	const line = morphArea(
		a.map((p) => ({ x: p.x, y1: p.y, y2: p.y })),
		b.map((p) => ({ x: p.x, y1: p.y, y2: p.y })),
		u,
	);
	return line.map((p, i) => ({
		x: p.x,
		y: p.y1,
		low: band[i]?.y2 ?? p.y1,
		high: band[i]?.y1 ?? p.y1,
	}));
}

/** What a regression keeps between updates. */
interface RegressionState {
	layer: ChartLayer;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	join: ReturnType<typeof createGroupJoin>;
	from: (deps: readonly unknown[], make: () => Fits) => Fits;
	to: (deps: readonly unknown[], make: () => Fits) => Fits;
	shapes: (
		deps: readonly unknown[],
		make: () => Map<GroupKey, FitShape>,
	) => Map<GroupKey, FitShape>;
	batch: CurveBatch;
}

const states = new WeakMap<object, RegressionState>();

function draw(ctx: CompositeContext<RegressionProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as RegressionState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("Regression must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined,
		mark: { line: true },
		dates,
	});
	const fitDeps = [
		props.x,
		props.y,
		props.method,
		props.degree,
		props.bandwidth,
		props.robust,
		props.level,
		props.samples,
		dates,
	];
	const fits = state.from([props.data, series.of, ...fitDeps], () =>
		fitsOf(props.data, series.of, props, dates),
	);
	const far = props.to;
	const toFits = far
		? state.to([far, props.series, ...fitDeps], () =>
				fitsOf(
					far,
					props.series === undefined
						? undefined
						: channelValues(far, props.series, undefined, "series", dates),
					props,
					dates,
				),
			)
		: undefined;
	const join = state.join({
		fromGroups: [...fits.keys()],
		toGroups: toFits ? [...toFits.keys()] : undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
	});
	const extentOf = (side: Fits) => {
		const points = [...side.values()].flat();
		return {
			x: { values: points.map((p) => p.x) },
			y: { values: points.flatMap((p) => [p.low, p.high]) },
		};
	};
	layer.report({
		...extentOf(fits),
		color: transitionColor(series.extent, join.toCategories),
		transition: layerTransition(
			join,
			props.staging,
			toFits ? extentOf(toFits) : {},
		),
	});
	const progress = layer.progress(props.progress) ?? 1;
	const space = endSpace(frame, coords);
	/** Each fit's line and band in scene units on this frame. */
	const shapes = state.shapes(
		[
			fits,
			toFits,
			coords,
			frame?.ends,
			frame?.join,
			join.active ? join.t : -1,
			join.active ? props.enterStagger : 0,
		],
		() => {
			const out = new Map<GroupKey, FitShape>();
			if (!toFits) {
				for (const [key, points] of fits) out.set(key, shapeOf(points, coords));
				return out;
			}
			for (const key of join.groups) {
				const a = fits.get(key);
				const b = toFits.get(key);
				// Mid-swap, each end's fit through its own plot, morphed in scene
				// units along the axis changing kind, data units along the other.
				if (a && b)
					out.set(
						key,
						space.morph(a, b, join.update, {
							scene: sceneFit,
							morph: morphFit,
							build: shapeOf,
						}),
					);
				else if (a) out.set(key, shapeOf(a, space.coords("from")));
				else if (b) {
					const whole = shapeOf(b, space.coords("to"));
					const cut = sweepIn(
						{
							lines: [whole.line],
							rings: whole.band.length > 0 ? [whole.band] : [],
						},
						join.enterOf(key as BandKey),
					);
					out.set(key, { line: cut.lines.flat(), band: cut.rings.flat() });
				}
			}
			return out;
		},
	);
	/** One front for every fit, across their joint extent. */
	const sweep = revealClipAlongX(
		[...shapes.values()].map((shape) =>
			shape.band.length > 0 ? shape.band : shape.line,
		),
		progress,
	);
	const groupColor = groupColors(layer, series, join);
	const fallback = cssColor(
		props.color ?? theme.palette.series[0] ?? theme.palette.foreground,
	);
	const items: [unknown, PathBatchItem][] = [];
	for (const key of join.groups) {
		const shape = shapes.get(key);
		// A leaving fit fades on the exit stage.
		const fade = join.fade(key);
		if (!shape || !(fade > 0)) continue;
		const color = groupColor(key) ?? fallback;
		const opacity = fade < 1 ? { opacity: fade } : {};
		if (shape.band.length > 0)
			items.push([
				slotOf(key, "band"),
				{
					closed: true,
					polylines: [shape.band],
					fill: color,
					stroke: "none",
					...opacity,
				},
			]);
		if (shape.line.length > 0)
			items.push([
				slotOf(key, "line"),
				{ closed: false, polylines: [shape.line], stroke: color, ...opacity },
			]);
	}
	state.batch.update(
		items,
		{
			stroke: fallback,
			strokeWidth: props.strokeWidth,
			fillOpacity: props.bandOpacity ?? DEFAULT_BAND_OPACITY,
			opacity: props.opacity,
			progress: progress > 0 ? 1 : 0,
			zIndex: props.zIndex,
			visible: props.visible,
		},
		sweep ?? undefined,
	);
	return [state.batch.node];
}

/**
 * A fitted trend with its confidence band over the data's x extent: least
 * squares (a line or polynomial) or a LOESS smooth. Draw it over a
 * `scatter` of the same data. See the `regression` and `loessBand` maths for
 * the fits alone.
 *
 * @example
 * ```ts
 * import { chart, regressionPlot, scatter } from "@sophistry/charts";
 *
 * const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, y: Math.sqrt(x) + Math.sin(x) / 4 }));
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [
 * 		scatter.create({ data: rows, x: "x", y: "y" }),
 * 		regressionPlot.create({ data: rows, x: "x", y: "y", method: "loess" }),
 * 	],
 * });
 * ```
 *
 * Exported as `regressionPlot` (definition name `"Regression"`): the
 * package entry already exports the `regression` fit from its maths.
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#lines-scatter-and-error-bars
 * @category Charts
 */
export const regressionPlot = defineComposite<RegressionProps<AnyDatum>>({
	name: "Regression",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		method: { invalidates: Invalidate.UPDATE },
		degree: { invalidates: Invalidate.UPDATE },
		bandwidth: { invalidates: Invalidate.UPDATE },
		robust: { invalidates: Invalidate.UPDATE },
		level: { invalidates: Invalidate.UPDATE },
		samples: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		bandOpacity: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		states.set(ctx.node, {
			layer,
			series: createSeries<AnyDatum>(layer),
			join: createGroupJoin(),
			from: keyedMemo(),
			to: keyedMemo(),
			shapes: keyedMemo(),
			batch: createCurveBatch(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
