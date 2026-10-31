/**
 * `radialBarChart`: concentric ring bars, one per datum, the first outermost.
 *
 * Two path batches: the faint full-length tracks (one shared paint, faded in
 * together) and the value arcs (each its own fill; hover, taps, tooltips
 * and accessible names per ring through `event.item` and `itemLabel`). Ring
 * names stay `label` nodes.
 */

import type {
	ColorInput,
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, pathBatch } from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import {
	clamp01,
	clampNonNegative,
	cssColor,
	maxOf,
	polarPoint,
} from "@sophistry/core/internal";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, ColorChannel, RequiredUnless } from "../data/channels";
import {
	colorResolver,
	dateSinkContext,
	identity,
	numberValues,
	resolveChannel,
} from "../data/channels";
import { itemTooltipHandlers } from "../item-tooltip";
import type { AnyDatum } from "../props";
import { createSeries } from "../series";
import { staggered } from "../stagger";
import type { TooltipSpec } from "../tooltip";
import { tooltipText } from "../tooltip";
import type { KeyedLabel } from "./shared";
import {
	createItemCache,
	createOwnTooltip,
	labelList,
	NO_SWEEP,
	wedgeItem,
} from "./shared";

/** Share of `progress` spent fading in the tracks and labels before the bars. */
const FRAME_SHARE = 0.2;
const DEFAULT_STAGGER = 0.3;
const DEFAULT_INNER_FRACTION = 0.3;
/** Default gap between rings, as a fraction of a ring's width. */
const GAP_FRACTION = 0.25;
const TRACK_OPACITY = 0.6;
const LABEL_PAD = 0.08;
/** 12 o'clock on a y-up stage. */
const TOP = Math.PI / 2;

/** @category Charts */
export interface RadialBarChartBaseProps<T> {
	/** One ring per datum, the first outermost. */
	data: readonly T[];
	/**
	 * The ring's value. Defaults to the datum when `data` is `number[]`; required otherwise.
	 * Negative and non-finite values count as 0 (an empty ring).
	 */
	value?: Channel<T, number>;
	/** The ring's name, written at its start. */
	label?: Channel<T, string>;
	/**
	 * The value that fills a ring's whole `sweep`; larger values are drawn full. Defaults to the
	 * greatest value.
	 */
	maxValue?: number;
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * Outer radius of the outermost ring.
	 * @default 1
	 */
	radius?: number;
	/** Inner radius of the innermost ring. Defaults to 0.3 × `radius`. */
	innerRadius?: number;
	/** Gap between rings. Defaults to a quarter of a ring's width. */
	ringGap?: number;
	/**
	 * Radians a ring of `maxValue` turns through, clockwise from 12 o'clock. The default, 270°,
	 * leaves the top-left quadrant for labels.
	 * @default 3 * Math.PI / 2
	 */
	sweep?: number;
	/**
	 * The category of each ring: colours rings through the chart's shared colour scale and legend.
	 * `color` and `colors` win.
	 */
	series?: Channel<T, BandKey>;
	/** One colour for every ring, or `(d, i) => colour`. Wins over `colors` and `series`. */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the rings by index. Wins over `series`. Defaults to the `series`
	 * colours, else the theme's categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Colour of the faint full-length track behind each ring. Defaults to the theme's grid colour.
	 */
	trackColor?: ColorInput;
	/**
	 * Write each ring's `label` at its start.
	 * @default true
	 */
	labels?: boolean;
	/** Label font size. Defaults to 0.7 × a ring's width, at most 0.26. */
	labelFontSize?: number;
	/**
	 * Reveal, 0..1: tracks and labels fade in, then each ring sweeps clockwise, outermost first.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the bars' reveal spent staggering ring after ring, outer to inner, 0..0.95.
	 * @default 0.3
	 */
	stagger?: number;
	/** Hover tooltip: `true` for "label: value", or `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	/** Paint order; higher draws later. */
	zIndex?: number;
	visible?: boolean;
}

/**
 * Props of {@link radialBarChart}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export type RadialBarChartProps<T> = RadialBarChartBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** One ring's resolved geometry. */
interface Ring {
	index: number;
	value: number;
	inner: number;
	outer: number;
	/** `value / maxValue`, clamped to 0..1. */
	fraction: number;
}

/** What a radial bar chart keeps between updates. */
interface RadialBarState {
	layer: ChartLayer;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	tooltip: ReturnType<typeof createOwnTooltip>;
	tracks: PathBatchNode<PathBatchItemsProps>;
	bars: PathBatchNode<PathBatchItemsProps>;
	trackItems: ReturnType<typeof createItemCache<PathBatchItem | undefined>>;
	barItems: ReturnType<typeof createItemCache<PathBatchItem | undefined>>;
	values: (data: readonly unknown[], value: unknown) => number[];
	labels: (
		data: readonly unknown[],
		label: unknown,
	) => readonly string[] | undefined;
	rings: (
		values: readonly number[],
		radius: number,
		innerRadius: number | undefined,
		ringGap: number | undefined,
		maxValue: number | undefined,
	) => Ring[];
	/** The ring and arc end of each drawn bar, by item index. */
	drawn: { ring: Ring; tip: Point }[];
}

const states = new WeakMap<object, RadialBarState>();

/** Each ring's radii and fraction of the sweep. */
function ringsOf(
	values: readonly number[],
	radius: number,
	innerRadius: number | undefined,
	ringGap: number | undefined,
	maxValue: number | undefined,
): Ring[] {
	const n = values.length;
	if (n === 0) return [];
	const outer = radius;
	const inner = Math.min(
		outer,
		Math.max(0, innerRadius ?? outer * DEFAULT_INNER_FRACTION),
	);
	const span = outer - inner;
	const gap = ringGap ?? (span / (n + GAP_FRACTION * (n - 1))) * GAP_FRACTION;
	const width = Math.max(0, (span - gap * (n - 1)) / n);
	const max = maxValue ?? maxOf(values, 0);
	return values.map((value, index) => {
		const ringOuter = outer - index * (width + gap);
		return {
			index,
			value,
			outer: ringOuter,
			inner: ringOuter - width,
			fraction: max > 0 ? Math.min(1, value / max) : 0,
		};
	});
}

function draw(
	ctx: CompositeContext<RadialBarChartProps<AnyDatum>>,
): SceneNode[] {
	const state = states.get(ctx.node) as RadialBarState;
	const props = ctx.props;
	const theme = ctx.theme;
	const { layer } = state;
	const dates = ctx.context(dateSinkContext);
	const tooltip = state.tooltip(ctx);

	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined || props.colors !== undefined,
		mark: { fill: true },
		dates,
	});
	// No axes to fit: the report is the series, for a frame's legend.
	layer.report({ color: series.extent });

	const progress = clamp01(layer.progress(props.progress) ?? 1);
	if (props.visible === false || !(progress > 0)) {
		// Hidden: the batches stay (removed children are disposed), empty.
		state.drawn = [];
		state.tracks.update({ visible: false });
		state.bars.update({ visible: false });
		labelList(ctx, "labels", []);
		return [state.tracks, state.bars];
	}

	const values = state.values(props.data, props.value);
	const labels = state.labels(props.data, props.label);
	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const sweep = props.sweep ?? (3 * Math.PI) / 2;
	const rings = state.rings(
		values,
		props.radius ?? 1,
		props.innerRadius,
		props.ringGap,
		props.maxValue,
	);
	const first = rings[0];
	const ringWidth = first ? first.outer - first.inner : 0;

	const frameT = clamp01(progress / FRAME_SHARE);
	const dataT = clamp01((progress - FRAME_SHARE) / (1 - FRAME_SHARE));
	const read = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const colorFor = (index: number) =>
		series.colorOf(series.of?.[index]) ?? read(props.data[index], index);

	const tracks: PathBatchItem[] = [];
	const bars: PathBatchItem[] = [];
	const drawn: { ring: Ring; tip: Point }[] = [];
	const names: KeyedLabel[] = [];
	const fontSize = props.labelFontSize ?? Math.min(0.26, ringWidth * 0.7);
	for (const ring of rings) {
		const track = state.trackItems.get(
			ring.index,
			[cx, cy, ring.inner, ring.outer, sweep],
			() =>
				wedgeItem(
					{
						cx,
						cy,
						innerRadius: ring.inner,
						outerRadius: ring.outer,
						startAngle: TOP,
						angle: -sweep,
					},
					{},
					true,
				),
		);
		if (track) tracks.push(track);
		// This ring's own reveal: outer rings first.
		const t = staggered(
			dataT,
			ring.index,
			rings.length,
			props.stagger ?? DEFAULT_STAGGER,
		);
		const angle = -sweep * ring.fraction * t;
		if (Math.abs(angle) > NO_SWEEP) {
			const fill = colorFor(ring.index);
			const bar = state.barItems.get(
				ring.index,
				[cx, cy, ring.inner, ring.outer, angle, fill],
				() =>
					wedgeItem(
						{
							cx,
							cy,
							innerRadius: ring.inner,
							outerRadius: ring.outer,
							startAngle: TOP,
							angle,
						},
						{ fill },
						true,
					),
			);
			if (bar) {
				bars.push(bar);
				drawn.push({
					ring,
					// Same doubles as `cx + cos·r`: IEEE multiplication commutes.
					tip: polarPoint(cx, cy, ring.outer, TOP + angle),
				});
			}
		}
		const text = props.labels !== false ? labels?.[ring.index] : undefined;
		if (text)
			names.push({
				key: ring.index,
				props: {
					text,
					x: cx - LABEL_PAD,
					y: cy + (ring.inner + ring.outer) / 2,
					align: "right",
					fontSize,
					color: theme.palette.foreground,
					opacity: frameT,
					zIndex: (props.zIndex ?? 0) + 2,
				},
			});
	}
	state.trackItems.sweep();
	state.barItems.sweep();
	state.drawn = drawn;

	state.tracks.update({
		items: tracks,
		fill: cssColor(props.trackColor ?? theme.palette.grid),
		fillOpacity: TRACK_OPACITY,
		stroke: "none",
		opacity: frameT,
		zIndex: props.zIndex ?? 0,
		visible: true,
	} as Partial<PathBatchItemsProps>);

	const tipped = props.tooltip !== undefined || !!tooltip.config();
	const handlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const own = state.drawn[item];
			if (!own) return undefined;
			const { ring } = own;
			return tooltipText(
				props.tooltip,
				() => {
					const name = labels?.[ring.index];
					const value = formatTick(ring.value);
					return name ? `${name}: ${value}` : value;
				},
				props.data[ring.index],
				ring.index,
				tooltip,
			);
		},
		(item) => state.drawn[item]?.tip,
		() => "RadialBarChart",
	);
	state.bars.update({
		items: bars,
		stroke: "none",
		zIndex: (props.zIndex ?? 0) + 1,
		visible: true,
		label: tipped ? handlers.label : undefined,
		onEnter: tipped ? handlers.onEnter : undefined,
		onLeave: tipped ? handlers.onLeave : undefined,
		onTap: tipped ? handlers.onTap : undefined,
		itemLabel: tipped ? handlers.itemLabel : undefined,
	} as Partial<PathBatchItemsProps>);
	return [state.tracks, state.bars, ...labelList(ctx, "labels", names)];
}

/**
 * Concentric ring bars: a bar chart bent round a centre, one ring per datum (the first
 * outermost), each arc its value over `maxValue`. Outer rings are longer at the same value, so
 * compare angles, not lengths. Draws in scene units; needs no `chart`.
 *
 * @example
 * ```ts
 * import { radialBarChart } from "@sophistry/charts";
 *
 * radialBarChart.create({
 * 	data: [
 * 		{ goal: "Move", pct: 80 },
 * 		{ goal: "Stand", pct: 50 },
 * 	],
 * 	value: "pct",
 * 	label: "goal",
 * 	maxValue: 100,
 * 	tooltip: true,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#gauges-bullets-waffles-mosaics-and-radial-bars
 * @category Charts
 */
export const radialBarChart = defineComposite<RadialBarChartProps<AnyDatum>>({
	name: "RadialBarChart",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		maxValue: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		innerRadius: { invalidates: Invalidate.UPDATE },
		ringGap: { invalidates: Invalidate.UPDATE },
		sweep: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		trackColor: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		states.set(ctx.node, {
			layer,
			series: createSeries<AnyDatum>(layer),
			tooltip: createOwnTooltip(),
			tracks: pathBatch.create({ items: [] }),
			bars: pathBatch.create({ items: [] }),
			trackItems: createItemCache<PathBatchItem | undefined>(),
			barItems: createItemCache<PathBatchItem | undefined>(),
			values: ctx.memo((data: readonly unknown[], value: unknown) =>
				numberValues(
					data,
					value as Channel<unknown, number> | undefined,
					identity,
					"value",
				).map(clampNonNegative),
			),
			labels: ctx.memo((data: readonly unknown[], channel: unknown) => {
				const read = resolveChannel(
					channel as Channel<unknown, string> | undefined,
					undefined,
					"label",
				);
				return read ? data.map((d, i) => read(d, i)) : undefined;
			}),
			rings: ctx.memo(ringsOf),
			drawn: [],
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
