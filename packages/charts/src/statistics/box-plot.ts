/**
 * `boxPlot`: a box-and-whisker plot, its own chart with one box per group.
 *
 * The preset reads each group's sample and name (`groups.ts`), lays the
 * groups out on a band x axis and fits a value y axis, and draws its boxes
 * through an inner layer. Each box is whiskers with caps, a box over the
 * quartiles, a median line and outlier dots. The layer draws every box,
 * whisker and median as **one path batch** (each box's outlines differ, and
 * one batch keeps the paint order within a box: whiskers, box, median),
 * and the outliers as **one instances node** of circles keyed by box and
 * outlier. Hover resolves per item (`event.item`).
 *
 * Reveals and keyed transitions are geometry: a box opens
 * out of its median (its edges `opened` of the way to the quartiles), then
 * its whiskers reach out (each part drawn whole once begun), then each
 * outlier traces its outline as its fill comes up (its item's `progress`).
 */

import type {
	CircleProps,
	CompositeContext,
	CoordinateSystem,
	PathBatchItem,
	SceneNode,
} from "@sophistry/core";
import {
	circle,
	defineComposite,
	Invalidate,
	pathBatch,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Point, Range } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import { chart } from "../chart.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel } from "../data/channels.js";
import { colorResolver, dateSinkContext } from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { ChartProps, ChartYAxisOptions } from "../frame/types.js";
import type { JoinEnd, JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrames,
	layerTransition,
	transitionColor,
} from "../join.js";
import type { BoxplotStats } from "../math/boxplot.js";
import { boxplotStats } from "../math/boxplot.js";
import { dodgeSpan } from "../math/dodge.js";
import type { JoinStaging } from "../math/join.js";
import { uniqueKeys } from "../math/ordinal.js";
import { blendCss } from "../mix.js";
import type { AnyDatum, RevealProps, TransitionProps } from "../props.js";
import type { Category } from "../series.js";
import { createSeries, dodgeSlotsFor } from "../series.js";
import { ranks, staggered } from "../stagger.js";
import { mix, shallowEqual } from "../util.js";
import type { GroupTransition } from "./groups.js";
import {
	categoryName,
	createGroupData,
	DODGE_GAP,
	presetChartProps,
	updateChanged,
} from "./groups.js";

/** Box width as a fraction of the slot pitch. */
const DEFAULT_BOX_WIDTH = 0.6;
const DEFAULT_WHISKER_SCALE = 1.5;
const DEFAULT_FILL_OPACITY = 0.75;
const DEFAULT_NAME_FONT_SIZE = 0.28;
const OUTLIER_RADIUS = 0.06;
/** Where each part of one box's reveal ends, as a share of it: box, whiskers, outliers. */
const BOX_END = 0.5;
const WHISKER_END = 0.85;

/**
 * Props of {@link boxPlot}. `values` is required unless `data` is
 * `number[][]`.
 *
 * @category Charts
 */
export interface BoxPlotProps<T = unknown>
	extends TransitionProps<T>,
		RevealProps {
	/** One box per datum, each holding (or yielding via `values`) one group's raw sample. */
	data: readonly T[];
	/**
	 * The group's raw sample, in data units. Defaults to the datum when `data` is `number[][]`;
	 * required otherwise. Non-finite entries are dropped.
	 */
	values?: Channel<T, readonly number[]>;
	/** The name drawn under each box. With a `series`, boxes sharing a name share its slot. */
	label?: Channel<T, string>;
	/**
	 * The series each box belongs to: colours boxes through the chart's colour scale and legend;
	 * with a `label`, boxes sharing a name stand side by side in its slot. `color` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * The legend for `series`: `"right"`, `"top"`, or `false`. As `chart`'s `legend`. Defaults to
	 * `"right"` with a series.
	 */
	legend?: boolean | "right" | "top";
	/** `[min, max, step?]` in data units. Omitted, fitted to every group's data (including 0). */
	yRange?: Range;
	/** Width of the plotting area. */
	width: number;
	/** Height of the plotting area. */
	height: number;
	/** Centre of the plotting area. Defaults to the origin. */
	center?: Point;
	/**
	 * Box width as a fraction of the slot pitch.
	 * @default 0.6
	 */
	boxWidth?: number;
	/**
	 * Tukey fence multiplier: how many IQRs past the box a whisker may reach before a point is an
	 * outlier.
	 * @default 1.5
	 */
	whiskerScale?: number;
	/**
	 * One colour for every box, or `(d, i) => colour`. Wins over `colors` and `series` (whose
	 * legend then goes).
	 */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the boxes by index, or across the `series` categories. Defaults to the
	 * theme's categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity, 0..1.
	 * @default 0.75
	 */
	fillOpacity?: number;
	/**
	 * The value axis: `false` hides it; an object styles it and sets its ticks.
	 * @default true
	 */
	yAxis?: boolean | ChartYAxisOptions;
	/**
	 * Whether to draw the line the boxes stand on.
	 * @default true
	 */
	baseline?: boolean;
	/**
	 * Font size of the box labels.
	 * @default 0.28
	 */
	labelFontSize?: number;
	/**
	 * Reveal, 0..1: the frame first, then each box opens out of its median, its whiskers reach out,
	 * and its outliers fade in.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the boxes' reveal spent staggering box after box, left to right, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/**
	 * The data to transition to, groups matched by `label` and `series` (else by place): statistics
	 * move to their new values, outliers move with the box, new groups open from their median and
	 * removed ones close. See {@link TransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** Paint order; higher draws later. */
	zIndex?: number;
	visible?: boolean;
	/** Drawn inside the chart's coordinate context. */
	children?: readonly SceneNode[];
}

/* ------------------------------------------------------------------ layer */

/** Props of the inner layer: what the preset has read, plus the style. */
interface BoxesProps<T = unknown> {
	data: readonly T[];
	groups: readonly (readonly number[])[];
	slots: (index: number) => BandKey;
	/** Boxes sharing a slot stand side by side, one sub-slot per series. */
	dodge: boolean;
	series?: Channel<T, BandKey>;
	stagger: number;
	whiskerScale: number;
	color?: ColorChannel<T>;
	colors?: readonly ColorInput[];
	fillOpacity?: number;
	zIndex?: number;
	visible?: boolean;
	transition?: GroupTransition<T>;
	blend?: number;
	staging?: JoinStaging;
	enterStagger?: number;
}

/** An outlier of a box in a keyed transition: its key within the box, its value, and how present it is (0..1). */
interface Outlier {
	key: string;
	value: number;
	weight: number;
}

/** A box in data units: where it stands, its summary, its colour and its outliers. */
interface BoxState {
	center: number;
	half: number;
	q1: number;
	median: number;
	q3: number;
	low: number;
	high: number;
	color: string;
	outliers: readonly Outlier[];
}

/** One outlier dot on a frame. */
interface OutlierDot extends BatchItem {
	center: Point;
	color: string;
	/** How far into its reveal: its outline traced, its fill coming up. */
	progress: number;
	opacity: number;
}

/**
 * Each outlier's key within its box: its side and place counting outward (`lo:0` nearest below,
 * `hi:0` nearest above), in ascending value.
 */
function keyedOutliers(stats: BoxplotStats): Outlier[] {
	const below = stats.outliers.filter((value) => value < stats.q1);
	return stats.outliers.map((value, i) => ({
		key:
			i < below.length
				? `lo:${below.length - 1 - i}`
				: `hi:${i - below.length}`,
		value,
		weight: 1,
	}));
}

function boxState(
	stats: BoxplotStats,
	place: { center: number; half: number },
	color: string,
): BoxState {
	return {
		center: place.center,
		half: place.half,
		q1: stats.q1,
		median: stats.median,
		q3: stats.q3,
		low: stats.low,
		high: stats.high,
		color,
		outliers: keyedOutliers(stats),
	};
}

/**
 * Two boxes blended at `u`: place and statistics in data units, colours in OKLCH, matched outliers
 * moving and the rest fading.
 */
function blendBox(a: BoxState, b: BoxState, u: number): BoxState {
	const far = new Map(b.outliers.map((o) => [o.key, o]));
	const outliers: Outlier[] = a.outliers.map((o) => {
		const match = far.get(o.key);
		return match
			? { key: o.key, value: mix(o.value, match.value, u), weight: 1 }
			: { ...o, weight: 1 - u };
	});
	const near = new Set(a.outliers.map((o) => o.key));
	for (const o of b.outliers)
		if (!near.has(o.key)) outliers.push({ ...o, weight: u });
	return {
		center: mix(a.center, b.center, u),
		half: mix(a.half, b.half, u),
		q1: mix(a.q1, b.q1, u),
		median: mix(a.median, b.median, u),
		q3: mix(a.q3, b.q3, u),
		low: mix(a.low, b.low, u),
		high: mix(a.high, b.high, u),
		color: blendCss(a.color, b.color, u),
		outliers,
	};
}

/** A key as a string, unique across key types (`1` and `"1"` differ). */
const keyString = (key: BandKey) => `${typeof key}:${String(key)}`;

/** What the layer keeps between updates. */
interface BoxesState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	stats: (
		groups: readonly (readonly number[])[] | undefined,
		whiskerScale: number,
	) => (BoxplotStats | null)[] | undefined;
	toStats: (
		groups: readonly (readonly number[])[] | undefined,
		whiskerScale: number,
	) => (BoxplotStats | null)[] | undefined;
	boxes: SceneNode;
	dots: ReturnType<
		typeof createBatchedMark<
			OutlierDot,
			CircleProps,
			SceneNode<CircleProps>,
			keyof CircleProps
		>
	>;
	/** Each key's items, by box frame, so an unchanged box hands the batch the same item objects. */
	itemCache: Map<BandKey, { signature: string; items: PathBatchItem[] }>;
}

const boxesStates = new WeakMap<object, BoxesState>();

/** Each group's summary, cached by the groups and fence. */
function statsCache() {
	let last:
		| {
				groups: readonly (readonly number[])[] | undefined;
				scale: number;
				value: (BoxplotStats | null)[] | undefined;
		  }
		| undefined;
	return (
		groups: readonly (readonly number[])[] | undefined,
		whiskerScale: number,
	) => {
		if (last && last.groups === groups && last.scale === whiskerScale)
			return last.value;
		const value = groups?.map((group) => boxplotStats(group, { whiskerScale }));
		last = { groups, scale: whiskerScale, value };
		return value;
	};
}

function drawBoxes(ctx: CompositeContext<BoxesProps<AnyDatum>>): SceneNode[] {
	const state = boxesStates.get(ctx.node) as BoxesState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) return [state.boxes, state.dots.node];
	const theme = ctx.theme;
	const dates = ctx.context(dateSinkContext);
	const transition = props.transition;

	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined,
		mark: { fill: true },
		dates,
	});
	const keyed = state.keyed({
		data: props.data,
		to: transition?.to,
		key: transition?.key,
		series: props.series,
		of: series.of,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		dates,
	});
	const dodging =
		props.dodge && series.of
			? dodgeSlotsFor(series.of, series.categories, series.scale)
			: undefined;
	/** The far end's sub-slots, by the series `to` has. */
	const toDodging =
		props.dodge && keyed.toOf
			? dodgeSlotsFor(keyed.toOf, uniqueKeys(keyed.toOf), series.scale)
			: undefined;

	const stats = state.stats(props.groups, props.whiskerScale) ?? [];
	const toStats = state.toStats(transition?.groups, props.whiskerScale);
	/** Whether a key's group draws at each end: a box only one end draws enters or exits. */
	let enters = false;
	let exits = false;
	if (toStats) {
		for (const key of keyed.keys) {
			const fi = keyed.fromIndex(key);
			const ti = keyed.toIndex(key);
			const a = fi >= 0 && !!stats[fi];
			const b = ti >= 0 && !!toStats[ti];
			enters ||= b && !a;
			exits ||= a && !b;
		}
	}
	const color = series.extent;
	layer.report(
		transition
			? {
					x: { categories: transition.slots.from.categories },
					y: { values: props.groups.flat(), zero: true },
					color: transitionColor(color, keyed.toOf),
					transition: layerTransition(keyed, props.staging, {
						x: { categories: transition.slots.to.categories },
						y: { values: transition.groups.flat(), zero: true },
						enters,
						exits,
					}),
				}
			: { color },
	);

	const space = endSpace(frame, coords);
	/** One end's box centres and half-widths along x, in data units. */
	const placesOf = (
		end: JoinEnd,
		data: readonly unknown[],
		slotOf: (index: number) => BandKey,
		dodge: typeof dodging,
	) => {
		const band = space.band(end, "x");
		return data.map((_, index) => {
			const key = slotOf(index);
			if (!band) return { center: index + 0.5, half: 0 };
			const start = band.start(key) ?? index;
			const slot = dodge?.of(index);
			if (!dodge || slot === undefined || dodge.count <= 1) {
				return {
					center: start + band.bandwidth / 2,
					half: band.bandwidth / 2,
				};
			}
			const [from, to] = dodgeSpan(slot, dodge.count, DODGE_GAP);
			return {
				center: start + (band.bandwidth * (from + to)) / 2,
				half: (band.bandwidth * (to - from)) / 2,
			};
		});
	};
	const places = placesOf("from", props.data, props.slots, dodging);
	const toPlaces = transition
		? placesOf("to", transition.to, transition.slots.to.of, toDodging)
		: undefined;

	const palette = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	/** One end's colour for a datum. */
	const colorOf = (
		data: readonly unknown[],
		of: readonly Category[] | undefined,
		index: number,
	) => series.colorOf(of?.[index]) ?? palette(data[index], index);

	const stateOf = (end: JoinEnd, index: number): BoxState | undefined => {
		const own = end === "from" ? stats[index] : toStats?.[index];
		const place = end === "from" ? places : toPlaces;
		if (!own || !place) return undefined;
		const data = end === "from" ? props.data : (transition?.to ?? []);
		const of = end === "from" ? series.of : keyed.toOf;
		return boxState(own, place[index] as never, colorOf(data, of, index));
	};
	const frames = joinFrames(keyed, stateOf, blendBox);

	/** Left to right: the stagger order, by where each key's box stands (or would, with no sample). */
	const keys = keyed.keys;
	const centers = keys.map((key) => {
		const own = frames.get(key);
		if (own) return own.state.center;
		const fi = keyed.fromIndex(key);
		if (fi >= 0) return places[fi]?.center ?? Number.NaN;
		return toPlaces?.[keyed.toIndex(key)]?.center ?? Number.NaN;
	});
	const order = props.stagger > 0 ? ranks(centers) : undefined;
	const progress = layer.progress(undefined) ?? 1;
	const background = theme.palette.background;

	const items: PathBatchItem[] = [];
	const dots: OutlierDot[] = [];
	const cache = new Map<
		BandKey,
		{ signature: string; items: PathBatchItem[] }
	>();
	keys.forEach((key, i) => {
		const own = frames.get(key) as JoinFrame<BoxState> | undefined;
		if (!own || own.presence <= 0) return;
		/** This box's own reveal, its presence in the join folded in (an exit is the reveal run back). */
		const t =
			staggered(progress, order?.[i] ?? 0, keys.length, props.stagger) *
			own.presence;
		const opened = clamp01(t / BOX_END);
		const reached = clamp01((t - BOX_END) / (WHISKER_END - BOX_END));
		const outlying = clamp01((t - WHISKER_END) / (1 - WHISKER_END));
		const box = own.state;
		const drawn = boxItems(coords, box, opened, reached, background);
		const signature = drawn.signature;
		const previous = state.itemCache.get(key);
		const kept =
			previous && previous.signature === signature ? previous : drawn;
		cache.set(key, kept);
		for (const item of kept.items) items.push(item);
		if (outlying > 0) {
			const cx = coords.coordsToPoint(box.center, 0).x;
			const prefix = keyString(key);
			for (const o of box.outliers) {
				dots.push({
					key: `${prefix}\u0001${o.key}`,
					center: { x: cx, y: coords.coordsToPoint(0, o.value).y },
					color: box.color,
					progress: outlying,
					// A matched outlier is whole; one only one end has fades with the update.
					opacity: o.weight < 1 ? o.weight : 1,
				});
			}
		}
	});
	state.itemCache = cache;

	const visible = props.visible;
	state.boxes.update({
		items,
		fillOpacity: props.fillOpacity ?? DEFAULT_FILL_OPACITY,
		zIndex: props.zIndex,
		visible,
	} as never);
	state.dots.update(dots, {
		zIndex: props.zIndex,
		visible,
	} as never);
	return [state.boxes, state.dots.node];
}

/**
 * One box's path-batch items in scene units, `opened` and `reached` of the
 * way through its reveal: its whiskers and caps (once they have begun), its
 * box and its median line (once it has begun opening). In paint order.
 */
function boxItems(
	coords: CoordinateSystem,
	box: BoxState,
	opened: number,
	reached: number,
	background: string,
): { signature: string; items: PathBatchItem[] } {
	const cx = coords.coordsToPoint(box.center, 0).x;
	/** Half the box's width in scene units. */
	const halfWidth = Math.abs(
		coords.coordsToPoint(box.half, 0).x - coords.coordsToPoint(0, 0).x,
	);
	const yOf = (value: number) => coords.coordsToPoint(0, value).y;
	const medianY = yOf(box.median);
	/** `value`, `share` of the way out from `from`, in scene y. */
	const outFrom = (from: number, value: number, share: number) =>
		from + (yOf(value) - from) * share;
	const boxTop = outFrom(medianY, box.q3, opened);
	const boxBottom = outFrom(medianY, box.q1, opened);
	const highY = outFrom(boxTop, box.high, reached);
	const lowY = outFrom(boxBottom, box.low, reached);
	const capHalf = halfWidth / 2;
	const signature = [
		cx,
		halfWidth,
		medianY,
		boxTop,
		boxBottom,
		highY,
		lowY,
		box.color,
		background,
		opened > 0,
		reached > 0,
	].join(" ");
	const items: PathBatchItem[] = [];
	if (reached > 0) {
		// Whiskers: box edge to the fence-clipped extreme, each capped.
		items.push({
			closed: false,
			stroke: box.color,
			polylines: [
				[
					{ x: cx, y: boxTop },
					{ x: cx, y: highY },
				],
				[
					{ x: cx, y: boxBottom },
					{ x: cx, y: lowY },
				],
				[
					{ x: cx - capHalf, y: highY },
					{ x: cx + capHalf, y: highY },
				],
				[
					{ x: cx - capHalf, y: lowY },
					{ x: cx + capHalf, y: lowY },
				],
			],
		});
	}
	if (opened > 0) {
		// The box itself, q1 to q3.
		const top = Math.max(boxTop, boxBottom);
		const bottom = Math.min(boxTop, boxBottom);
		items.push({
			closed: true,
			fill: box.color,
			stroke: box.color,
			polylines: [
				[
					{ x: cx - halfWidth, y: bottom },
					{ x: cx + halfWidth, y: bottom },
					{ x: cx + halfWidth, y: top },
					{ x: cx - halfWidth, y: top },
				],
			],
		});
		// Median line, spanning the box's full width.
		items.push({
			closed: false,
			stroke: background,
			polylines: [
				[
					{ x: cx - halfWidth, y: medianY },
					{ x: cx + halfWidth, y: medianY },
				],
			],
		});
	}
	return { signature, items };
}

/**
 * The boxes of a {@link boxPlot}: one cluster per group in its slot's band
 * (a sub-band when dodging); with a `transition`, one per join key, blended
 * by `blendBox`. Internal: the preset is the public API.
 */
const boxPlotBoxes = defineComposite<BoxesProps<AnyDatum>>({
	name: "BoxPlotBoxes",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		groups: { default: [], invalidates: Invalidate.UPDATE },
		slots: {
			default: (index: number) => index,
			invalidates: Invalidate.UPDATE,
		},
		dodge: { default: false, invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		stagger: { default: 0, invalidates: Invalidate.UPDATE },
		whiskerScale: {
			default: DEFAULT_WHISKER_SCALE,
			invalidates: Invalidate.UPDATE,
		},
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		boxesStates.set(ctx.node, {
			layer,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			stats: statsCache(),
			toStats: statsCache(),
			boxes: pathBatch.create({ items: [] }),
			dots: createBatchedMark<
				OutlierDot,
				CircleProps,
				SceneNode<CircleProps>,
				keyof CircleProps
			>(circle as never, {
				channels: {
					center: (item) => item.center,
					fill: (item) => item.color,
					stroke: (item) => item.color,
					opacity: (item) => item.opacity,
					progress: (item) => item.progress,
					radius: () => OUTLIER_RADIUS,
				},
			}),
			itemCache: new Map(),
		});
		return drawBoxes(ctx);
	},
	update: (_changed, ctx) => drawBoxes(ctx),
});

/* ----------------------------------------------------------------- preset */

/** What the preset keeps between updates. */
interface BoxPlotState {
	read: ReturnType<typeof createGroupData<AnyDatum>>;
	latest: ReturnType<ReturnType<typeof createGroupData<AnyDatum>>> | null;
	categoryLabel: (key: BandKey, index: number) => string;
	boxes: SceneNode<BoxesProps<AnyDatum>>;
	plot: SceneNode<ChartProps>;
	lastChart: Partial<ChartProps> | undefined;
	lastLayer: Partial<BoxesProps<AnyDatum>> | undefined;
	children: readonly SceneNode[];
}

const presetStates = new WeakMap<object, BoxPlotState>();

function drawPreset(
	ctx: CompositeContext<BoxPlotProps<AnyDatum>>,
): SceneNode[] {
	const state = presetStates.get(ctx.node) as BoxPlotState;
	const props = ctx.props;
	const read = state.read(props);
	state.latest = read;
	state.lastLayer = updateChanged(
		state.boxes,
		{
			data: props.data,
			groups: read.groups,
			slots: read.ends?.from.of ?? read.slots.of,
			dodge: read.ends?.dodge ?? read.slots.named,
			series: props.series,
			stagger: props.stagger ?? 0,
			whiskerScale: props.whiskerScale ?? DEFAULT_WHISKER_SCALE,
			color: props.color,
			colors: props.colors,
			fillOpacity: props.fillOpacity,
			zIndex: props.zIndex,
			visible: props.visible,
			transition: read.transition,
			blend: props.blend,
			staging: props.staging,
			enterStagger: props.enterStagger,
		},
		state.lastLayer,
		Object.is,
	);
	state.lastChart = updateChanged(
		state.plot,
		presetChartProps(props, read, {
			padding: 1 - (props.boxWidth ?? DEFAULT_BOX_WIDTH),
			numberFontSize: props.labelFontSize ?? DEFAULT_NAME_FONT_SIZE,
			line: props.baseline !== false,
			categoryLabel: state.categoryLabel,
		}),
		state.lastChart,
	);
	const children = [state.boxes, ...ctx.children];
	if (!shallowEqual(children, state.children)) {
		state.children = children;
		state.plot.set("children", children as never);
	}
	return [state.plot];
}

/**
 * A box-and-whisker plot: one box per group over the quartiles with the
 * median marked, whiskers to the furthest points within `whiskerScale` IQRs,
 * and outliers as dots. It is its own plot, sized by `width`/`height`; don't
 * put it inside an `axes` or `chart`. Boxes, whiskers and medians draw as one
 * path batch, outliers as one instances node. See {@link boxplotStats} for
 * the statistics alone.
 *
 * @example
 * ```ts
 * import { boxPlot } from "@sophistry/charts";
 *
 * boxPlot.create({
 * 	data: [
 * 		{ arm: "control", scores: [3, 4, 4, 5, 6, 7, 12] },
 * 		{ arm: "treated", scores: [5, 6, 7, 7, 8, 9, 10] },
 * 	],
 * 	values: "scores",
 * 	label: "arm",
 * 	width: 6,
 * 	height: 4,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#box-and-violin-plots
 * @category Charts
 */
export const boxPlot = defineComposite<BoxPlotProps<AnyDatum>>({
	name: "BoxPlot",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		values: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		legend: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		boxWidth: { invalidates: Invalidate.UPDATE },
		whiskerScale: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		yAxis: { invalidates: Invalidate.UPDATE },
		baseline: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: BoxPlotState = {
			read: createGroupData<AnyDatum>(),
			latest: null,
			categoryLabel: (key, index) =>
				state.latest ? categoryName(state.latest, key, index) : String(key),
			boxes: boxPlotBoxes.create({} as never),
			plot: chart.create({ width: 8, height: 4 }),
			lastChart: undefined,
			lastLayer: undefined,
			children: [],
		};
		presetStates.set(ctx.node, state);
		return drawPreset(ctx);
	},
	update: (_changed, ctx) => drawPreset(ctx),
});
