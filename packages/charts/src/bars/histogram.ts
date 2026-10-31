/**
 * `histogram`: values bucketed into equal-width bins, one touching bar per
 * bin, drawn as one instances node of `rect`s keyed by the bin's place.
 *
 * The reveal and a transition's presence grow each bar's top from the
 * baseline (geometry) or, on an axis without zero, fade it (per-item
 * opacity); a bin not started is left out of the batch (it counts as
 * `progress` 0).
 */

import type { CompositeContext, RectProps, SceneNode } from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	rect,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Bounds, Range } from "@sophistry/core/geometry";
import { cssColor } from "@sophistry/core/internal";
import { growsFromZero } from "../band";
import type { BatchItem, MarkTransition } from "../batch";
import { createBatchedMark } from "../batch";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel } from "../data/channels";
import { dateSinkContext, identity, numberValues } from "../data/channels";
import { endSpace } from "../end-space";
import type { JoinFrame } from "../join";
import { createJoin, joinFrame, layerTransition } from "../join";
import type { HistogramBins } from "../math/histogram";
import { histogramBins } from "../math/histogram";
import { mixPoints } from "../mix";
import type { AnyDatum, RevealProps, TransitionProps } from "../props";
import { staggered } from "../stagger";
import { keyedMemo, mix } from "../util";

const DEFAULT_FILL_OPACITY = 0.85;

/**
 * Props of {@link histogram}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface HistogramProps<T = unknown>
	extends TransitionProps<T>,
		RevealProps {
	/** One observation per datum. */
	data: readonly T[];
	/**
	 * The observed value, in data units. Defaults to the datum when `data` is `number[]`; required
	 * otherwise. Non-finite values and values outside `range` are not counted.
	 */
	value?: Channel<T, number>;
	/**
	 * Number of equal-width bins. Wins over a `range` step. Defaults to the count the `range` step
	 * implies, else 10.
	 */
	binCount?: number;
	/**
	 * `[min, max, step?]` spanned by the bins, in data units; `step` is the bin width when
	 * `binCount` is not given (`[0, 10, 2]` is five bins). Defaults to the finite extent of the
	 * values.
	 */
	range?: Range;
	/** Fill of every bar. Defaults to the theme's first series colour. */
	color?: ColorInput;
	/**
	 * Fill opacity, 0..1.
	 * @default 0.85
	 */
	fillOpacity?: number;
	/** Outline colour. @default "none" */
	stroke?: string;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/**
	 * Reveal, 0..1: bars grow from the baseline (fading in when the axis has no zero).
	 * @default 1
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering bin after bin, left to right, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/**
	 * The data to transition to, bins matched by place: shared bins move their edges and counts, so
	 * every frame is a histogram; extra bins grow in or shrink away. See {@link TransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/**
	 * `to`'s bin count; `to={data}` with a new `toBinCount` re-bins as a transition. Defaults to
	 * `binCount`.
	 */
	toBinCount?: number;
	/** `to`'s binning range, as `range`. Defaults to `range`. */
	toRange?: Range;
	/**
	 * Fraction of a transition's enter stage spent staggering entering bins, left to right. See
	 * {@link TransitionProps}.
	 * @default 0
	 */
	enterStagger?: number;
	/**
	 * How bars move when `data` changes (outside a `to` blend): a tween or a
	 * spring in the node's tween bank. Omitted, data changes are instant.
	 */
	transition?: MarkTransition;
	/** Paint order; the bars paint at `zIndex + UNDER_AXES_Z_INDEX`. */
	zIndex?: number;
	visible?: boolean;
}

/** A bin in data units: its edges and its count. */
interface BinState {
	left: number;
	right: number;
	count: number;
}

/** Two bins blended at `u`: edges and count, linearly. */
function blendBin(a: BinState, b: BinState, u: number): BinState {
	return {
		left: mix(a.left, b.left, u),
		right: mix(a.right, b.right, u),
		count: mix(a.count, b.count, u),
	};
}

/** What one bin draws on a frame. */
interface BinItem extends BatchItem {
	box: Bounds;
	opacity: number;
}

/** What a histogram keeps between updates. */
interface HistogramState {
	layer: ChartLayer;
	join: ReturnType<typeof createJoin>;
	bins: (deps: readonly unknown[], make: () => HistogramBins) => HistogramBins;
	toBins: (
		deps: readonly unknown[],
		make: () => HistogramBins,
	) => HistogramBins;
	rects: ReturnType<
		typeof createBatchedMark<
			BinItem,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
}

const states = new WeakMap<object, HistogramState>();

function draw(ctx: CompositeContext<HistogramProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as HistogramState;
	const props = ctx.props as Readonly<HistogramProps<unknown>>;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("Histogram must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;

	const binsOf = (
		data: readonly unknown[],
		binCount: number | undefined,
		range: Range | undefined,
	) =>
		histogramBins(numberValues(data, props.value, identity, "value", dates), {
			binCount,
			range,
		});
	const bins = state.bins(
		[props.data, props.value, props.binCount, props.range, dates],
		() => binsOf(props.data, props.binCount, props.range),
	);
	const binCount = props.toBinCount ?? props.binCount;
	const binRange = props.toRange ?? props.range;
	const toBins =
		props.to === undefined
			? undefined
			: state.toBins([props.to, props.value, binCount, binRange, dates], () =>
					binsOf(props.to as readonly unknown[], binCount, binRange),
				);
	/** Each bin's identity: its place, at each end. */
	const join = state.join({
		fromKeys: bins.counts.map((_, i) => i),
		toKeys: toBins?.counts.map((_, i) => i),
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
	});
	const extent = {
		x: { values: bins.edges },
		y: { values: bins.counts, zero: true },
	};
	layer.report(
		toBins
			? {
					...extent,
					transition: layerTransition(join, props.staging, {
						x: { values: toBins.edges },
						y: { values: toBins.counts, zero: true },
					}),
				}
			: extent,
	);

	/** Where each end draws while an axis changes kind across the transition. */
	const space = endSpace(frame, coords);
	const baseline = coords.crossing().y;
	const color = cssColor(props.color ?? theme.palette.series[0] ?? "");
	const grows = growsFromZero(coords.yRange());
	const at = (side: HistogramBins | undefined, index: number) =>
		side && index >= 0 && index < side.counts.length
			? {
					index,
					state: {
						left: side.edges[index] as number,
						right: side.edges[index + 1] as number,
						count: side.counts[index] as number,
					},
				}
			: undefined;
	const progress = layer.progress(props.progress) ?? 1;
	const items: BinItem[] = [];
	for (const key of join.keys) {
		const index = Number(key);
		const own: JoinFrame<BinState> | undefined = joinFrame(
			join,
			at(bins, index),
			at(toBins, index),
			blendBin,
			key as BandKey,
			space.swapping,
		);
		if (!own || own.presence <= 0) continue;
		/** The reveal and the join's presence together: an exit is the reveal run back. */
		const t =
			staggered(progress, index, join.keys.length, props.stagger ?? 0) *
			own.presence;
		if (!(t > 0)) continue;
		// Mid-swap, each end's bin through its own plot (on its own baseline), blended.
		const corners = space.shape(
			own,
			(bin, _end, system) =>
				[
					system.coordsToPoint(
						bin.left,
						system === coords ? baseline : system.crossing().y,
					),
					system.coordsToPoint(bin.right, bin.count),
				] as const,
			mixPoints,
		);
		if (!corners) continue;
		const [left, right] = corners;
		// Growing, not wiping: the bar's top runs up from the baseline.
		const top = grows ? left.y + (right.y - left.y) * t : right.y;
		items.push({
			key: key as BandKey,
			box: {
				minX: Math.min(left.x, right.x),
				maxX: Math.max(left.x, right.x),
				minY: Math.min(left.y, top),
				maxY: Math.max(left.y, top),
			},
			opacity: (props.opacity ?? 1) * (grows ? 1 : t),
		});
	}
	state.rects.update(
		items,
		{
			fill: color,
			fillOpacity: props.fillOpacity ?? DEFAULT_FILL_OPACITY,
			stroke: props.stroke ?? "none",
			strokeWidth: props.strokeWidth,
			zIndex: (props.zIndex ?? 0) + UNDER_AXES_Z_INDEX,
			visible: props.visible,
		} as never,
		{
			transition: props.transition,
			animate: !join.active && progress >= 1,
		},
	);
	return [state.rects.node];
}

/**
 * A histogram: values bucketed into equal-width bins, one touching bar per
 * bin, its height the count. `progress` grows bars from the baseline
 * (fading in when the axis has no zero). Inside a `chart` (which fits the
 * counts) or an `axes`. See {@link histogramBins} for the binning rule (the
 * last bin is right-inclusive). Drawn as one instances node of rects.
 *
 * @example
 * ```ts
 * import { chart, histogram } from "@sophistry/charts";
 *
 * const heights = [162, 170, 175, 168, 181, 159, 177, 173, 166, 185, 171, 169];
 * chart.create({ width: 8, height: 4, children: [histogram.create({ data: heights, binCount: 12 })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#histograms
 * @category Charts
 */
export const histogram = defineComposite<HistogramProps<AnyDatum>>({
	name: "Histogram",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		binCount: { invalidates: Invalidate.UPDATE },
		range: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		toBinCount: { invalidates: Invalidate.UPDATE },
		toRange: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			join: createJoin(),
			bins: keyedMemo<HistogramBins>(),
			toBins: keyedMemo<HistogramBins>(),
			rects: createBatchedMark<
				BinItem,
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
					opacity: (item) => item.opacity,
				},
				enter: { opacity: 0 },
				exit: { opacity: 0 },
			}),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
