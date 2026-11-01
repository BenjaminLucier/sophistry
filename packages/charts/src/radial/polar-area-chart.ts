/**
 * `polarAreaChart`: a rose of equal-angle wedges whose radius carries the
 * value.
 *
 * The wedges draw as one path batch (each item the native outline of a
 * `sector`, with its own fill); per-wedge picking and accessible names
 * go through its items. Wedge labels stay `label` nodes. Inside a chart the
 * layer reports its series (for the legend) and its transition (for the
 * staging); it fits no axes.
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
import {
	clamp01,
	clampNonNegative,
	cssColor,
	maxOf,
} from "@sophistry/core/internal";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type {
	Channel,
	ColorChannel,
	RequiredUnless,
} from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	identity,
	numberValues,
	resolveChannel,
} from "../data/channels.js";
import type { JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrame,
	layerTransition,
	transitionColor,
} from "../join.js";
import { ringLayout } from "../math/pie.js";
import { polarAreaSlices } from "../math/polarArea.js";
import { blendCss } from "../mix.js";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props.js";
import type { Category } from "../series.js";
import { createSeries } from "../series.js";
import { staggered } from "../stagger.js";
import { mix } from "../util.js";
import { ringOrders } from "./pie-chart.js";
import type { KeyedLabel } from "./shared.js";
import {
	createFarScale,
	createItemCache,
	labelList,
	wedgeItem,
} from "./shared.js";

const DEFAULT_STROKE_WIDTH = 0.02;
/** Fraction of a wedge's own radius its percentage/label sits at, from the centre. */
const LABEL_RADIUS_FRACTION = 0.65;

/** @category Charts */
export interface PolarAreaChartBaseProps<T>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One wedge per datum. */
	data: readonly T[];
	/**
	 * The wedge's value, in data units. Defaults to the datum when `data` is `number[]`; required
	 * otherwise. Negative and non-finite values count as 0 (an empty wedge).
	 */
	value?: Channel<T, number>;
	/**
	 * The wedge's visible label. Omitted, a rounded percentage. See `ariaLabel` for the accessible
	 * name.
	 */
	label?: Channel<T, string>;
	/**
	 * The chart's accessible name; each wedge is announced as `"<ariaLabel>: <wedge label>"`.
	 * Omitted, wedges are not exposed to assistive technology.
	 */
	ariaLabel?: string;
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * Radius a value of `maxValue` reaches.
	 * @default 1
	 */
	radius?: number;
	/**
	 * The value that reaches `radius`. Pin it to keep the scale fixed as `data` changes. Defaults
	 * to the greatest value in `data`.
	 */
	maxValue?: number;
	/**
	 * Angle the first wedge begins at, in radians from +x. The default is 12 o'clock.
	 * @default Math.PI / 2
	 */
	startAngle?: number;
	/**
	 * Whether wedges run clockwise.
	 * @default true
	 */
	clockwise?: boolean;
	/**
	 * Reveal, 0..1: one sweep round the chart from `startAngle`, uncovering wedges in data order.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering wedge after wedge, 0..0.95; 0 opens every wedge
	 * together. Defaults to one continuous sweep, `(n − 1) / n`.
	 */
	stagger?: number;
	/**
	 * The category of each wedge: colours wedges through the chart's shared colour scale and
	 * legend. `color` and `colors` win.
	 */
	series?: Channel<T, BandKey>;
	/** One colour for every wedge, or `(d, i) => colour`. Wins over `colors` and `series`. */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the wedges by index. Wins over `series`. Defaults to the `series`
	 * colours, else the theme's categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Whether to draw wedge labels.
	 * @default true
	 */
	labels?: boolean;
	/** Label font size. */
	labelFontSize?: number;
	/** Label colour. Defaults to the theme background. */
	labelColor?: ColorInput;
	/**
	 * Each wedge's identity across transitions. See {@link KeyedTransitionProps}. Defaults to
	 * `label`, else the place within its `series`, else the index.
	 */
	key?: Channel<T, BandKey>;
	/**
	 * The data to transition to, matched to `data` by `key`: wedges reach out or draw in to their
	 * new value; leaving wedges narrow away and new ones open up as the rest make room. See {@link
	 * KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** Wedge outline. Defaults to the theme background. */
	stroke?: ColorInput;
	/**
	 * Outline width.
	 * @default 0.02
	 */
	strokeWidth?: number;
	/** Fill opacity of the wedges, 0..1. */
	fillOpacity?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the chart. */
	visible?: boolean;
}

/**
 * Props of {@link polarAreaChart}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export type PolarAreaChartProps<T> = PolarAreaChartBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** A wedge in data units: its value and its colour. */
interface WedgeState {
	value: number;
	color: string;
}

/** A wedge's geometry before the reveal, and its place in the sweep (`shown = progress · sweepScale − sweepOffset`). */
interface WedgePlace {
	startAngle: number;
	endAngle: number;
	/** 0..1 of `radius`. */
	radius: number;
	/** Its share of the values, for the default label. */
	fraction: number;
	sweepScale: number;
	sweepOffset: number;
}

/** Two wedges blended at `u`: the value in data units, the colour in OKLCH. */
function blendWedge(a: WedgeState, b: WedgeState, u: number): WedgeState {
	return {
		value: mix(a.value, b.value, u),
		color: blendCss(a.color, b.color, u),
	};
}

/** What a polar area chart keeps between updates. */
interface PolarAreaState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	farScale: ReturnType<typeof createFarScale>;
	wedges: PathBatchNode<PathBatchItemsProps>;
	items: ReturnType<typeof createItemCache<PathBatchItem | undefined>>;
	values: (data: readonly unknown[], value: unknown) => number[];
	labels: (
		data: readonly unknown[],
		label: unknown,
	) => readonly string[] | undefined;
	orders: typeof ringOrders;
	sweepRanks: (
		stagger: number | undefined,
		fromSlots: ReadonlyMap<BandKey, number>,
		toSlots: ReadonlyMap<BandKey, number> | undefined,
		values: readonly number[],
		toValues: readonly number[] | undefined,
	) =>
		| {
				from: Map<BandKey, number> | undefined;
				to: Map<BandKey, number> | undefined;
		  }
		| undefined;
	names: (string | undefined)[];
	itemLabel: (item: number) => string | undefined;
}

const states = new WeakMap<object, PolarAreaState>();

/** With `stagger`: each end's wedges in sweep order (empty wedges left out). */
function sweepRanksOf(
	stagger: number | undefined,
	fromSlots: ReadonlyMap<BandKey, number>,
	toSlots: ReadonlyMap<BandKey, number> | undefined,
	values: readonly number[],
	toValues: readonly number[] | undefined,
) {
	if (stagger === undefined) return undefined;
	const rank = (
		slots: ReadonlyMap<BandKey, number> | undefined,
		numbers: readonly number[] | undefined,
	) => {
		if (!slots || !numbers) return undefined;
		const out = new Map<BandKey, number>();
		for (const [key, index] of [...slots].sort((a, b) => a[1] - b[1]))
			if (clampNonNegative(numbers[index] as number) > 0)
				out.set(key, out.size);
		return out;
	};
	return { from: rank(fromSlots, values), to: rank(toSlots, toValues) };
}

function draw(
	ctx: CompositeContext<PolarAreaChartProps<AnyDatum>>,
): SceneNode[] {
	const state = states.get(ctx.node) as PolarAreaState;
	const props = ctx.props;
	const theme = ctx.theme;
	const { layer } = state;
	const frame = layer.frame();
	const dates = ctx.context(dateSinkContext);

	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined || props.colors !== undefined,
		mark: { fill: true },
		dates,
	});
	// Wedges by `key`, else by `label`, else by place in series, else by index.
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: (props.key ?? props.label) as Channel<unknown, BandKey> | undefined,
		series: props.series,
		of: series.of,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		dates,
	});
	// No axes to fit: the report is the series, for a frame's legend (both
	// ends' while a transition runs), and the transition, for its staging.
	layer.report({
		color: transitionColor(series.extent, keyed.toOf),
		transition: layerTransition(keyed, props.staging, {}),
	});

	const values = state.values(props.data, props.value);
	const labels = state.labels(props.data, props.label);
	const toValues = props.to ? state.values(props.to, props.value) : undefined;
	const toLabels = props.to ? state.labels(props.to, props.label) : undefined;

	const sweepOptions = {
		startAngle: props.startAngle,
		clockwise: props.clockwise,
	};
	// The value that reaches `radius`: given, else each end's greatest,
	// blended with the update.
	let maxValue = props.maxValue;
	if (maxValue === undefined) {
		const own = maxOf(values.map(clampNonNegative), 0);
		maxValue =
			toValues === undefined
				? own
				: mix(own, maxOf(toValues.map(clampNonNegative), 0), keyed.update);
	}

	const read = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	// `to`'s series colours: the frame's shared scale, or outside one `to`'s
	// own (as its plain chart has).
	const toScale = state.farScale(
		frame !== null,
		keyed.toOf,
		series.scale,
		theme,
	);
	const at = (
		data: readonly unknown[],
		numbers: readonly number[],
		index: number,
		colorOf: (category: Category) => string | undefined,
		of: readonly Category[] | undefined,
	) =>
		index < 0
			? undefined
			: {
					index,
					state: {
						value: clampNonNegative(numbers[index] as number),
						color: colorOf(of?.[index]) ?? read(data[index], index),
					},
				};
	const farColor = (category: Category) =>
		series.scaled ? toScale(category) : undefined;
	// Each key's wedge on this frame, in data units: its value and colour,
	// blended, entering or leaving.
	const frames = new Map<BandKey, JoinFrame<WedgeState>>();
	for (const key of keyed.keys) {
		const next = joinFrame(
			keyed,
			at(props.data, values, keyed.fromIndex(key), series.colorOf, series.of),
			props.to && toValues
				? at(props.to, toValues, keyed.toIndex(key), farColor, keyed.toOf)
				: undefined,
			blendWedge,
			key,
		);
		if (next) frames.set(key, next);
	}

	// Each key's wedge geometry before the reveal: `polarAreaSlices`' own, or
	// mid-transition each wedge's angular share is its presence, laid round
	// in ring order.
	const layout = new Map<BandKey, WedgePlace>();
	if (!keyed.active) {
		const slices = polarAreaSlices(values, {
			...sweepOptions,
			maxValue: props.maxValue,
		});
		const n = slices.length;
		for (const slice of slices)
			layout.set(keyed.keys[slice.index] as BandKey, {
				startAngle: slice.startAngle,
				endAngle: slice.endAngle,
				radius: slice.radius,
				fraction: slice.fraction,
				sweepScale: n,
				sweepOffset: slice.index,
			});
	} else {
		// The sum of the values as they stand, for the percentages.
		let sum = 0;
		for (const own of frames.values()) sum += own.state.value * own.presence;
		const ring = ringLayout(
			state.orders(keyed.join, keyed.keys),
			(key) => frames.get(key)?.presence ?? 0,
			keyed.update,
			sweepOptions,
		);
		for (const [key, slice] of ring) {
			const own = frames.get(key);
			if (!own || slice.fraction <= 0) continue;
			layout.set(key, {
				startAngle: slice.startAngle,
				endAngle: slice.endAngle,
				radius: maxValue > 0 ? own.state.value / maxValue : 0,
				fraction: sum > 0 ? own.state.value / sum : 0,
				sweepScale: 1 / slice.fraction,
				sweepOffset: slice.offset / slice.fraction,
			});
		}
	}

	const progress = clamp01(layer.progress(props.progress) ?? 1);
	const ranks = state.sweepRanks(
		props.stagger,
		keyed.fromSlots,
		keyed.toSlots,
		values,
		toValues,
	);

	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const radius = props.radius ?? 1;
	const labelColor = props.labelColor ?? theme.palette.background;

	const items: PathBatchItem[] = [];
	const names: (string | undefined)[] = [];
	const texts: KeyedLabel[] = [];
	for (const key of keyed.keys) {
		const own = frames.get(key);
		const place = layout.get(key);
		if (!own || !place) continue;
		let shown: number;
		if (!ranks) {
			shown = clamp01(progress * place.sweepScale - place.sweepOffset);
		} else {
			const table = own.end === "from" ? ranks.from : ranks.to;
			const rank = table?.get(key);
			shown =
				rank === undefined || !table
					? progress
					: staggered(progress, rank, table.size, props.stagger ?? 0);
		}
		const present =
			place.radius > 0 && place.endAngle !== place.startAngle && shown > 0;
		if (!present) continue;
		const wedgeRadius = place.radius * radius;
		const angle = (place.endAngle - place.startAngle) * shown;
		// Its text: the label of the datum it reads from, else its share as it stands.
		const text =
			(own.end === "from" ? labels : toLabels)?.[own.index] ??
			`${Math.round(place.fraction * 100)}%`;
		const item = state.items.get(
			key,
			[cx, cy, wedgeRadius, place.startAngle, angle, own.state.color],
			() =>
				wedgeItem(
					{
						cx,
						cy,
						innerRadius: 0,
						outerRadius: wedgeRadius,
						startAngle: place.startAngle,
						angle,
					},
					{ fill: own.state.color },
				),
		);
		if (item) {
			items.push(item);
			names.push(
				props.ariaLabel === undefined
					? undefined
					: `${props.ariaLabel}: ${text}`,
			);
		}
		if (props.labels === false) continue;
		// Fades with its wedge's reveal and with its presence in the transition.
		const mid = (place.startAngle + place.endAngle) / 2;
		const labelRadius = wedgeRadius * LABEL_RADIUS_FRACTION;
		texts.push({
			key,
			props: {
				text,
				x: cx + Math.cos(mid) * labelRadius,
				y: cy + Math.sin(mid) * labelRadius,
				fontSize: props.labelFontSize,
				color: labelColor,
				zIndex: props.zIndex,
				visible: props.visible,
				opacity: shown * own.presence,
			},
		});
	}
	state.items.sweep();
	state.names = names;

	const named = props.ariaLabel !== undefined;
	state.wedges.update({
		items,
		stroke: cssColor(props.stroke ?? theme.palette.background),
		strokeWidth: props.strokeWidth ?? DEFAULT_STROKE_WIDTH,
		fillOpacity: props.fillOpacity ?? 1,
		zIndex: props.zIndex ?? 0,
		visible: props.visible ?? true,
		label: named ? props.ariaLabel : undefined,
		role: named ? "img" : undefined,
		itemLabel: named ? state.itemLabel : undefined,
	} as Partial<PathBatchItemsProps>);
	return [state.wedges, ...labelList(ctx, "labels", texts)];
}

/**
 * A polar area (rose) chart: wedges of equal angle whose radius carries the value, linear
 * against `maxValue`. Draws in scene units; zero-value wedges are skipped. The wedges are one
 * path batch. See {@link polarAreaSlices} for the wedge math alone.
 *
 * @example
 * ```ts
 * import { polarAreaChart } from "@sophistry/charts";
 *
 * polarAreaChart.create({ data: [4, 2, 3, 1], labels: false, stagger: 0.4 });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#pie-polar-area-and-radar
 * @category Charts
 */
export const polarAreaChart = defineComposite<PolarAreaChartProps<AnyDatum>>({
	name: "PolarAreaChart",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		ariaLabel: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		maxValue: { invalidates: Invalidate.UPDATE },
		startAngle: { invalidates: Invalidate.UPDATE },
		clockwise: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		labelColor: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const state: PolarAreaState = {
			layer,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			farScale: createFarScale(),
			wedges: pathBatch.create({ items: [] }),
			items: createItemCache<PathBatchItem | undefined>(),
			values: ctx.memo((data: readonly unknown[], value: unknown) =>
				numberValues(
					data,
					value as Channel<unknown, number> | undefined,
					identity,
					"value",
				),
			),
			labels: ctx.memo((data: readonly unknown[], channel: unknown) => {
				const read = resolveChannel(
					channel as Channel<unknown, string> | undefined,
					undefined,
					"label",
				);
				return read ? data.map((d, i) => read(d, i)) : undefined;
			}),
			orders: ctx.memo(ringOrders),
			sweepRanks: ctx.memo(sweepRanksOf),
			names: [],
			itemLabel: (item) => state.names[item],
		};
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
