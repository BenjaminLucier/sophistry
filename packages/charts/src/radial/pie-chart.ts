/**
 * `pieChart`: a pie (or doughnut) of one wedge per datum.
 *
 * The wedges draw as one path batch: each item is the native curve outline
 * of a `sector` (or `annularSector`, with a hole), with its own
 * fill; the stroke, its width and the fill opacity are shared. Per-wedge
 * picking and accessible names go through the batch's items (`event.item`,
 * `itemLabel`). Slice labels stay `text` nodes, one per present slice.
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
import { clamp01, clampNonNegative, cssColor } from "@sophistry/core/internal";
import { chartContext } from "../context.js";
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
import { createKeyedData, joinFrame } from "../join.js";
import type { KeyedJoin } from "../math/join.js";
import type { RingSlice } from "../math/pie.js";
import { ringLayout, ringOrder, sweepShare } from "../math/pie.js";
import { resolvePolarSweep } from "../math/shared/polar.js";
import { blendCss } from "../mix.js";
import type { AnyDatum, KeyedTransitionProps, RadialReveal } from "../props.js";
import { mix } from "../util.js";
import type { KeyedLabel } from "./shared.js";
import { createItemCache, labelList, wedgeItem } from "./shared.js";

const DEFAULT_STROKE_WIDTH = 0.02;
/** Fraction of the radius a plain pie's slice label sits at, from the centre. */
const LABEL_RADIUS_FRACTION = 0.65;
/** How far into its slice's reveal a label starts to fade in. */
const LABEL_REVEAL_START = 0.6;

/**
 * How far across a slice's ring (0 at the hole, 1 at the rim) its label sits: out at
 * `LABEL_RADIUS_FRACTION` on a plain pie, centred in a doughnut's ring from a hole of half the
 * radius on, blended in between so an animated `innerRadius` never makes it jump.
 */
function labelRingFraction(innerRadius: number, radius: number): number {
	const hole =
		radius > 0 ? Math.min(1, Math.max(0, (2 * innerRadius) / radius)) : 0;
	return LABEL_RADIUS_FRACTION + (0.5 - LABEL_RADIUS_FRACTION) * hole;
}

/** @category Charts */
export interface PieChartBaseProps<T> extends KeyedTransitionProps<T> {
	/** One slice per datum. */
	data: readonly T[];
	/**
	 * The slice's value, in data units. Defaults to the datum when `data` is `number[]`; required
	 * otherwise. Negative and non-finite values count as 0 (an empty slice).
	 */
	value?: Channel<T, number>;
	/**
	 * The slice's visible label. Omitted, a rounded percentage. See `ariaLabel` for the accessible
	 * name.
	 */
	label?: Channel<T, string>;
	/**
	 * The chart's accessible name; each slice is announced as `"<ariaLabel>: <slice label>"`.
	 * Omitted, slices are not exposed to assistive technology.
	 */
	ariaLabel?: string;
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * Outer radius.
	 * @default 1
	 */
	radius?: number;
	/**
	 * Radius of a hole through the centre, making a doughnut chart. `0` draws a plain pie.
	 * @default 0
	 */
	innerRadius?: number;
	/**
	 * Reveal, 0..1: `reveal="grow"` opens every slice at once, keeping their true ratio, until they
	 * close the circle; `"sweep"` wipes round the pie, uncovering slices in data order.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	reveal?: RadialReveal;
	/**
	 * Angle the first slice begins at, in radians from +x. The default is 12 o'clock.
	 * @default Math.PI / 2
	 */
	startAngle?: number;
	/**
	 * Whether slices run clockwise.
	 * @default true
	 */
	clockwise?: boolean;
	/** One colour for every slice, or `(d, i) => colour`. Wins over `colors`. */
	color?: ColorChannel<T>;
	/** Colours cycled across the slices by index. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/**
	 * Whether to draw slice labels.
	 * @default true
	 */
	labels?: boolean;
	/** Label font size. */
	labelFontSize?: number;
	/** Label colour. Defaults to the theme background. */
	labelColor?: ColorInput;
	/**
	 * Each slice's identity across transitions. See {@link KeyedTransitionProps}. Defaults to
	 * `label`, else the index.
	 */
	key?: Channel<T, BandKey>;
	/**
	 * The data to transition to, matched to `data` by `key`: values blend and the pie is re-laid
	 * out every frame, so the slices always fill the turn; leaving slices shrink away, new ones
	 * open up. See {@link KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** Slice outline. Defaults to the theme background. */
	stroke?: ColorInput;
	/**
	 * Outline width.
	 * @default 0.02
	 */
	strokeWidth?: number;
	/** Fill opacity of the slices, 0..1. */
	fillOpacity?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the chart. */
	visible?: boolean;
}

/**
 * Props of {@link pieChart}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export type PieChartProps<T> = PieChartBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** A slice in data units: its value and its colour. */
interface SliceState {
	value: number;
	color: string;
}

/** Never shown: a key with no slice in the layout (nothing has weight). */
const EMPTY_RING: RingSlice = {
	startAngle: 0,
	endAngle: 0,
	fraction: 0,
	offset: 0,
};

/** Two slices blended at `u`: the value in data units, the colour in OKLCH. */
function blendSlice(a: SliceState, b: SliceState, u: number): SliceState {
	return {
		value: mix(a.value, b.value, u),
		color: blendCss(a.color, b.color, u),
	};
}

/** What a pie keeps between updates. */
interface PieState {
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	wedges: PathBatchNode<PathBatchItemsProps>;
	items: ReturnType<typeof createItemCache<PathBatchItem | undefined>>;
	values: (data: readonly unknown[], value: unknown) => number[];
	labels: (
		data: readonly unknown[],
		label: unknown,
	) => readonly string[] | undefined;
	orders: (join: KeyedJoin | undefined, keys: readonly BandKey[]) => RingOrders;
	/** Each drawn item's accessible name, by item index. */
	names: (string | undefined)[];
	itemLabel: (item: number) => string | undefined;
}

const states = new WeakMap<object, PieState>();

function draw(ctx: CompositeContext<PieChartProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as PieState;
	const props = ctx.props;
	const theme = ctx.theme;
	const frame = ctx.context(chartContext);
	const dates = ctx.context(dateSinkContext);

	const values = state.values(props.data, props.value);
	const labels = state.labels(props.data, props.label);
	const toValues = props.to ? state.values(props.to, props.value) : undefined;
	const toLabels = props.to ? state.labels(props.to, props.label) : undefined;

	// Slices by `key`, else by `label`, else by index; without `to`, `data`'s alone.
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: (props.key ?? props.label) as Channel<unknown, BandKey> | undefined,
		series: undefined,
		of: undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		dates,
	});

	const color = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const at = (
		data: readonly unknown[],
		read: readonly number[],
		index: number,
	) =>
		index < 0
			? undefined
			: {
					index,
					state: {
						value: clampNonNegative(read[index] as number),
						color: color(data[index], index),
					},
				};
	// Each key's slice on this frame, in data units: its value (blended,
	// growing or shrinking) and colour.
	const frames = new Map<BandKey, JoinFrame<SliceState>>();
	for (const key of keyed.keys) {
		const next = joinFrame(
			keyed,
			at(props.data, values, keyed.fromIndex(key)),
			props.to && toValues
				? at(props.to, toValues, keyed.toIndex(key))
				: undefined,
			blendSlice,
			key,
		);
		if (next) frames.set(key, next);
	}
	// The ring order at each end: one order unless the slices both ends have are reordered.
	const orders = state.orders(keyed.join, keyed.keys);
	// Each key's slice of the turn, laid out from the values as they stand
	// (weighted by presence), so the turn is always full.
	const layout = ringLayout(
		orders,
		(key) => {
			const own = frames.get(key);
			return own ? own.state.value * own.presence : 0;
		},
		keyed.update,
		{ startAngle: props.startAngle, clockwise: props.clockwise },
	);
	const origin = resolvePolarSweep({
		startAngle: props.startAngle,
	}).startAngle;
	const progress = clamp01(props.progress ?? 1);
	const growing = props.reveal !== "sweep";

	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const radius = props.radius ?? 1;
	const innerRadius = props.innerRadius ?? 0;
	const labelFraction = labelRingFraction(innerRadius, radius);
	const labelColor = props.labelColor ?? theme.palette.background;

	const items: PathBatchItem[] = [];
	const names: (string | undefined)[] = [];
	const texts: KeyedLabel[] = [];
	for (const key of keyed.keys) {
		const own = frames.get(key);
		if (!own) continue;
		const slice = layout.get(key) ?? EMPTY_RING;
		const shown = growing ? progress : sweepShare(slice, progress);
		// This slice's drawn angles: squeezed round together while growing
		// (`pieGrow`), else its own.
		const startAngle = growing
			? origin + (slice.startAngle - origin) * progress
			: slice.startAngle;
		const endAngle = growing
			? origin + (slice.endAngle - origin) * progress
			: slice.endAngle;
		/** The drawn part of this slice's signed angle. */
		const angle = growing
			? endAngle - startAngle
			: (slice.endAngle - slice.startAngle) * shown;
		const present = slice.endAngle - slice.startAngle !== 0 && shown > 0;
		if (!present) continue;
		// Its text: the label of the datum it reads from, else its share as it stands.
		const text =
			(own.end === "from" ? labels : toLabels)?.[own.index] ??
			`${Math.round(slice.fraction * 100)}%`;
		const item = state.items.get(
			key,
			[cx, cy, innerRadius, radius, startAngle, angle, own.state.color],
			() =>
				wedgeItem(
					{
						cx,
						cy,
						innerRadius,
						outerRadius: radius,
						startAngle,
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
		// Rides round with its slice, `labelRingFraction` of the way from the
		// hole to the rim; fades in over the last part of its slice's reveal,
		// once the slices have room for their text, and with its presence.
		const mid = (startAngle + endAngle) / 2;
		const labelRadius = innerRadius + (radius - innerRadius) * labelFraction;
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
				opacity:
					clamp01((shown - LABEL_REVEAL_START) / (1 - LABEL_REVEAL_START)) *
					own.presence,
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
 * A pie chart, or a doughnut with `innerRadius`: one slice per value, sized by its share of
 * the total, separated by a thin background-coloured outline. Draws in scene units; nothing is
 * drawn if every value is 0. The slices are one path batch (`event.item` is the slice's place
 * among the drawn ones). See {@link pieSlices} for the angle math alone.
 *
 * @example
 * ```ts
 * import { pieChart } from "@sophistry/charts";
 *
 * pieChart.create({
 * 	data: [
 * 		{ lang: "Rust", share: 3 },
 * 		{ lang: "Go", share: 2 },
 * 	],
 * 	value: "share",
 * 	label: "lang",
 * 	innerRadius: 0.4,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#pie-polar-area-and-radar
 * @category Charts
 */
export const pieChart = defineComposite<PieChartProps<AnyDatum>>({
	name: "PieChart",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		ariaLabel: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		innerRadius: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		startAngle: { invalidates: Invalidate.UPDATE },
		clockwise: { invalidates: Invalidate.UPDATE },
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
		const state: PieState = {
			keyed: createKeyedData<AnyDatum>(),
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
			names: [],
			itemLabel: (item) => state.names[item],
		};
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});

/** Both ends' ring orders. */
export interface RingOrders {
	from: readonly BandKey[];
	to: readonly BandKey[];
}

/**
 * The ring order at each end: one order unless the keys both ends have are
 * reordered. Memoise it on the join (kept by identity while the keys hold).
 */
export function ringOrders(
	join: KeyedJoin | undefined,
	keys: readonly BandKey[],
): RingOrders {
	if (!join) return { from: keys, to: keys };
	const from = [...join.from.keys()];
	const to = [...join.to.keys()];
	return { from: ringOrder(from, to, "from"), to: ringOrder(from, to, "to") };
}
