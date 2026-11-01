/**
 * `scatter`: a marker per datum, drawn as one instances node.
 *
 * The reference per-datum mark of the charts package: every other one
 * (strip, rug, ticks, stem, error bars, ...) follows the same steps in its
 * `update`:
 *
 * 1. read the chart (`layer.frame()`, `layer.coords()`) and the channels
 *    (with the chart's date sink);
 * 2. join `data` and `to` by key (`createKeyedData`) and take each key's
 *    frame at this `blend` (`joinFrames`);
 * 3. report the extent (both ends while a transition runs);
 * 4. build one item per key (scene-unit position, size, colour, reveal) at
 *    this frame of the reveal and transition;
 * 5. hand the items to the batched node (`createBatchedMark`), with the
 *    mark's `transition` only for data changes outside a `to` blend.
 *
 * Work is split: everything read from the data and the
 * join (each key's marker in data units) is cached on its inputs, so a pan
 * or zoom (only the coordinates changing) re-projects and nothing else, and
 * a frame of a reveal only recomputes each marker's reveal.
 *
 * Markers are instances of the internal `symbolMarker` shape: all circles
 * publish `circle` marks (the splat path); other symbols, constant or per
 * datum, share the node (see `symbol-marker.ts`). The reveal is each
 * marker's own `progress` channel (its outline traced), so a partly revealed layer is drawn from outlines and is
 * discs again once whole. The items are the drawn markers themselves: the
 * channels read their centres from one projected array, so a pan builds no
 * per-marker objects beyond the points the node keeps. With `time` + `trail`, the
 * trails are one path batch behind the markers.
 */

import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate, pathBatch } from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { polylineToCurvePath } from "@sophistry/core/geometry";
import { clampNonNegative, maxOf } from "@sophistry/core/internal";
import type { MarkTransition } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type {
	Channel,
	ChannelFn,
	ColorChannel,
	PositionValue,
	Quantity,
} from "../data/channels.js";
import {
	channelValues,
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
	resolveColor,
	resolveQuantity,
} from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { ChartFrame, SizeExtent } from "../frame/types.js";
import type { JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrames,
	layerTransition,
	transitionColor,
} from "../join.js";
import { bubbleRadiusScale } from "../math/bubble.js";
import { keyframeAt, trailPolyline } from "../math/keyframes.js";
import { uniqueKeys } from "../math/ordinal.js";
import type { SymbolName } from "../math/symbol.js";
import { blendCss } from "../mix.js";
import type {
	AnyDatum,
	KeyedTransitionProps,
	RevealProps,
	StaggerOrder,
} from "../props.js";
import { projectPoints } from "../raster.js";
import { createSeries } from "../series.js";
import { hashRanks, ranks, staggered } from "../stagger.js";
import type {
	SharedTooltipDatum,
	TooltipField,
	TooltipSpec,
	TooltipState,
} from "../tooltip.js";
import {
	datumValue,
	sharedTooltipPoints,
	tooltipContext,
	tooltipText,
} from "../tooltip.js";
import { keyedMemo, mix } from "../util.js";
import { createItemHandlers, stableShared, tooltipsOn } from "./shared.js";
import type { SymbolMarkerProps } from "./symbol-marker.js";
import { symbolMarker } from "./symbol-marker.js";

const DEFAULT_RADIUS = 0.09;
/** The radius range the `size` channel maps onto by default, in scene units. */
const DEFAULT_SIZE_RANGE: readonly [number, number] = [0, 0.35];
const DEFAULT_TRAIL_OPACITY = 0.45;
const DEFAULT_TRAIL_WIDTH = 0.035;

/**
 * Options for {@link scatter}'s `trail`.
 *
 * @category Charts
 */
export interface ScatterTrailOptions {
	/** How much time the trail spans, in the `time` channel's units. Defaults to all of it. */
	length?: number;
	/**
	 * The trail's opacity, 0..1.
	 * @default 0.45
	 */
	opacity?: number;
	/**
	 * The trail's width.
	 * @default 0.035
	 */
	strokeWidth?: number;
}

/**
 * Props of {@link scatter}.
 *
 * @category Charts
 */
export interface ScatterProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One marker per datum; data with a non-finite `x` or `y` are skipped. */
	data: readonly T[];
	/** X position, in data units (a `Date` reads as epoch ms). Defaults to the index when `data` is `number[]`. */
	x?: Channel<T, PositionValue>;
	/** Y position, in data units. Defaults to the datum when `data` is `number[]`. */
	y?: Channel<T, PositionValue>;
	/**
	 * Marker radius in scene units, constant or per marker. To size markers by a data value, use
	 * `size`.
	 * @default 0.09
	 */
	radius?: Quantity<T>;
	/**
	 * Size by value (a bubble chart): radius by a square-root scale from zero, so a marker's area
	 * is proportional to its value. Wins over `radius`. Inside a `chart`, sized layers share one
	 * scale unless `scales: { size: "independent" }`.
	 */
	size?: Channel<T, number>;
	/**
	 * With `size`: the radii a value of 0 and a value of `sizeMaxValue` get.
	 * @default [0, 0.35]
	 */
	sizeRange?: readonly [min: number, max: number];
	/**
	 * With `size`: the value that reaches `sizeRange[1]`. Pin it to compare sizes across charts or
	 * across a transition. Defaults to the greatest `size` in the chart's sized layers.
	 */
	sizeMaxValue?: number;
	/** The category of each marker: colours markers through the chart's shared colour scale and legend. `color` wins. */
	series?: Channel<T, BandKey>;
	/** Marker fill, constant or `(d, i) => colour`. Defaults to the `series` colour, else the theme's first series colour. */
	color?: ColorChannel<T>;
	/**
	 * Marker shape, constant or per marker: `"circle"`, `"square"`, `"diamond"`, `"triangle"`,
	 * `"cross"` or `"star"`, each with the area of a circle of the same `radius`.
	 * @default "circle"
	 */
	symbol?: SymbolName | ChannelFn<T, SymbolName>;
	/** The order `stagger` (and `enterStagger`) reveals markers in. @default "position" */
	staggerOrder?: StaggerOrder;
	/** Hover tooltip: `true` for a row per channel (`x`, `y`, `series`, `size`), or a template, function or options. */
	tooltip?: TooltipSpec<T>;
	/**
	 * Time as an encoding (a Gapminder chart): each datum is one moment of the thing its `key` (or
	 * `series`) names, and one marker per key is drawn at the moment `at`, interpolated between
	 * keyframes. The axes fit every moment. `to` is ignored.
	 */
	time?: Channel<T, number>;
	/** With `time`: the moment to draw. Defaults to the last moment in the data. */
	at?: number;
	/**
	 * With `time`: how long a key takes to grow in before its first moment and shrink away after
	 * its last, in `time` units. 0 shows it only between them. Defaults to half the shortest step
	 * between moments.
	 */
	timeFade?: number;
	/** With `time`: draw the path each marker has travelled up to `at`, behind the markers. */
	trail?: boolean | ScatterTrailOptions;
	/**
	 * How markers move when `data` changes (outside a `to` blend): a tween
	 * or a spring in the node's tween bank; new markers grow in, removed ones
	 * shrink away. Omitted, data changes are instant.
	 */
	transition?: MarkTransition;
	/** Marker outline. @default "none" */
	stroke?: string;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Fill opacity 0..1, on top of `opacity`. @default 1 */
	fillOpacity?: number;
	/** Reveal 0..1: each marker traces its outline, its fill coming up with it (staggered with `stagger`). @default 1 */
	progress?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the markers. */
	visible?: boolean;
}

/** One key's marker on a frame, in data units, before projection. */
interface Marker {
	key: BandKey;
	x: number;
	y: number;
	radius: number;
	fill: string;
	symbol: SymbolName;
	/** 0..1: entering, leaving, or arriving through `time`; scales radius and fade. */
	presence: number;
	/** The datum its tooltip and symbol read, and its index in its dataset. */
	datum: unknown;
	index: number;
	/** Where it is drawn in scene units while an axis changes kind; otherwise unset. */
	scene?: Point;
	/** Its position among the drawn markers (and the node's items), once drawn. */
	slot?: number;
}

/**
 * The markers a frame draws (those present), with their positions in data
 * units as typed arrays, ready to project. The markers themselves are the
 * batched node's items: its channels read each one's drawn state.
 */
interface DrawnMarkers {
	list: Marker[];
	xs: Float64Array;
	ys: Float64Array;
	/** Whether any marker carries its own scene position (an axis is changing kind). */
	placed: boolean;
}

/** What the channels read beyond the marker: this frame's centres and reveal. */
interface MarkerFrame {
	/** Projected centres of the drawn markers, two numbers per marker. */
	centers: Float64Array;
	/** The layer's reveal 0..1. */
	progress: number;
	/** With a stagger: each key's rank, the key count and the stagger. */
	rankOf: Map<BandKey, number> | undefined;
	total: number;
	stagger: number;
}

/** One marker's state at one end: data units, radius, fill. */
interface MarkerState {
	x: number;
	y: number;
	radius: number;
	fill: string;
}

const blendState = (
	a: MarkerState,
	b: MarkerState,
	u: number,
): MarkerState => ({
	x: mix(a.x, b.x, u),
	y: mix(a.y, b.y, u),
	radius: mix(a.radius, b.radius, u),
	fill: a.fill === b.fill ? a.fill : blendCss(a.fill, b.fill, u),
});

/** One dataset's channels, by datum index. */
interface Side {
	data: readonly unknown[];
	xs: number[];
	ys: number[];
	/** With `size`: each datum's value, and the value its own scale takes to the largest radius. */
	sizes: number[] | undefined;
	sizeMax: number | undefined;
}

/** With `time`: each key's moments, in time order. */
interface Timeline {
	tracks: Map<BandKey, { times: number[]; points: Point[]; rows: number[] }>;
	/** Keys in first-seen data order. */
	keys: BandKey[];
	last: number;
	/** Each row's category, with a `series`. */
	of: (BandKey | null | undefined)[] | undefined;
	/** Half the shortest step between moments: the default fade. */
	fade: number;
}

/** What a scatter keeps between updates. */
interface ScatterState {
	layer: ChartLayer;
	tooltip: TooltipState | null;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	toSeries: ReturnType<typeof createSeries<AnyDatum>>;
	dots: ReturnType<
		typeof createBatchedMark<
			Marker,
			SymbolMarkerProps,
			SceneNode<SymbolMarkerProps>,
			keyof SymbolMarkerProps
		>
	>;
	trail: SceneNode | null;
	sides: {
		from: ReturnType<typeof keyedMemo<Side>>;
		to: ReturnType<typeof keyedMemo<Side>>;
	};
	radii: {
		from: ReturnType<typeof keyedMemo<number[] | undefined>>;
		to: ReturnType<typeof keyedMemo<number[] | undefined>>;
	};
	radiusOf: ReturnType<typeof keyedMemo<ChannelFn<unknown, number>>>;
	colorOf: ReturnType<typeof keyedMemo<ChannelFn<unknown, string> | undefined>>;
	timeline: ReturnType<typeof keyedMemo<Timeline | undefined>>;
	markers: ReturnType<typeof keyedMemo<Marker[]>>;
	ranks: ReturnType<typeof keyedMemo<number[] | undefined>>;
	drawn: ReturnType<typeof keyedMemo<DrawnMarkers>>;
	/** The channels' inputs on the current frame. */
	frame: MarkerFrame;
	/** What the last items array was made from: kept while all are unchanged. */
	lastItems: {
		drawn: DrawnMarkers;
		coords: unknown;
		progress: number;
		rankOf: Map<BandKey, number> | undefined;
		stagger: number;
		items: readonly Marker[];
	} | null;
	rankOf: ReturnType<typeof keyedMemo<Map<BandKey, number> | undefined>>;
	/** The chart report and what it was made from, so an unchanged one is the same object. */
	report: ReturnType<typeof keyedMemo<Parameters<ChartLayer["report"]>[0]>>;
	shared: (next: Record<string, unknown>) => Record<string, unknown>;
	handlers: ReturnType<typeof createItemHandlers>;
	/** The current frame's chart and props, for the handlers. */
	current: {
		props: ScatterProps<AnyDatum>;
		frame: ChartFrame | null;
	};
	owner: object;
}

const states = new WeakMap<object, ScatterState>();

/** One dataset's channels. */
function readSide(
	props: ScatterProps<AnyDatum>,
	data: readonly unknown[],
	dates: Parameters<typeof numberValues>[4],
): Side {
	const sizes =
		props.size === undefined
			? undefined
			: numberValues(
					data,
					props.size as Channel<unknown, number>,
					undefined,
					"size",
					dates,
				);
	return {
		data,
		xs: numberValues(
			data,
			props.x as Channel<unknown, PositionValue>,
			indexOf,
			"x",
			dates,
		),
		ys: numberValues(
			data,
			props.y as Channel<unknown, PositionValue>,
			identity,
			"y",
			dates,
		),
		sizes,
		sizeMax: sizes
			? (props.sizeMaxValue ?? maxOf(sizes.map(clampNonNegative), 0))
			: undefined,
	};
}

/** With `time`: each key's moments, in time order. */
function readTimeline(
	props: ScatterProps<AnyDatum>,
	from: Side,
	dates: Parameters<typeof numberValues>[4],
): Timeline | undefined {
	if (props.time === undefined) return undefined;
	const data = props.data;
	const { xs, ys } = from;
	const times = numberValues(
		data,
		props.time as Channel<unknown, number>,
		undefined,
		"time",
		dates,
	);
	const names: (BandKey | null | undefined)[] =
		props.key !== undefined
			? channelValues(data, props.key, undefined, "key", dates)
			: props.series !== undefined
				? channelValues(data, props.series, undefined, "series", dates)
				: data.map(() => 0);
	const tracks: Timeline["tracks"] = new Map();
	const order = data
		.map((_, i) => i)
		.filter(
			(i) =>
				Number.isFinite(times[i]) &&
				Number.isFinite(xs[i]) &&
				Number.isFinite(ys[i]) &&
				names[i] !== null &&
				names[i] !== undefined,
		)
		.sort((a, b) => (times[a] as number) - (times[b] as number) || a - b);
	let last = Number.NEGATIVE_INFINITY;
	for (const i of order) {
		const name = names[i] as BandKey;
		const time = times[i] as number;
		const point = { x: xs[i] as number, y: ys[i] as number };
		let track = tracks.get(name);
		if (!track) {
			track = { times: [], points: [], rows: [] };
			tracks.set(name, track);
		}
		// Two rows at one moment: the later one wins.
		if (track.times[track.times.length - 1] === time) {
			track.points[track.points.length - 1] = point;
			track.rows[track.rows.length - 1] = i;
		} else {
			track.times.push(time);
			track.points.push(point);
			track.rows.push(i);
		}
		last = Math.max(last, time);
	}
	// Keys in first-seen data order, so paint order follows the data.
	const keys = uniqueKeys(names).filter((name) => tracks.has(name));
	const moments = [...new Set(order.map((i) => times[i] as number))].sort(
		(a, b) => a - b,
	);
	let gap = Number.POSITIVE_INFINITY;
	for (let k = 1; k < moments.length; k++)
		gap = Math.min(gap, (moments[k] as number) - (moments[k - 1] as number));
	return {
		tracks,
		keys,
		last,
		of:
			props.series === undefined
				? undefined
				: channelValues(data, props.series, undefined, "series", dates),
		fade: Number.isFinite(gap) ? gap / 2 : 0,
	};
}

function draw(ctx: CompositeContext<ScatterProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as ScatterState;
	const props = ctx.props;
	const { layer, tooltip } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("Scatter must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	state.current = { props, frame };

	/* ------------------------------------------------ channels and join */

	const timed = props.time !== undefined;
	const from = state.sides.from(
		[props.data, props.x, props.y, props.size, props.sizeMaxValue, dates],
		() => readSide(props, props.data, dates),
	);
	// With `time`, `to` is ignored: the moments are the transition.
	const toData = timed ? undefined : props.to;
	const to = toData
		? state.sides.to(
				[toData, props.x, props.y, props.size, props.sizeMaxValue, dates],
				() => readSide(props, toData, dates),
			)
		: undefined;
	const colorOverride = props.color !== undefined;
	const symbolName = typeof props.symbol === "string" ? props.symbol : "circle";
	/** The indices an end draws: those with a finite position. */
	const drawnOf = (side: Side) => {
		const out: number[] = [];
		for (let i = 0; i < side.data.length; i++)
			if (Number.isFinite(side.xs[i]) && Number.isFinite(side.ys[i]))
				out.push(i);
		return out;
	};
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: colorOverride,
		mark: { symbol: symbolName },
		counted: timed ? undefined : drawnIndices(from, drawnOf),
		dates,
	});
	const toSeries = toData
		? state.toSeries({
				data: toData,
				series: props.series,
				overridden: colorOverride,
				mark: { symbol: symbolName },
				counted: to ? drawnIndices(to, drawnOf) : undefined,
				dates,
			})
		: undefined;
	const keyed = state.keyed({
		data: props.data,
		to: toData,
		key: props.key,
		series: props.series,
		of: series.of,
		drawn: drawnFor(state, from, to, drawnOf),
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		// Entering markers in `staggerOrder`: by key hash, else left to right
		// where they land.
		enterRanks: enterRanksFor(props.staggerOrder, to),
		dates,
	});

	/* ------------------------------------------------------- the report */

	/** With `size`: the scale for the frame's size key, each end's maximum (a pinned `sizeMaxValue` is both). */
	const sizeOf = (
		own: number | undefined,
		far: number | undefined,
	): SizeExtent | undefined =>
		own === undefined
			? undefined
			: {
					maxValue: own,
					range: props.sizeRange ?? DEFAULT_SIZE_RANGE,
					label: typeof props.size === "string" ? props.size : undefined,
					to: far === undefined || far === own ? undefined : far,
					...(props.sizeMaxValue !== undefined ? { pinned: true } : {}),
				};
	// Made again only when an input changed: a pan or a reveal reports the
	// same object, which the chart skips without re-reading the values.
	const report = state.report(
		[
			from,
			to,
			// The colour extent by value (`series.extent` is a new object per frame).
			series.scaled,
			series.categories,
			symbolName,
			toSeries?.categories,
			props.sizeRange,
			props.size,
			props.sizeMaxValue,
			keyed.active,
			keyed.t,
			keyed.flags.enters,
			keyed.flags.exits,
			props.staging,
		],
		() => ({
			x: { values: from.xs },
			y: { values: from.ys },
			color: transitionColor(
				series.extent,
				toSeries ? (toSeries.categories as BandKey[]) : undefined,
			),
			size: sizeOf(from.sizeMax, to?.sizeMax),
			transition: layerTransition(keyed, props.staging, {
				x: to ? { values: to.xs } : undefined,
				y: to ? { values: to.ys } : undefined,
			}),
		}),
	);
	layer.report(report);

	/* ----------------------------------------------------- the markers */

	const radiusOf = state.radiusOf([props.radius], () =>
		resolveQuantity(props.radius as Quantity<unknown>, () => DEFAULT_RADIUS),
	);
	const colorOf = state.colorOf([props.color], () =>
		resolveColor(props.color as ColorChannel<unknown>),
	);
	const fallback = theme.palette.series[0] ?? theme.palette.foreground;
	const symbolOf = (datum: unknown, index: number): SymbolName =>
		typeof props.symbol === "function"
			? props.symbol(datum, index)
			: (props.symbol ?? "circle");
	/**
	 * With `size`: one radius per datum (area ∝ value), scaled to `sizeMaxValue`, else the chart's
	 * shared maximum at that end, else the dataset's own.
	 */
	const radiiOf = (side: Side | undefined, end: "from" | "to") => {
		if (!side?.sizes) return undefined;
		const [minRadius, maxRadius] = props.sizeRange ?? DEFAULT_SIZE_RANGE;
		const shared = frame?.sizeDomain?.[end];
		const memo = end === "from" ? state.radii.from : state.radii.to;
		return memo([side, minRadius, maxRadius, props.sizeMaxValue, shared], () =>
			bubbleRadiusScale(side.sizes as number[], {
				minRadius,
				maxRadius,
				maxValue: props.sizeMaxValue ?? shared ?? side.sizeMax,
			}),
		);
	};
	const fromRadii = radiiOf(from, "from");
	const toRadii = radiiOf(to, "to");
	const space = endSpace(frame, coords);
	const timeline = state.timeline(
		[timed, props.data, from, props.time, props.key, props.series, dates],
		() => readTimeline(props, from, dates),
	);

	const markers = state.markers(
		[
			from,
			to,
			fromRadii,
			toRadii,
			radiusOf,
			colorOf,
			props.symbol,
			series.scale,
			series.scaled,
			toSeries?.scale,
			fallback,
			keyed.keys,
			keyed.t,
			keyed.stages,
			keyed.active,
			frame?.ends,
			timeline,
			props.at,
			props.timeFade,
		],
		(): Marker[] => {
			if (timeline) {
				return timedMarkers(timeline, {
					props,
					at: props.at ?? timeline.last,
					radiusAt: (row) => fromRadii?.[row] ?? radiusOf(props.data[row], row),
					fillAt: (row) =>
						colorOf?.(props.data[row], row) ??
						(series.scaled ? series.colorOf(timeline.of?.[row]) : undefined) ??
						fallback,
					symbolOf,
				});
			}
			const stateOf = (
				end: "from" | "to",
				index: number,
			): MarkerState | undefined => {
				const side = end === "from" ? from : to;
				if (!side) return undefined;
				const x = side.xs[index] as number;
				const y = side.ys[index] as number;
				if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
				const datum = side.data[index];
				const own = end === "from" ? series : toSeries;
				const radii = end === "from" ? fromRadii : toRadii;
				return {
					x,
					y,
					radius: Math.max(0, radii?.[index] ?? radiusOf(datum, index)),
					fill:
						colorOf?.(datum, index) ??
						own?.colorOf(own.of?.[index]) ??
						fallback,
				};
			};
			const frames = joinFrames(keyed, stateOf, blendState, space.swapping);
			const out: Marker[] = [];
			for (const [key, own] of frames) {
				const side = (own.end === "from" ? from : to) as Side;
				const datum = side.data[own.index];
				const marker: Marker = {
					key,
					x: own.state.x,
					y: own.state.y,
					radius: own.state.radius,
					fill: own.state.fill,
					symbol: symbolOf(datum, own.index),
					presence: own.presence,
					datum,
					index: own.index,
				};
				if (space.swapping) {
					// Mid-swap the two ends' values share no units: the tip reads
					// the nearer end's, and `scene` places it.
					marker.scene = space.place(own as JoinFrame<MarkerState>, (s) => s);
					if (own.pair) {
						const near = own.end === "from" ? own.pair.a : own.pair.b;
						marker.x = near.x;
						marker.y = near.y;
					}
				}
				out.push(marker);
			}
			return out;
		},
	);

	// Each key's place in the reveal: along x (where it first stands) or by
	// key hash; read from the data so a transition doesn't reshuffle it.
	const stagger = props.stagger ?? 0;
	const order = state.ranks(
		[stagger > 0, props.staggerOrder, keyed.keys, from, to, timeline],
		() => {
			if (!(stagger > 0)) return undefined;
			const keys = timeline ? timeline.keys : keyed.keys;
			if (props.staggerOrder === "random") return hashRanks(keys);
			return ranks(
				keys.map((key) => {
					if (timeline)
						return timeline.tracks.get(key)?.points[0]?.x ?? Number.NaN;
					const at = keyed.fromIndex(key);
					if (at >= 0) return from.xs[at] ?? Number.NaN;
					const there = keyed.toIndex(key);
					return there >= 0 && to ? (to.xs[there] ?? Number.NaN) : Number.NaN;
				}),
			);
		},
	);
	const rankKeys = timeline ? timeline.keys : keyed.keys;
	const rankOf = state.rankOf([order, rankKeys], () => {
		if (!order) return undefined;
		const map = new Map<BandKey, number>();
		rankKeys.forEach((key, i) => {
			map.set(key, order[i] as number);
		});
		return map;
	});
	const total = timeline ? timeline.keys.length : keyed.keys.length;

	// The drawn markers and their data-unit positions: redone only when the
	// markers change, so a pan only re-projects.
	const drawn = state.drawn([markers], () => {
		const list: Marker[] = [];
		for (const own of markers) {
			if (!(own.presence > 0)) continue;
			own.slot = list.length;
			list.push(own);
		}
		const n = list.length;
		const xs = new Float64Array(n);
		const ys = new Float64Array(n);
		let placed = false;
		for (let i = 0; i < n; i++) {
			const own = list[i] as Marker;
			xs[i] = own.x;
			ys[i] = own.y;
			if (own.scene) placed = true;
		}
		return { list, xs, ys, placed };
	});

	// The reveal: each marker traces its outline (its `progress`),
	// staggered along x (or by hash); markers
	// entering or leaving the join also grow or shrink with their presence.
	const progress = layer.progress(props.progress) ?? 1;
	const opacity = props.opacity ?? 1;
	const last = state.lastItems;
	let items: readonly Marker[];
	if (
		last &&
		last.drawn === drawn &&
		last.coords === coords &&
		last.progress === progress &&
		last.rankOf === rankOf &&
		last.stagger === stagger
	)
		items = last.items;
	else {
		// Projected centres: one pass over typed arrays into the frame's
		// buffer (reused while the count holds); the channels read them.
		const n = drawn.list.length;
		let centers = state.frame.centers;
		if (centers.length !== 2 * n) centers = new Float64Array(2 * n);
		projectPoints(coords, drawn.xs, drawn.ys, centers);
		// Only while an axis changes kind do markers stand somewhere the
		// projection does not put them; the rest of the time this pass is
		// skipped (it is a scan of every marker per frame).
		if (drawn.placed) {
			for (let i = 0; i < n; i++) {
				const at = (drawn.list[i] as Marker).scene;
				if (at) {
					centers[2 * i] = at.x;
					centers[2 * i + 1] = at.y;
				}
			}
		}
		state.frame = { centers, progress, rankOf, total, stagger };
		// A new array, so the node reconciles and its channels read the frame.
		items = drawn.list.slice();
		state.lastItems = { drawn, coords, progress, rankOf, stagger, items };
	}
	const centers = state.frame.centers;

	// The chart's shared nearest-x tip (`tooltip: { mode: "x" }`): every
	// marker standing on this frame, once the layer is drawn whole.
	if (tooltip) {
		const points = sharedTooltipPoints(
			tooltip,
			() => {
				if (props.visible === false || progress < 1) return [];
				const out: SharedTooltipDatum[] = [];
				for (const own of drawn.list) {
					if (own.presence < 1) continue;
					const slot = own.slot as number;
					const category = datumValue(props.series, own.datum, own.index);
					out.push({
						x: own.x,
						y: own.y,
						at: {
							x: centers[2 * slot] as number,
							y: centers[2 * slot + 1] as number,
						},
						series: category ?? undefined,
						color: own.fill,
					});
				}
				return out;
			},
			{ y: props.y, format: frame?.format },
		);
		tooltip.offerPoints(state.owner, points);
	}

	state.dots.update(
		items,
		state.shared({
			stroke: props.stroke ?? "none",
			strokeWidth: props.strokeWidth,
			opacity,
			fillOpacity: props.fillOpacity,
			zIndex: props.zIndex,
			visible: props.visible,
			...state.handlers(
				tooltipsOn(tooltip, props.tooltip),
				`Scatter, ${items.length} points`,
			),
		}) as never,
		{
			transition: props.transition,
			// Only data changes move through the tween bank; a reveal or a
			// `to` blend is exact on every frame.
			animate: !keyed.active && !timeline && progress >= 1,
		},
	);

	/* ------------------------------------------------------- the trails */

	const trailOption = timeline && props.trail ? props.trail : undefined;
	if (!trailOption) {
		state.trail = null;
		return [state.dots.node];
	}
	const trail = trailOption === true ? {} : trailOption;
	state.trail ??= pathBatch.create({ items: [] });
	const at = props.at ?? (timeline as Timeline).last;
	const revealed = progress > 0;
	state.trail.update({
		items: revealed
			? markers.flatMap((own) => {
					const track = (timeline as Timeline).tracks.get(own.key);
					if (!track) return [];
					const path = trailPolyline(
						track.points,
						track.times,
						at,
						trail.length,
					).map((p) => coords.coordsToPoint(p.x, p.y));
					if (path.length < 2) return [];
					return [
						{
							curvePaths: [polylineToCurvePath(path, false)],
							closed: false,
							stroke: own.fill,
							// A key arriving or leaving takes its trail with it.
							opacity: Math.min(1, own.presence),
						},
					];
				})
			: [],
		strokeWidth: trail.strokeWidth ?? DEFAULT_TRAIL_WIDTH,
		opacity: (trail.opacity ?? DEFAULT_TRAIL_OPACITY) * opacity,
		zIndex: props.zIndex,
		visible: props.visible,
	} as never);
	return [state.trail, state.dots.node];
}

/** An end's drawn indices (finite positions), cached on the side. */
const drawnCache = new WeakMap<Side, number[]>();
function drawnIndices(side: Side, drawnOf: (side: Side) => number[]) {
	let out = drawnCache.get(side);
	if (!out) {
		out = drawnOf(side);
		drawnCache.set(side, out);
	}
	return out;
}

/**
 * The `drawn` function the keyed join reads both ends through: stable while
 * the sides are, so the join's per-end caches hold.
 */
const drawnFns = new WeakMap<
	ScatterState,
	{
		from: Side;
		to: Side | undefined;
		fn: (data: readonly unknown[]) => number[];
	}
>();
function drawnFor(
	state: ScatterState,
	from: Side,
	to: Side | undefined,
	drawnOf: (side: Side) => number[],
) {
	const last = drawnFns.get(state);
	if (last && last.from === from && last.to === to) return last.fn;
	const fn = (data: readonly unknown[]) =>
		data === from.data
			? drawnIndices(from, drawnOf)
			: to && data === to.data
				? drawnIndices(to, drawnOf)
				: [];
	drawnFns.set(state, { from, to, fn });
	return fn;
}

/** Entering markers' stagger order, as the keyed join takes it: cached on its inputs, so the join's rank cache can hold. */
type EnterRanks = (
	entering: readonly BandKey[],
	join: unknown,
	toIndex: (key: BandKey) => number,
) => number[];
const enterRankFns = new WeakMap<Side, Map<string, EnterRanks>>();
const NO_SIDE: Side = {
	data: [],
	xs: [],
	ys: [],
	sizes: undefined,
	sizeMax: undefined,
};
function enterRanksFor(
	order: StaggerOrder | undefined,
	to: Side | undefined,
): EnterRanks {
	const side = to ?? NO_SIDE;
	const name = order === "random" ? "random" : "position";
	let byOrder = enterRankFns.get(side);
	if (!byOrder) {
		byOrder = new Map();
		enterRankFns.set(side, byOrder);
	}
	let fn = byOrder.get(name);
	if (!fn) {
		fn = (entering, _join, toIndex) =>
			name === "random"
				? hashRanks(entering)
				: ranks(
						entering.map((key) => {
							const at = toIndex(key);
							return at >= 0 ? (side.xs[at] ?? Number.NaN) : Number.NaN;
						}),
					);
		byOrder.set(name, fn);
	}
	return fn;
}

/** With `time`: each key's marker at the moment, interpolated between its keyframes. */
function timedMarkers(
	line: Timeline,
	spec: {
		props: ScatterProps<AnyDatum>;
		at: number;
		radiusAt: (row: number) => number;
		fillAt: (row: number) => string;
		symbolOf: (datum: unknown, index: number) => SymbolName;
	},
): Marker[] {
	const { props, at } = spec;
	const fade = Math.max(0, props.timeFade ?? line.fade);
	const out: Marker[] = [];
	for (const name of line.keys) {
		const track = line.tracks.get(name);
		if (!track) continue;
		const first = track.times[0] as number;
		const last = track.times[track.times.length - 1] as number;
		// Before its first moment and after its last, a key grows in and
		// shrinks away where it stands then, over `fade` (in place, never
		// flying in).
		const presence =
			at < first
				? fade > 0
					? 1 - (first - at) / fade
					: 0
				: at > last
					? fade > 0
						? 1 - (at - last) / fade
						: 0
					: 1;
		if (!(presence > 0)) continue;
		const span = keyframeAt(track.times, Math.min(last, Math.max(first, at)));
		if (!span) continue;
		const a = track.rows[span.lo] as number;
		const b = track.rows[span.hi] as number;
		const near = span.u < 0.5 ? a : b;
		const datum = props.data[near];
		const fillA = spec.fillAt(a);
		const fillB = spec.fillAt(b);
		const pa = track.points[span.lo] as Point;
		const pb = track.points[span.hi] as Point;
		out.push({
			key: name,
			x: mix(pa.x, pb.x, span.u),
			y: mix(pa.y, pb.y, span.u),
			datum,
			index: near,
			radius: mix(spec.radiusAt(a), spec.radiusAt(b), span.u),
			fill: fillA === fillB ? fillA : blendCss(fillA, fillB, span.u),
			symbol: spec.symbolOf(datum, near),
			presence,
		});
	}
	return out;
}

/**
 * A marker's reveal on a frame (its `progress`): the layer's, times the marker's presence while it enters or
 * leaves, then staggered by its rank.
 */
function markerReveal(frame: MarkerFrame, own: Marker): number {
	const shown =
		own.presence >= 1
			? frame.progress
			: frame.progress * Math.max(0, own.presence);
	if (!frame.rankOf) return shown;
	return staggered(
		shown,
		frame.rankOf.get(own.key) ?? 0,
		frame.total,
		frame.stagger,
	);
}

/** A marker's tooltip: a row per channel, or the `tooltip` prop's own. */
function tipOf(state: ScatterState, own: Marker) {
	const { props, frame } = state.current;
	return tooltipText(
		props.tooltip,
		(): TooltipField[] => [
			{ channel: "x", of: props.x, value: own.x, format: frame?.format("x") },
			{ channel: "y", of: props.y, value: own.y, format: frame?.format("y") },
			{
				channel: "series",
				of: props.series,
				value: datumValue(props.series, own.datum, own.index),
				format: frame?.format("series"),
				color: own.fill,
			},
			{
				channel: "size",
				of: props.size,
				value: datumValue(props.size, own.datum, own.index),
				format: frame?.format("size"),
			},
		],
		own.datum,
		own.index,
		state.tooltip ?? undefined,
	);
}

/**
 * A scatter plot or bubble chart: one marker per datum at `(x, y)`, sized
 * and coloured by value or constant. Drawn as one instances node: hover and
 * tooltips resolve per marker (`event.key` is the datum's key), the layer is
 * one tab stop whose markers the arrow keys walk, and `transition` tweens or
 * springs markers to new data. `to` + `blend` is the seekable keyed
 * transition; `time` + `at` plays the data back through time.
 *
 * @example
 * ```ts
 * import { chart, scatter } from "@sophistry/charts";
 *
 * const cities = [
 * 	{ gdp: 15, life: 76, population: 10, continent: "South America" },
 * 	{ gdp: 80, life: 83, population: 1, continent: "Europe" },
 * 	{ gdp: 12, life: 71, population: 20, continent: "Asia" },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [scatter.create({ data: cities, x: "gdp", y: "life", size: "population", series: "continent", tooltip: true })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#lines-scatter-and-error-bars
 * @category Charts
 */
export const scatter = defineComposite<ScatterProps<AnyDatum>>({
	name: "Scatter",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		size: { invalidates: Invalidate.UPDATE },
		sizeRange: { invalidates: Invalidate.UPDATE },
		sizeMaxValue: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		symbol: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		staggerOrder: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		time: { invalidates: Invalidate.UPDATE },
		at: { invalidates: Invalidate.UPDATE },
		timeFade: { invalidates: Invalidate.UPDATE },
		trail: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const tooltip = ctx.context(tooltipContext);
		const owner = {};
		const state: ScatterState = {
			layer,
			tooltip,
			owner,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			toSeries: createSeries<AnyDatum>(layer),
			dots: createBatchedMark<
				Marker,
				SymbolMarkerProps,
				SceneNode<SymbolMarkerProps>,
				keyof SymbolMarkerProps
			>(symbolMarker as never, {
				channels: {
					// The items are the drawn markers; the centre and the reveal
					// come from the frame (`index` is the marker's slot).
					center: (_, index) => {
						const centers = state.frame.centers;
						return {
							x: centers[2 * index] as number,
							y: centers[2 * index + 1] as number,
						};
					},
					radius: (own) =>
						own.presence >= 1
							? own.radius
							: own.radius * Math.max(0, own.presence),
					fill: (own) => own.fill,
					symbol: (own) => own.symbol,
					progress: (own) => markerReveal(state.frame, own),
				},
				enter: { radius: 0 },
				exit: { radius: 0 },
			}),
			trail: null,
			sides: { from: keyedMemo(), to: keyedMemo() },
			radii: { from: keyedMemo(), to: keyedMemo() },
			radiusOf: keyedMemo(),
			colorOf: keyedMemo(),
			timeline: keyedMemo(),
			markers: keyedMemo(),
			ranks: keyedMemo(),
			drawn: keyedMemo(),
			frame: {
				centers: new Float64Array(0),
				progress: 1,
				rankOf: undefined,
				total: 0,
				stagger: 0,
			},
			lastItems: null,
			rankOf: keyedMemo(),
			report: keyedMemo(),
			shared: stableShared(),
			handlers: () => ({}),
			current: { props: ctx.props, frame: null },
		};
		state.handlers = createItemHandlers(
			tooltip,
			(item) => {
				const own = state.dots.itemAt(item);
				return own ? tipOf(state, own) : undefined;
			},
			(item) => {
				const slot = state.dots.itemAt(item)?.slot;
				if (slot === undefined) return undefined;
				const centers = state.frame.centers;
				return {
					x: centers[2 * slot] as number,
					y: centers[2 * slot + 1] as number,
				};
			},
		);
		ctx.onDispose(() => tooltip?.offerPoints(owner, null));
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
