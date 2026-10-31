/**
 * `errorBar`: a marker per datum with capped vertical and horizontal error
 * bars, drawn as two instances nodes.
 *
 * Follows `points/scatter.ts` step for step. Every bar and cap of every
 * point is one item of a `line` instances node (keyed by the datum's key and
 * the part: `y`, `y0`, `y1`, `x`, `x0`, `x1`), every marker one item of a
 * `circle` instances node (keyed by the datum's key). The bars draw first
 * and the markers over them.
 *
 * The reveal is geometry: each bar grows out of its marker
 * (its ends `shown` of the way out) and its caps widen with it, so a bar is
 * drawn whole once it has begun; the marker traces its outline as its fill
 * comes up (its item's `progress`).
 * Under the mark's `transition`, an entering bar draws out of its marker
 * and a leaving one draws back into it; markers grow and shrink.
 */

import type {
	CircleProps,
	CompositeContext,
	LineProps,
	SceneNode,
} from "@sophistry/core";
import { circle, defineComposite, Invalidate, line } from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import type { BatchItem, MarkTransition } from "../batch";
import { createBatchedMark } from "../batch";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type {
	Channel,
	ColorChannel,
	DateSink,
	PositionValue,
} from "../data/channels";
import {
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
	resolveChannel,
	resolveColor,
} from "../data/channels";
import { endSpace } from "../end-space";
import type { JoinEnd, JoinFrame } from "../join";
import {
	createKeyedData,
	joinFrames,
	layerTransition,
	transitionColor,
} from "../join";
import type { ErrorBarPoint } from "../math/errorbar";
import { errorBarPoints } from "../math/errorbar";
import type { KeyedJoin } from "../math/join";
import { mixPaint } from "../mix";
import type {
	AnyDatum,
	KeyedTransitionProps,
	RevealProps,
	StaggerOrder,
} from "../props";
import { createSeries } from "../series";
import { orderRanks, staggered } from "../stagger";
import { mix } from "../util";

const DEFAULT_MARKER_RADIUS = 0.09;
const DEFAULT_CAP_SIZE = 0.15;

/**
 * An error magnitude: a symmetric `±e`, or an asymmetric `[lower, upper]` pair.
 *
 * @category Charts
 */
export type ErrorMagnitude = number | readonly [lower: number, upper: number];

/**
 * Props of {@link errorBar}. `x` and `y` are required unless `data` is
 * `number[]` (x = index, y = value).
 *
 * @category Charts
 */
export interface ErrorBarProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One marker (with optional bars) per datum; data with a non-finite `x` or `y` are skipped. */
	data: readonly T[];
	/**
	 * X position, in data units (a `Date` reads as epoch ms). Defaults to the index when `data` is
	 * `number[]`; required otherwise.
	 */
	x?: Channel<T, PositionValue>;
	/**
	 * Y position, in data units (a `Date` reads as epoch ms). Defaults to the datum when `data` is
	 * `number[]`; required otherwise.
	 */
	y?: Channel<T, PositionValue>;
	/**
	 * Vertical error, in data units: a symmetric `±e` or an asymmetric `[lower, upper]`. A datum
	 * without a finite magnitude gets no bar.
	 */
	yError?: Channel<T, ErrorMagnitude>;
	/** Horizontal error, in data units; same forms as `yError`. */
	xError?: Channel<T, ErrorMagnitude>;
	/**
	 * The series each point belongs to: colours markers and bars through the chart's shared colour
	 * scale and legend. `color` and `stroke` win.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * Each point's identity across data changes and transitions. See {@link KeyedTransitionProps}.
	 * Defaults to the datum's place within its `series`, else its index.
	 */
	key?: Channel<T, BandKey>;
	/**
	 * Colour of the marker and both bars, constant or `(d, i) => colour`. Defaults to `stroke`,
	 * else the `series` colour, else the theme's first series colour.
	 */
	color?: ColorChannel<T>;
	/**
	 * Marker radius.
	 * @default 0.09
	 */
	markerRadius?: number;
	/**
	 * Width of the caps at each end of a bar.
	 * @default 0.15
	 */
	capSize?: number;
	/**
	 * Fraction of the reveal spent staggering point after point, left to right, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/**
	 * The order `stagger` and `enterStagger` take. See {@link StaggerOrder}.
	 * @default "position"
	 */
	staggerOrder?: StaggerOrder;
	/**
	 * Fraction of a transition's enter stage spent staggering entering points, in `staggerOrder`.
	 * See {@link TransitionProps}.
	 * @default 0
	 */
	enterStagger?: number;
	/**
	 * The data to transition to, matched to `data` by `key`: markers and bar ends move to their new
	 * places; new points fade in with bars drawing outward, removed ones draw back in. See {@link
	 * KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/**
	 * How points move when `data` changes (outside a `to` blend): a tween or
	 * a spring in the nodes' tween banks; new bars draw out of their markers,
	 * removed ones draw back in. Omitted, data changes are instant.
	 */
	transition?: MarkTransition;
	/** Colour of marker and bars when neither `color` nor `series` gives one (a colour; batched items take no gradients). */
	stroke?: string;
	/** Bar thickness. Defaults to the theme's stroke width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1: each bar grows out of its marker, which draws in. @default 1 */
	progress?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the points. */
	visible?: boolean;
}

/** Splits a per-datum {@link ErrorMagnitude} channel into the `[lower[], upper[]]` form `errorBarPoints` takes. */
function errorSpec<T>(
	data: readonly T[],
	channel: Channel<T, ErrorMagnitude> | undefined,
	name: string,
): [number[], number[]] | undefined {
	const read = resolveChannel(channel, undefined, name);
	if (!read) return undefined;
	const lower: number[] = [];
	const upper: number[] = [];
	data.forEach((d, i) => {
		const e = read(d, i) as ErrorMagnitude | undefined;
		if (typeof e === "number") {
			lower.push(e);
			upper.push(e);
		} else if (Array.isArray(e)) {
			lower.push(e[0] as number);
			upper.push(e[1] as number);
		} else {
			lower.push(Number.NaN);
			upper.push(Number.NaN);
		}
	});
	return [lower, upper];
}

/** A point in data units: its marker, its bars' ends (along their own axis), and its colour. */
interface PointState {
	x: number;
	y: number;
	/** The vertical bar's `[low, high]` y, at `x`. */
	yBar: readonly [number, number] | undefined;
	/** The horizontal bar's `[low, high]` x, at `y`. */
	xBar: readonly [number, number] | undefined;
	color: string;
}

/** A bar's ends blended at `u`; a bar one end lacks is a zero-length one at that end's marker. */
function blendBar(
	a: readonly [number, number] | undefined,
	b: readonly [number, number] | undefined,
	atA: number,
	atB: number,
	u: number,
): readonly [number, number] | undefined {
	if (!a && !b) return undefined;
	const [a0, a1] = a ?? [atA, atA];
	const [b0, b1] = b ?? [atB, atB];
	return [mix(a0, b0, u), mix(a1, b1, u)];
}

/** Two points blended at `u`: positions and bars in data units, colours in OKLCH. */
function blendPoint(a: PointState, b: PointState, u: number): PointState {
	return {
		x: mix(a.x, b.x, u),
		y: mix(a.y, b.y, u),
		yBar: blendBar(a.yBar, b.yBar, a.y, b.y, u),
		xBar: blendBar(a.xBar, b.xBar, a.x, b.x, u),
		color: mixPaint(a.color, b.color, u),
	};
}

/** One bar or cap on a frame, in scene units. */
interface Segment extends BatchItem {
	from: Point;
	to: Point;
	stroke: string;
	/** The marker it grows out of (where it enters from and exits to). */
	anchor: Point;
}

/** One marker on a frame. */
interface Marker extends BatchItem {
	center: Point;
	radius: number;
	fill: string;
	/** Its reveal and presence together, 0..1. */
	progress: number;
}

/** One dataset's points in data units, and each datum's point by its index. */
interface Side {
	data: readonly unknown[];
	points: ErrorBarPoint[];
	byIndex: (ErrorBarPoint | undefined)[];
	xs: number[];
	ys: number[];
}

interface ErrorBarState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	toSeries: ReturnType<typeof createSeries<AnyDatum>>;
	from: (data: readonly unknown[], props: ErrorBarProps<AnyDatum>) => Side;
	to: (data: readonly unknown[], props: ErrorBarProps<AnyDatum>) => Side;
	/** The enter order, one function while its inputs hold (the join caches by it). */
	enterRanks: {
		order: StaggerOrder | undefined;
		side: Side | undefined;
		fn: (
			entering: readonly BandKey[],
			join: KeyedJoin,
			toIndex: (key: BandKey) => number,
		) => readonly number[];
	} | null;
	bars: ReturnType<
		typeof createBatchedMark<
			Segment,
			LineProps,
			SceneNode<LineProps>,
			keyof LineProps
		>
	>;
	markers: ReturnType<
		typeof createBatchedMark<
			Marker,
			CircleProps,
			SceneNode<CircleProps>,
			keyof CircleProps
		>
	>;
}

const states = new WeakMap<object, ErrorBarState>();

/** One end's read, cached by its data and channels (and the date sink). */
function sideCache(dates: () => DateSink | null) {
	let last: { inputs: unknown[]; value: Side } | undefined;
	return (data: readonly unknown[], props: ErrorBarProps<AnyDatum>): Side => {
		const inputs = [data, props.x, props.y, props.yError, props.xError];
		if (last?.inputs.every((v, i) => v === inputs[i])) return last.value;
		const sink = dates();
		const xs = numberValues(
			data,
			props.x as Channel<unknown, PositionValue>,
			indexOf,
			"x",
			sink,
		);
		const ys = numberValues(
			data,
			props.y as Channel<unknown, PositionValue>,
			identity,
			"y",
			sink,
		);
		const points = errorBarPoints(
			xs,
			ys,
			errorSpec(
				data,
				props.yError as Channel<unknown, ErrorMagnitude>,
				"yError",
			),
			errorSpec(
				data,
				props.xError as Channel<unknown, ErrorMagnitude>,
				"xError",
			),
		);
		const byIndex: (ErrorBarPoint | undefined)[] = [];
		for (const p of points) byIndex[p.index] = p;
		const value = { data, points, byIndex, xs, ys };
		last = { inputs, value };
		return value;
	};
}

/** A side's extents: markers and both bars' ends. */
function extentOf(points: readonly ErrorBarPoint[]) {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const p of points) {
		xs.push(p.point.x);
		if (p.xBar) xs.push(p.xBar[0].x, p.xBar[1].x);
		ys.push(p.point.y);
		if (p.yBar) ys.push(p.yBar[0].y, p.yBar[1].y);
	}
	return { x: { values: xs }, y: { values: ys } };
}

const keyString = (key: BandKey) => `${typeof key}:${String(key)}`;

function draw(ctx: CompositeContext<ErrorBarProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as ErrorBarState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("ErrorBar must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;

	const from = state.from(props.data, props);
	const to = props.to ? state.to(props.to, props) : undefined;
	const overridden = props.color !== undefined || props.stroke !== undefined;
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden,
		mark: { line: true, symbol: "circle" },
		counted: from.points.map((p) => p.index),
		dates,
	});
	const toSeries = props.to
		? state.toSeries({
				data: props.to,
				series: props.series,
				overridden,
				mark: { line: true, symbol: "circle" },
				dates,
			})
		: undefined;
	/** A dataset's drawn data: finite `(x, y)` pairs. */
	const drawn = (data: readonly unknown[]) => {
		const side = data === props.data ? from : to;
		const out: number[] = [];
		if (!side) return out;
		for (let i = 0; i < data.length; i++)
			if (Number.isFinite(side.xs[i]) && Number.isFinite(side.ys[i]))
				out.push(i);
		return out;
	};
	// Entering points in `staggerOrder`: left to right where they land, or by key hash.
	if (
		!state.enterRanks ||
		state.enterRanks.order !== props.staggerOrder ||
		state.enterRanks.side !== to
	) {
		const order = props.staggerOrder;
		const side = to;
		state.enterRanks = {
			order,
			side,
			fn: (entering, _join, toIndex) =>
				orderRanks(
					entering,
					order,
					(key) => side?.byIndex[toIndex(key)]?.point.x ?? Number.NaN,
				),
		};
	}
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: props.series,
		of: series.of,
		drawn,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		enterRanks: state.enterRanks.fn,
		dates,
	});

	const own = extentOf(from.points);
	layer.report({
		...own,
		color: transitionColor(
			series.extent,
			to && keyed.toOf
				? to.points.map((p) => keyed.toOf?.[p.index])
				: undefined,
		),
		transition: to
			? layerTransition(keyed, props.staging, extentOf(to.points))
			: undefined,
	});

	// `color` (constant or per-datum) wins; then the series; then `stroke`.
	const read = resolveColor(props.color);
	const base =
		props.stroke ?? theme.palette.series[0] ?? theme.palette.foreground;
	const stateOf = (end: JoinEnd, index: number): PointState | undefined => {
		const side = end === "from" ? from : to;
		const p = side?.byIndex[index];
		if (!side || !p) return undefined;
		const of = end === "from" ? series.of : (toSeries?.of ?? keyed.toOf);
		return {
			x: p.point.x,
			y: p.point.y,
			yBar: p.yBar ? ([p.yBar[0].y, p.yBar[1].y] as const) : undefined,
			xBar: p.xBar ? ([p.xBar[0].x, p.xBar[1].x] as const) : undefined,
			color:
				read?.(side.data[index], index) ?? series.colorOf(of?.[index]) ?? base,
		};
	};
	/** Where each end draws while an axis changes kind across the transition. */
	const space = endSpace(frame, coords);
	const frames = joinFrames(keyed, stateOf, blendPoint, space.swapping);

	const progress = layer.progress(props.progress) ?? 1;
	const stagger = props.stagger ?? 0;
	const keys = [...frames.keys()];
	/** Each key's place in the reveal: left to right, where it stands now, or by key hash. */
	const order =
		stagger > 0
			? orderRanks(
					keyed.keys,
					props.staggerOrder,
					(key) => frames.get(key)?.state.x ?? Number.NaN,
				)
			: undefined;
	const rankOf = new Map<BandKey, number>();
	if (order)
		keyed.keys.forEach((key, i) => {
			rankOf.set(key, order[i] as number);
		});
	const capSize = props.capSize ?? DEFAULT_CAP_SIZE;

	const segments: Segment[] = [];
	const markers: Marker[] = [];
	for (const key of keys) {
		const point = frames.get(key) as JoinFrame<PointState>;
		if (point.presence <= 0) continue;
		const t = staggered(
			progress,
			rankOf.get(key) ?? 0,
			keyed.keys.length,
			stagger,
		);
		/** The reveal and the join's presence together: an exit is the reveal run back. */
		const shown = t * point.presence;
		// Mid-swap, each end's marker and bars through its own plot,
		// blended; a bar one end lacks is a zero-length one at its marker.
		const marker = space.place(point, (p) => ({ x: p.x, y: p.y }));
		const color = point.state.color;
		const prefix = keyString(key);
		markers.push({
			key,
			center: marker,
			radius: props.markerRadius ?? DEFAULT_MARKER_RADIUS,
			fill: color,
			progress: Math.min(1, shown),
		});
		if (!(shown > 0)) continue;
		/** A bar's end (`anchor`, in data units at each end) `shown` of the way out from the marker. */
		const outward = (anchor: (p: PointState) => Point): Point => {
			const end = space.place(point, anchor);
			return {
				x: marker.x + (end.x - marker.x) * shown,
				y: marker.y + (end.y - marker.y) * shown,
			};
		};
		const half = (capSize * shown) / 2;
		/** A main bar plus a cap at each end, perpendicular to `axis`. */
		const bar = (axis: "x" | "y", ends: readonly [Point, Point]) => {
			const cap = (at: Point): [Point, Point] =>
				axis === "y"
					? [
							{ x: at.x - half, y: at.y },
							{ x: at.x + half, y: at.y },
						]
					: [
							{ x: at.x, y: at.y - half },
							{ x: at.x, y: at.y + half },
						];
			const [start, end] = ends;
			const startCap = cap(start);
			const endCap = cap(end);
			segments.push(
				{
					key: `${prefix}|${axis}`,
					from: start,
					to: end,
					stroke: color,
					anchor: marker,
				},
				{
					key: `${prefix}|${axis}0`,
					from: startCap[0],
					to: startCap[1],
					stroke: color,
					anchor: marker,
				},
				{
					key: `${prefix}|${axis}1`,
					from: endCap[0],
					to: endCap[1],
					stroke: color,
					anchor: marker,
				},
			);
		};
		if (point.state.yBar)
			bar("y", [
				outward((p) => ({ x: p.x, y: p.yBar?.[0] ?? p.y })),
				outward((p) => ({ x: p.x, y: p.yBar?.[1] ?? p.y })),
			]);
		if (point.state.xBar)
			bar("x", [
				outward((p) => ({ x: p.xBar?.[0] ?? p.x, y: p.y })),
				outward((p) => ({ x: p.xBar?.[1] ?? p.x, y: p.y })),
			]);
	}

	const motion = {
		transition: props.transition,
		// Only data changes move through the tween banks; a reveal or a `to`
		// blend is exact on every frame.
		animate: !keyed.active && progress >= 1,
	};
	state.bars.update(
		segments,
		{
			strokeWidth: props.strokeWidth,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
		} as never,
		motion,
	);
	state.markers.update(
		markers,
		{
			stroke: "none",
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
		} as never,
		motion,
	);
	return [state.bars.node, state.markers.node];
}

/**
 * A marker at each `(x, y)` with optional capped vertical (`yError`) and
 * horizontal (`xError`) error bars. Bar lengths are in data units; caps and
 * markers in scene units. `progress` draws each bar outward from its marker.
 * Inside a `chart` or `axes`. Bars draw as one `line` instances node and
 * markers as one `circle` instances node. See {@link errorBarPoints} for the
 * endpoints alone.
 *
 * @example
 * ```ts
 * import { chart, errorBar } from "@sophistry/charts";
 *
 * const trials = [
 * 	{ dose: 1, mean: 2.1, sd: 0.4 },
 * 	{ dose: 2, mean: 3.4, sd: 0.6 },
 * 	{ dose: 4, mean: 4.0, sd: 0.5 },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [errorBar.create({ data: trials, x: "dose", y: "mean", yError: "sd" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#lines-scatter-and-error-bars
 * @category Charts
 */
export const errorBar = defineComposite<ErrorBarProps<AnyDatum>>({
	name: "ErrorBar",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		yError: { invalidates: Invalidate.UPDATE },
		xError: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		markerRadius: { invalidates: Invalidate.UPDATE },
		capSize: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		staggerOrder: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const dates = () => ctx.context(dateSinkContext);
		states.set(ctx.node, {
			layer,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			toSeries: createSeries<AnyDatum>(layer),
			from: sideCache(dates),
			to: sideCache(dates),
			enterRanks: null,
			bars: createBatchedMark<
				Segment,
				LineProps,
				SceneNode<LineProps>,
				keyof LineProps
			>(line as never, {
				channels: {
					from: (item) => item.from,
					to: (item) => item.to,
					stroke: (item) => item.stroke,
				},
				enter: {
					from: (item: Segment) => item.anchor,
					to: (item: Segment) => item.anchor,
				},
				exit: {
					from: (item: Segment) => item.anchor,
					to: (item: Segment) => item.anchor,
				},
			}),
			markers: createBatchedMark<
				Marker,
				CircleProps,
				SceneNode<CircleProps>,
				keyof CircleProps
			>(circle as never, {
				channels: {
					center: (item) => item.center,
					fill: (item) => item.fill,
					progress: (item) => item.progress,
					radius: (item) => item.radius,
				},
				enter: { radius: 0 },
				exit: { radius: 0 },
			}),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
