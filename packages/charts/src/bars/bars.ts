/**
 * `bars`: bars on a categorical axis, one per datum, drawn as one instances
 * node of `rect`s; their value labels are label nodes in a keyed list.
 *
 * Follows the per-datum mark steps of `points/scatter.ts`, with the bar's
 * own pieces:
 *
 * - each dataset becomes a {@link BarSide} (categories, values, bases,
 *   sub-bands, stacks, totals), cached by its inputs, so a frame of a
 *   reveal or a blend reuses it;
 * - the keyed join (`createKeyedData`) pairs bars across `data` and `to`;
 *   a bar in both slides to its new band and value, a bar only in `to`
 *   grows out of its foot, one only in `data` shrinks into it (or fades
 *   when it can't shrink); mid axis-kind swap each end draws through its
 *   own plot and the boxes blend in scene units;
 * - the reveal scales each box off its foot (`"grow"`), about zero
 *   (`"stack"`), or fades it (`"fade"`, or on an axis without zero). It
 *   is geometry and per-item opacity, so it batches; a bar not started is
 *   left out of the batch.
 */

import type {
	CompositeContext,
	CoordinateSystem,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	rect,
	text,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, BandScale, Bounds } from "@sophistry/core/geometry";
import { growsFromZero } from "../band.js";
import type { BatchItem, MarkTransition } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel, DateSink } from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
	resolveChannel,
} from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { AxisExtent } from "../frame/types.js";
import { itemTooltipHandlers } from "../item-tooltip.js";
import type { JoinEnd } from "../join.js";
import { createKeyedData, layerTransition, transitionColor } from "../join.js";
import type { StackTotal } from "../math/barLabels.js";
import {
	barLabelValues,
	mixBarLabelValues,
	stackTotals,
} from "../math/barLabels.js";
import type { StackOffset } from "../math/stack.js";
import { blendCss, mixBounds } from "../mix.js";
import type {
	AnyDatum,
	BarReveal,
	KeyedTransitionProps,
	RevealProps,
	StaggerOrder,
} from "../props.js";
import type { Category } from "../series.js";
import { createSeries } from "../series.js";
import { hashRanks, ranks, staggered } from "../stagger.js";
import type { TooltipSpec } from "../tooltip.js";
import { tooltipContext, tooltipText } from "../tooltip.js";
import { keyedMemo, mix } from "../util.js";
import type { BarLabelEntry, BarLabelOptions } from "./bar-labels.js";
import { barLabelEntries, barLabelSettings } from "./bar-labels.js";
import { tooltipProps } from "./shared.js";
import type { StackOptions } from "./transforms.js";
import { dodge, stack } from "./transforms.js";

const DEFAULT_FILL_OPACITY = 0.75;

/**
 * What {@link barsHandle} hands back.
 *
 * @category Charts
 */
export interface BarsHandle {
	/** How many bars there are — `data.length`. */
	count(): number;
	/**
	 * One bar's full-height box in scene units, or null if the index is out of range, its value is not
	 * finite, or its category is not on the axis.
	 */
	barBounds(index: number): Bounds | null;
}

/**
 * Props of {@link bars}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface BarsProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One bar per datum. */
	data: readonly T[];
	/** The bar's category: which band it stands in. Defaults to the datum's index. */
	category?: Channel<T, BandKey>;
	/**
	 * The bar's value, in data units. Defaults to the datum itself when `data` is `number[]`; required
	 * otherwise. Non-finite values leave the band empty.
	 */
	value?: Channel<T, number>;
	/**
	 * `"vertical"` stands bars on a categorical x axis; `"horizontal"` lays them along a categorical y
	 * axis.
	 * @default "vertical"
	 */
	orientation?: "vertical" | "horizontal";
	/**
	 * The series each bar belongs to: colours the bars through the chart's shared colour scale and
	 * legend, and is what `layout` stacks or dodges.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * Each bar's identity across data changes and transitions. See {@link KeyedTransitionProps}.
	 * Defaults to the datum's place within its `series`, else its index.
	 */
	key?: Channel<T, BandKey>;
	/**
	 * How bars sharing a category are arranged: `"overlay"` each fills its band (or `subband`) from
	 * its `base`; `"stack"` end to end by series (negative values stack down; replaces `base`);
	 * `"dodge"` side by side, one sub-band per series (replaces `subband`). Without a `series`, bars
	 * are told apart by their order.
	 * @default "overlay"
	 */
	layout?: "overlay" | "stack" | "dodge";
	/**
	 * With `layout="stack"`: `"zero"` or `"normalize"` (shares of the total). See {@link StackOffset}.
	 * @default "zero"
	 */
	offset?: StackOffset;
	/**
	 * With `layout="stack"`: which series sits at the bottom: `"appearance"`, `"reverse"`, `"sum"`,
	 * `"insideOut"`, or the series keys bottom to top.
	 * @default "appearance"
	 */
	order?: StackOptions<T>["order"];
	/** One colour for every bar, or `(d, i) => colour`. Wins over `colors` and `series`. */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the bars by index. Wins over `series`. Defaults to the theme's
	 * categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity, 0..1.
	 * @default 0.75
	 */
	fillOpacity?: number;
	/** Outline width. */
	strokeWidth?: number;
	/**
	 * Where each bar starts, in data units, for floating bars (Gantt spans, waterfall steps). Omitted,
	 * bars start at the baseline and the chart keeps zero in view.
	 */
	base?: Channel<T, number>;
	/**
	 * The part `[from, to]` of the category's band the bar fills, as fractions (what {@link dodge}
	 * writes). Omitted, the bar fills its band.
	 */
	subband?: Channel<T, readonly [number, number]>;
	/**
	 * How `progress` reveals the bars: `"grow"` out of their foot, `"stack"` the whole stack scaled
	 * about zero together, `"fade"` in at full length. With no zero on the value axis (log or
	 * truncated), bars fade. Defaults to `"grow"` (`"stack"` under `layout="stack"`).
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	reveal?: BarReveal;
	/**
	 * Value labels: `true` writes each bar's number past its end, a channel writes your own text, and
	 * {@link BarLabelOptions} places and formats them.
	 * @default false
	 */
	labels?: boolean | Channel<T, string> | BarLabelOptions<T>;
	/**
	 * Font size of `labels`.
	 * @default 0.24
	 */
	labelFontSize?: number;
	/**
	 * Reveal, 0..1: every bar grows out of its baseline (or `base`).
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering bar after bar, in category order, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/**
	 * The order `stagger` reveals bars in. See {@link StaggerOrder}.
	 * @default "position"
	 */
	staggerOrder?: StaggerOrder;
	/**
	 * Fraction of a transition's enter stage spent staggering entering bars, in `staggerOrder`. See
	 * {@link TransitionProps}.
	 * @default 0
	 */
	enterStagger?: number;
	/**
	 * The data to transition to, matched to `data` by `key`: bars slide to their new band and value;
	 * new ones grow from their foot, removed ones shrink into it. See {@link KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/**
	 * Hover tooltip: `true` for a row per channel (`category`, `series`, `value`), or a template,
	 * function or options. See {@link TooltipSpec}.
	 */
	tooltip?: TooltipSpec<T>;
	/**
	 * How bars move when `data` changes (outside a `to` blend): a tween or a
	 * spring in the node's tween bank; new bars grow out of their foot,
	 * removed ones shrink into it. Omitted, data changes are instant.
	 */
	transition?: MarkTransition;
	/**
	 * Paint order; higher draws later. The bars paint at `zIndex + UNDER_AXES_Z_INDEX` (above the
	 * grid, under the axis they stand on), their labels at `zIndex`.
	 * @default 0
	 */
	zIndex?: number;
	visible?: boolean;
}

/** The band a bar fills when it has no `subband`: all of it. */
const FULL_BAND: readonly [number, number] = [0, 1];

/** One dataset's bars, in data units, one entry per datum. */
interface BarSide<T> {
	data: readonly T[];
	categories: BandKey[];
	/** Each bar's own value (a stacked segment's, not where it ends). */
	own: number[];
	/** Where each bar ends. */
	values: number[];
	/** Where each bar starts, when not at the baseline. */
	bases: number[] | undefined;
	subbands: (readonly [number, number])[] | undefined;
	series: readonly Category[] | undefined;
	stacked: boolean;
	/** Whether the stack is of shares (`offset="normalize"`). */
	normalized: boolean;
	/** Each stacked bar's side of its stack's total. */
	totals: (StackTotal | undefined)[] | undefined;
}

/** One bar in data units: its band's start, its share of the band, and its ends. */
interface BarData {
	start: number;
	sub: readonly [number, number];
	foot: number;
	value: number;
}

/** What a bar is on one frame. */
interface BarState<T> {
	/** The dataset its datum is read from (the nearer end of a transition). */
	side: BarSide<T>;
	index: number;
	bar: BarData;
	/** 0..1: how present it is while entering or leaving. */
	presence: number;
	color: string;
	/** The value its tooltip (and `labels={true}`) shows. */
	value: number;
	/** The number its labels write: `value`, or a normalized segment's share. */
	share: number;
	/** Its stack's total when it ends its side of the stack, else undefined. */
	total: number | undefined;
	/**
	 * While an axis changes kind mid-transition: the end whose plot the bar maps through, and its box
	 * (or band width) there.
	 */
	end?: JoinEnd;
	box?: Bounds;
	width?: number;
}

/** What one bar draws on a frame. */
interface BarItem extends BatchItem {
	box: Bounds;
	fill: string;
	opacity: number;
	/** Its state, for the tooltip. */
	state: BarState<unknown>;
}

type BarRects = ReturnType<
	typeof createBatchedMark<
		BarItem,
		RectProps,
		SceneNode<RectProps>,
		keyof RectProps
	>
>;

/** What a `bars` keeps between updates. */
interface BarsState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	from: (
		deps: readonly unknown[],
		make: () => BarSide<unknown>,
	) => BarSide<unknown>;
	to: (
		deps: readonly unknown[],
		make: () => BarSide<unknown>,
	) => BarSide<unknown>;
	rects: BarRects;
	handle: BarsHandle;
	/** The last update's full-height box of a `data` bar. */
	boxFor: (index: number) => Bounds | null;
}

const states = new WeakMap<object, BarsState>();

/**
 * A `bars` node's handle: the bar count and each
 * bar's full-height box as of its last update.
 *
 * @param node - A node made by {@link bars}.
 * @returns The handle, or null for a node that is not a `bars`.
 * @category Charts
 */
export function barsHandle(node: SceneNode): BarsHandle | null {
	return states.get(node)?.handle ?? null;
}

/** Everything a bar needs from its dataset, in data units, one entry per datum. */
function sideOf(
	props: Readonly<BarsProps<unknown>>,
	data: readonly unknown[],
	of: readonly Category[] | undefined,
	dates: DateSink | null,
): BarSide<unknown> {
	const layout = props.layout ?? "overlay";
	const read = resolveChannel<unknown, BandKey>(
		props.category,
		indexOf,
		"category",
		dates,
	);
	const categories = data.map((d, i) => read(d, i) as BandKey);
	const own = numberValues(data, props.value, identity, "value", dates);
	/**
	 * What tells apart the bars sharing a category under a layout: their
	 * series, else their order among that category's bars.
	 */
	const groups = (): readonly unknown[] => {
		if (of) return of;
		const seen = new Map<BandKey, number>();
		return categories.map((key) => {
			const n = seen.get(key) ?? 0;
			seen.set(key, n + 1);
			return n;
		});
	};
	const stacked =
		layout === "stack"
			? (() => {
					const z = groups();
					return stack(data, {
						x: (_, i) => categories[i] as BandKey,
						y: (_, i) => own[i] as number,
						z: (_, i) => z[i] as BandKey,
						offset: props.offset,
						order: props.order as StackOptions<unknown>["order"],
					});
				})()
			: undefined;
	const dodged =
		layout === "dodge"
			? (() => {
					const z = groups();
					return dodge(data, {
						x: (_, i) => categories[i] as BandKey,
						y: () => 0,
						z: (_, i) => z[i] as BandKey,
					}).map((row) => row.subband);
				})()
			: undefined;
	const values = stacked?.map((row) => row.y2) ?? own;
	const bases = stacked
		? stacked.map((row) => row.y1)
		: props.base === undefined
			? undefined
			: numberValues(data, props.base, undefined, "base", dates);
	let subbands: (readonly [number, number])[] | undefined = dodged;
	if (!subbands) {
		const sub = resolveChannel(props.subband, undefined, "subband");
		subbands = sub
			? data.map((d, i) => sub(d, i) as readonly [number, number])
			: undefined;
	}
	return {
		data,
		categories,
		own,
		values,
		bases,
		subbands,
		series: of,
		stacked: !!stacked,
		normalized: !!stacked && props.offset === "normalize",
		totals: stacked ? stackTotals(categories, own, values) : undefined,
	};
}

function draw(ctx: CompositeContext<BarsProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as BarsState;
	const props = ctx.props as Readonly<BarsProps<unknown>>;
	const { layer } = state;
	const plot = layer.frame();
	const coords = layer.coords();
	if (!plot || !coords) throw new Error("Bars must be placed inside a chart.");
	const dates = ctx.context(dateSinkContext);
	const tooltip = ctx.context(tooltipContext);
	const theme = ctx.theme;
	const vertical = props.orientation !== "horizontal";
	const layout = props.layout ?? "overlay";

	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined || props.colors !== undefined,
		mark: { fill: true },
		dates,
	});
	// The keyed join reads `to`'s series; computed once here for both.
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: props.series,
		of: series.of,
		blend: props.blend,
		staging: props.staging,
		chartStages: plot.join,
		enterStagger: props.enterStagger,
		// Entering bars in `staggerOrder`: by key hash, else in the category
		// order of `to` (first appearance), top-down when horizontal.
		enterRanks: (entering, _joined, toIndex) => {
			if (props.staggerOrder === "random") return hashRanks(entering);
			// Read here: the join asks before `to`'s side is built.
			const readCategory = resolveChannel<unknown, BandKey>(
				props.category,
				indexOf,
				"category",
				dates,
			);
			const categories = (props.to ?? []).map(
				(d, i) => readCategory(d, i) as BandKey,
			);
			const slot = new Map<BandKey, number>();
			for (const category of categories)
				if (!slot.has(category)) slot.set(category, slot.size);
			const last = slot.size - 1;
			return ranks(
				entering.map((key) => {
					const index = toIndex(key);
					const at =
						index < 0 ? undefined : slot.get(categories[index] as BandKey);
					if (at === undefined) return Number.NaN;
					return vertical ? at : last - at;
				}),
			);
		},
		dates,
	});
	const sideDeps = [
		props.category,
		props.value,
		props.layout,
		props.offset,
		props.order,
		props.base,
		props.subband,
		dates,
	];
	const own = state.from([props.data, series.of, ...sideDeps], () =>
		sideOf(props, props.data, series.of, dates),
	);
	const far =
		props.to === undefined
			? undefined
			: state.to([props.to, keyed.toOf, ...sideDeps], () =>
					sideOf(props, props.to as readonly unknown[], keyed.toOf, dates),
				);
	const mode = props.reveal ?? (layout === "stack" ? "stack" : "grow");

	/** The value axis's extent for one side. */
	const valueExtent = (side: BarSide<unknown>): AxisExtent => {
		const floating = side.bases;
		// A stack reveals about zero, so zero is in view for it as for bars
		// standing on the baseline.
		return floating
			? { values: side.values.concat(floating), zero: mode === "stack" }
			: { values: side.values, zero: true };
	};
	const bandExtent = { categories: own.categories };
	layer.report({
		...(vertical
			? { x: bandExtent, y: valueExtent(own) }
			: { x: valueExtent(own), y: bandExtent }),
		color: transitionColor(series.extent, far ? keyed.toOf : undefined),
		transition: far
			? layerTransition(keyed, props.staging, {
					...(vertical
						? { x: { categories: far.categories }, y: valueExtent(far) }
						: { x: valueExtent(far), y: { categories: far.categories } }),
				})
			: undefined,
	});

	const band = vertical ? plot.xBand : plot.yBand;
	/**
	 * Where each end draws while an axis changes kind across the transition
	 * (each end's bars through its own plot, blended in scene units).
	 */
	const space = endSpace(plot, coords);
	const swapping = space.swapping;
	/** The band axis's scale at one end mid-swap, else the chart's now. */
	const bandAt = (end: JoinEnd | undefined) =>
		end === undefined ? band : space.band(end, vertical ? "x" : "y");
	/** The plot a bar of one end maps through: that end's mid-swap, else the chart's. */
	const coordsAt = (end: JoinEnd | undefined) =>
		end === undefined ? coords : space.coords(end);
	/** The value axis's baseline, in data units. */
	const baseline = (system: CoordinateSystem = coords) =>
		vertical ? system.crossing().y : system.crossing().x;
	/** Where a bar starts, in data units: its `base`, or the value axis's baseline. */
	const footOf = (
		side: BarSide<unknown>,
		index: number,
		system: CoordinateSystem = coords,
	) => side.bases?.[index] ?? baseline(system);
	const valueRange = vertical ? coords.yRange() : coords.xRange();
	/**
	 * Bars grow from a real zero or their own `base`; one that would stand on
	 * the edge of a truncated or log axis fades in instead.
	 */
	const grows =
		mode === "fade"
			? false
			: mode === "grow" && own.bases !== undefined
				? true
				: growsFromZero(valueRange);
	/** Whether a bar entering or leaving can shrink to its foot (else it fades). */
	const shrinks = own.bases !== undefined || growsFromZero(valueRange);

	/** A bar in data units: where its band starts, its share of it, and its two ends. */
	const barOf = (
		side: BarSide<unknown>,
		index: number,
		scale: BandScale | undefined = band,
		system: CoordinateSystem = coords,
	): BarData | null => {
		const value = side.values[index];
		const foot = footOf(side, index, system);
		const key = side.categories[index];
		if (!scale || value === undefined || !Number.isFinite(value)) return null;
		if (key === undefined || !Number.isFinite(foot)) return null;
		const start = scale.start(key);
		if (start === undefined) return null;
		const sub = side.subbands?.[index] ?? FULL_BAND;
		if (!Number.isFinite(sub[0]) || !Number.isFinite(sub[1])) return null;
		return { start, sub, foot, value };
	};
	/** A bar's full box in scene units, before any reveal. */
	const boxOf = (
		bar: BarData,
		width: number,
		system: CoordinateSystem = coords,
	): Bounds => {
		const start = bar.start + width * bar.sub[0];
		const end = bar.start + width * bar.sub[1];
		const from = Math.min(bar.foot, bar.value);
		const to = Math.max(bar.foot, bar.value);
		const a = vertical
			? system.coordsToPoint(start, from)
			: system.coordsToPoint(from, start);
		const b = vertical
			? system.coordsToPoint(end, to)
			: system.coordsToPoint(to, end);
		return {
			minX: Math.min(a.x, b.x),
			maxX: Math.max(a.x, b.x),
			minY: Math.min(a.y, b.y),
			maxY: Math.max(a.y, b.y),
		};
	};
	state.boxFor = (index) => {
		const bar = barOf(own, index);
		return bar && band ? boxOf(bar, band.bandwidth) : null;
	};

	const colorAt = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const colorFor = (side: BarSide<unknown>, index: number) =>
		series.colorOf(side.series?.[index]) ?? colorAt(side.data[index], index);
	/** The value a bar's tooltip shows: a stacked segment's own, else where it ends. */
	const shownValue = (side: BarSide<unknown>, index: number) =>
		(side.stacked ? side.own[index] : side.values[index]) as number;
	/** Both ends' label values blended for a bar both have. */
	const mixLabelValues = (
		a: BarSide<unknown>,
		ai: number,
		b: BarSide<unknown>,
		bi: number,
		u: number,
	) => mixBarLabelValues(barLabelValues(a, ai), barLabelValues(b, bi), u);

	/** What the bar of `key` is on this frame. */
	const stateOf = (key: BandKey): BarState<unknown> | null => {
		const fi = keyed.fromIndex(key);
		const ti = keyed.toIndex(key);
		// An axis changing kind: each end's bar through its own plot.
		if (swapping && far) return swapState(fi, ti, key);
		if (!band) return null;
		const a = fi >= 0 ? barOf(own, fi) : null;
		if (!far) {
			if (!a) return null;
			return {
				side: own,
				index: fi,
				bar: a,
				presence: 1,
				color: colorFor(own, fi),
				value: shownValue(own, fi),
				...barLabelValues(own, fi),
			};
		}
		const b = ti >= 0 ? barOf(far, ti) : null;
		if (a && b) {
			const u = keyed.update;
			const near = u < 0.5;
			return {
				side: near ? own : far,
				index: near ? fi : ti,
				bar: {
					start: mix(a.start, b.start, u),
					sub: [mix(a.sub[0], b.sub[0], u), mix(a.sub[1], b.sub[1], u)],
					foot: mix(a.foot, b.foot, u),
					value: mix(a.value, b.value, u),
				},
				presence: 1,
				color: blendCss(colorFor(own, fi), colorFor(far, ti), u),
				value: mix(shownValue(own, fi), shownValue(far, ti), u),
				...mixLabelValues(own, fi, far, ti, u),
			};
		}
		if (a)
			return {
				side: own,
				index: fi,
				bar: a,
				presence: 1 - keyed.exit,
				color: colorFor(own, fi),
				value: shownValue(own, fi),
				...barLabelValues(own, fi),
			};
		if (b)
			return {
				side: far,
				index: ti,
				bar: b,
				presence: keyed.enterOf(key),
				color: colorFor(far, ti),
				value: shownValue(far, ti),
				...barLabelValues(far, ti),
			};
		return null;
	};
	/** The bar while an axis changes kind mid-transition, mapped through each end's plot. */
	const swapState = (
		fi: number,
		ti: number,
		key: BandKey,
	): BarState<unknown> | null => {
		const other = far ?? own;
		const at = (side: BarSide<unknown>, index: number, end: JoinEnd) => {
			if (index < 0) return null;
			const scale = bandAt(end);
			const bar = scale ? barOf(side, index, scale, coordsAt(end)) : null;
			return bar && scale ? { bar, width: scale.bandwidth } : null;
		};
		const a = at(own, fi, "from");
		const b = at(other, ti, "to");
		if (a && b) {
			const u = keyed.update;
			const near = u < 0.5;
			return {
				side: near ? own : other,
				index: near ? fi : ti,
				bar: near ? a.bar : b.bar,
				end: near ? "from" : "to",
				box: mixBounds(
					boxOf(a.bar, a.width, coordsAt("from")),
					boxOf(b.bar, b.width, coordsAt("to")),
					u,
				),
				presence: 1,
				color: blendCss(colorFor(own, fi), colorFor(other, ti), u),
				value: mix(shownValue(own, fi), shownValue(other, ti), u),
				...mixLabelValues(own, fi, other, ti, u),
			};
		}
		if (a)
			return {
				side: own,
				index: fi,
				bar: a.bar,
				end: "from",
				width: a.width,
				presence: 1 - keyed.exit,
				color: colorFor(own, fi),
				value: shownValue(own, fi),
				...barLabelValues(own, fi),
			};
		if (b)
			return {
				side: other,
				index: ti,
				bar: b.bar,
				end: "to",
				width: b.width,
				presence: keyed.enterOf(key),
				color: colorFor(other, ti),
				value: shownValue(other, ti),
				...barLabelValues(other, ti),
			};
		return null;
	};

	/** A random reveal order: by a hash of each bar's key. */
	let hashed: Map<BandKey, number> | undefined;
	if (props.staggerOrder === "random" && props.stagger) {
		const order = hashRanks(keyed.keys);
		hashed = new Map();
		keyed.keys.forEach((key, i) => {
			hashed?.set(key, order[i] as number);
		});
	}
	const progress = layer.progress(props.progress) ?? 1;
	const count = hashed ? keyed.keys.length : (band?.domain.length ?? 1);
	/** Whether a bar shrinks to its foot as it leaves (else it fades). */
	const presenceScales = shrinks && mode !== "fade";
	const fillOpacity = props.fillOpacity ?? DEFAULT_FILL_OPACITY;
	const labels = barLabelSettings({
		labels: props.labels,
		labelFontSize: props.labelFontSize,
		vertical,
		coords,
		theme,
		normalized: own.normalized,
	});

	/** The box scaled toward `anchor` (data units, on the value axis) by `f`. */
	const scaleAbout = (
		box: Bounds,
		anchor: number,
		f: number,
		system: CoordinateSystem,
	): Bounds => {
		const foot = vertical
			? system.coordsToPoint(0, anchor).y
			: system.coordsToPoint(anchor, 0).x;
		return vertical
			? {
					...box,
					minY: foot + (box.minY - foot) * f,
					maxY: foot + (box.maxY - foot) * f,
				}
			: {
					...box,
					minX: foot + (box.minX - foot) * f,
					maxX: foot + (box.maxX - foot) * f,
				};
	};

	const items: BarItem[] = [];
	const labelEntries: BarLabelEntry[] = [];
	for (const key of keyed.keys) {
		const bar = stateOf(key);
		if (!bar || bar.presence <= 0) continue;
		/** A bar's place in the reveal: along the band axis, top-down when horizontal; or by key hash. */
		let rank = 0;
		if (hashed) rank = hashed.get(key) ?? 0;
		else {
			const category = bar.side.categories[bar.index];
			if (band && category !== undefined) {
				const slot = band.index(category);
				rank = vertical ? slot : band.domain.length - 1 - slot;
			}
		}
		const t = staggered(progress, rank, count, props.stagger ?? 0);
		// Growing, not wiping: the reveal scales the bar's length off its
		// foot (the baseline, or its base), which is how a chart is read
		// being built. Entering and leaving bars grow and shrink the same
		// way, about their own foot.
		/** The bar at full length on this frame: before its reveal and presence. */
		let rest: Bounds | null = null;
		if (bar.box) rest = bar.box;
		else {
			const width = bar.width ?? (bar.end ? undefined : band?.bandwidth);
			if (width !== undefined) rest = boxOf(bar.bar, width, coordsAt(bar.end));
		}
		if (!rest) continue;
		const system = coordsAt(bar.end);
		let box = rest;
		if (bar.presence < 1 && presenceScales)
			box = scaleAbout(box, bar.bar.foot, bar.presence, system);
		const reveal = grows ? t : 1;
		// Not started: no zero-length outline lying on the axis.
		if (reveal <= 0) continue;
		if (reveal < 1)
			box = scaleAbout(
				box,
				mode === "stack" ? 0 : bar.bar.foot,
				reveal,
				system,
			);
		/** The bar's fade: the reveal when it can't grow, and its presence when it can't shrink. */
		const fade = (presenceScales ? 1 : bar.presence) * (grows ? 1 : t);
		items.push({ key, box, fill: bar.color, opacity: fade, state: bar });
		if (labels.position !== "none" || labels.options?.total) {
			// A stack grows as `value × t` about zero, so each segment's own
			// length (and the stack's total) is its value × t too.
			const foot = bar.side.stacked || mode === "stack" ? 0 : bar.bar.foot;
			barLabelEntries(
				labels,
				{
					key,
					datum: bar.side.data[bar.index],
					index: bar.index,
					value: bar.value,
					share: bar.share,
					total: bar.total,
					presence: bar.presence,
					grown: box,
					rest,
					opacity: fade,
					t,
					counted: (value) => (grows ? foot + (value - foot) * t : value),
					color: bar.color,
					backward: bar.bar.value < bar.bar.foot,
					fillOpacity,
				},
				theme,
				{ zIndex: props.zIndex, visible: props.visible },
				labelEntries,
			);
		}
	}

	const bandAxis = vertical ? "x" : "y";
	const along = vertical ? "y" : "x";
	const handlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const own = state.rects.itemAt(item)?.state;
			if (!own) return undefined;
			return tooltipText(
				props.tooltip,
				() => [
					{
						channel: "category",
						of: props.category,
						value: own.side.categories[own.index],
						format: plot.format(bandAxis),
					},
					{
						channel: "series",
						of: props.series,
						value: own.side.series?.[own.index],
						format: plot.format("series"),
						color: own.color,
					},
					{
						channel: "value",
						of: props.value,
						value: own.value,
						format: plot.format(along),
					},
				],
				own.side.data[own.index],
				own.index,
				tooltip ?? undefined,
			);
		},
		(item) => {
			const box = state.rects.itemAt(item)?.box;
			return box ? { x: (box.minX + box.maxX) / 2, y: box.maxY } : undefined;
		},
		() => "Bars",
	);
	state.rects.update(
		items,
		{
			fillOpacity,
			strokeWidth: props.strokeWidth,
			zIndex: (props.zIndex ?? 0) + UNDER_AXES_Z_INDEX,
			visible: props.visible,
			...tooltipProps(tooltip, props.tooltip, handlers),
		} as never,
		{
			transition: props.transition,
			// Only data changes move through the tween bank; a reveal or a
			// `to` blend is exact on every frame.
			animate: !keyed.active && progress >= 1,
		},
	);
	const labelNodes = ctx.list("labels", labelEntries, {
		key: (entry) => entry.key,
		create: (entry) => text.create(entry.props),
		update: (node, entry) => {
			node.update(entry.props);
		},
	});
	return [state.rects.node, ...labelNodes];
}

/**
 * Bars on a categorical axis, inside a `chart`: the one bar mark behind
 * grouped, stacked, normalized, diverging and floating bar charts. Give it
 * a `series` and a `layout` (or feed it {@link stack} / {@link dodge}
 * output) for multi-series bars. Drawn as one instances node of rects:
 * hover and tooltips resolve per bar (`event.key` is the bar's key), and
 * `transition` tweens or springs bars to new data. `to` + `blend` is the
 * seekable keyed transition.
 *
 * @example
 * ```ts
 * import { bars, chart } from "@sophistry/charts";
 *
 * const sales = [
 * 	{ quarter: "Q1", region: "north", units: 3 },
 * 	{ quarter: "Q1", region: "south", units: 5 },
 * 	{ quarter: "Q2", region: "north", units: 4 },
 * 	{ quarter: "Q2", region: "south", units: 2 },
 * ];
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	legendTitle: "Region",
 * 	children: [bars.create({ data: sales, category: "quarter", value: "units", series: "region", layout: "stack" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#bars
 * @category Charts
 */
export const bars = defineComposite<BarsProps<AnyDatum>>({
	name: "Bars",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		category: { invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		orientation: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		layout: { invalidates: Invalidate.UPDATE },
		offset: { invalidates: Invalidate.UPDATE },
		order: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		base: { invalidates: Invalidate.UPDATE },
		subband: { invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		staggerOrder: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const state: BarsState = {
			layer,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			from: keyedMemo<BarSide<unknown>>(),
			to: keyedMemo<BarSide<unknown>>(),
			rects: createBatchedMark<
				BarItem,
				RectProps,
				SceneNode<RectProps>,
				keyof RectProps
			>(rect as never, {
				channels: {
					center: (item) => ({
						x: (item.box.minX + item.box.maxX) / 2,
						y: (item.box.minY + item.box.maxY) / 2,
					}),
					width: (item) => item.box.maxX - item.box.minX,
					height: (item) => item.box.maxY - item.box.minY,
					fill: (item) => item.fill,
					stroke: (item) => item.fill,
					opacity: (item) => item.opacity,
				},
				// Under a `transition`, a bar fades in and out in place (its
				// foot is not an item channel the bank could grow from).
				enter: { opacity: 0 },
				exit: { opacity: 0 },
			}),
			handle: {
				count: () => ctx.props.data.length,
				barBounds: (index) => state.boxFor(index),
			},
			boxFor: () => null,
		};
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
