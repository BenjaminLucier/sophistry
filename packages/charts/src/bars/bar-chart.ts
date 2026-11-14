/**
 * `barChart`: a one-series categorical bar chart with names underneath, as
 * its own plot: a `chart` whose children are a `bars` layer, the names (an
 * internal `BarNames` layer of label nodes) and the user's children.
 */

import type {
	AxisOptions,
	CompositeContext,
	CoordinateSystem,
	SceneNode,
	TextNodeProps,
} from "@sophistry/core";
import {
	boundsFromCenter,
	DOWN,
	defineComposite,
	Invalidate,
	nextTo,
	text,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Bounds, Point, Range } from "@sophistry/core/geometry";
import { measureLabel } from "@sophistry/core/internal";
import { chart, chartHandle } from "../chart.js";
import { chartContext } from "../context.js";
import type { Channel, ColorChannel } from "../data/channels.js";
import { identity, numberValues, resolveChannel } from "../data/channels.js";
import type { JoinFrame } from "../join.js";
import { createJoin, joinFrame } from "../join.js";
import { DEFAULT_BAR_WIDTH } from "../math/bar.js";
import type { JoinStaging } from "../math/join.js";
import { datumKeys } from "../math/ordinal.js";
import { autoRange } from "../math/range.js";
import type { AnyDatum, TransitionProps } from "../props.js";
import { mix } from "../util.js";
import { bars, barsHandle } from "./bars.js";
import { labelStyle } from "./shared.js";

const DEFAULT_NAME_FONT_SIZE = 0.28;
const DEFAULT_LABEL_GAP = 0.16;

/**
 * What {@link barChartHandle} hands back: bar boxes in scene units, and the chart's coordinate system.
 *
 * @category Charts
 */
export interface BarChartHandle {
	/** How many bars there are — `data.length`. */
	count(): number;
	/**
	 * One bar's box in scene units, or null if the index is out of range. Feed it to `nextTo` or
	 * `surroundingRectangle` to annotate a bar.
	 */
	barBounds(index: number): Bounds | null;
	/** The chart's coordinate system: x is the slot index, y the value. */
	coords: CoordinateSystem;
}

/**
 * Props of {@link barChart}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface BarChartProps<T = unknown> extends TransitionProps<T> {
	/** One bar per datum. */
	data: readonly T[];
	/**
	 * The bar's value, in data units. Defaults to the datum when `data` is `number[]`; required
	 * otherwise. Negative values hang below the baseline; non-finite values leave an empty slot.
	 */
	value?: Channel<T, number>;
	/** The name drawn under each bar. Omitted, no names are drawn. */
	label?: Channel<T, string>;
	/** `[min, max, step?]` in data units. Omitted, fitted to the data (including 0). */
	yRange?: Range;
	/** Width of the plotting area. */
	width: number;
	/** Height of the plotting area. */
	height: number;
	/** Centre of the plotting area. Defaults to the origin. */
	center?: Point;
	/**
	 * Bar width as a fraction of the slot pitch.
	 * @default 0.6
	 */
	barWidth?: number;
	/** One colour for every bar, or `(d, i) => colour`. Wins over `colors`. */
	color?: ColorChannel<T>;
	/** Colours cycled across the bars by index. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity, 0..1.
	 * @default 0.75
	 */
	fillOpacity?: number;
	/** Outline width of every bar. */
	barStrokeWidth?: number;
	/**
	 * The value axis: `false` hides it; an object styles it and sets its ticks.
	 * @default true
	 */
	yAxis?: boolean | AxisOptions;
	/**
	 * Whether to draw the line the bars stand on.
	 * @default true
	 */
	baseline?: boolean;
	/**
	 * Font size of the bar labels.
	 * @default 0.28
	 */
	labelFontSize?: number;
	/**
	 * Gap between the baseline (or a negative bar's bottom) and its label.
	 * @default 0.16
	 */
	labelGap?: number;
	/**
	 * Reveal, 0..1: the axis, baseline and labels first, then each bar grows out of the baseline.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * The data to transition to, bars matched by `label` (else index): they slide to their new slot
	 * and value; new ones grow in, removed ones shrink away. A sort is a transition to the same
	 * data reordered. See {@link TransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/**
	 * Fraction of a transition's enter stage spent staggering entering bars (and their labels). See
	 * {@link TransitionProps}.
	 * @default 0
	 */
	enterStagger?: number;
	/** Paint order; higher draws later. */
	zIndex?: number;
	visible?: boolean;
	/** Placed inside the chart's coordinate context. */
	children?: readonly SceneNode[];
}

/** Whether every name is given and none repeats. */
function distinct(names: readonly (string | undefined)[]): boolean {
	return (
		names.every((name) => name !== undefined && name !== null) &&
		new Set(names).size === names.length
	);
}

/** What a bar chart keeps: its chart, bars and names nodes. */
interface BarChartState {
	chart: SceneNode;
	bars: SceneNode;
	names: SceneNode;
}

const states = new WeakMap<object, BarChartState>();

/**
 * A `barChart` node's handle, as of its last
 * update.
 *
 * @param node - A node made by {@link barChart}.
 * @returns The handle, or null for a node that is not a `barChart`.
 * @category Charts
 */
export function barChartHandle(node: SceneNode): BarChartHandle | null {
	(node as { refresh?(): void }).refresh?.();
	const state = states.get(node);
	if (!state) return null;
	const plot = chartHandle(state.chart);
	const own = barsHandle(state.bars);
	if (!plot || !own) return null;
	return {
		count: own.count,
		barBounds: own.barBounds,
		coords: plot.coords,
	};
}

/** Each update's props of the chart, bars and names. */
function parts(props: Readonly<BarChartProps<unknown>>) {
	const values = numberValues(props.data, props.value, identity, "value");
	const read = resolveChannel(props.label, undefined, "label");
	const labels = read ? props.data.map((d, i) => read(d, i)) : undefined;
	const toLabels =
		read && props.to ? props.to.map((d, i) => read(d, i)) : undefined;
	const toValues =
		props.to === undefined
			? undefined
			: numberValues(props.to, props.value, identity, "value");
	/**
	 * With `to`, the names are the slots when every bar at both ends has a unique one (so a moving
	 * bar takes its name with it); otherwise slots stay by index.
	 */
	const named =
		props.to !== undefined &&
		!!labels &&
		!!toLabels &&
		distinct(labels) &&
		distinct(toLabels);
	const category: Channel<unknown, BandKey> =
		named && read ? (d, i) => read(d, i) as BandKey : (_, i) => i;
	const key: Channel<unknown, BandKey> | undefined =
		props.to === undefined || !read
			? undefined
			: (d, i) => read(d, i) as BandKey;
	return {
		chart: {
			width: props.width,
			height: props.height,
			center: props.center,
			// Under a transition `bars` reports both ends and the frame fits them.
			yRange:
				props.yRange ??
				(props.to === undefined ? (autoRange(values) as Range) : undefined),
			xAxis: {
				scale: "band",
				categories:
					props.to === undefined ? props.data.map((_, i) => i) : undefined,
				padding: 1 - (props.barWidth ?? DEFAULT_BAR_WIDTH),
				// Names are drawn below, where they can dodge a negative bar.
				numbers: false,
				line: props.baseline !== false,
				// The axis line is the baseline the bars stand on (Manim's
				// BarChart), so it stays at zero rather than going to the edge.
				position: "zero",
			},
			yAxis: {
				// `false` hides the axis; an object's own `visible` wins.
				visible: props.yAxis !== false,
				...(typeof props.yAxis === "object" ? props.yAxis : {}),
			},
			progress: props.progress,
			zIndex: props.zIndex,
			visible: props.visible,
		},
		bars: {
			data: props.data,
			category:
				props.to === undefined ? (_: unknown, i: number) => i : category,
			value:
				props.to === undefined
					? (_: unknown, i: number) => values[i]
					: resolveChannel<unknown, number>(props.value, identity, "value"),
			key,
			to: props.to,
			blend: props.blend,
			staging: props.staging,
			enterStagger: props.enterStagger,
			color: props.color,
			colors: props.colors,
			fillOpacity: props.fillOpacity,
			strokeWidth: props.barStrokeWidth,
			zIndex: props.zIndex,
			visible: props.visible,
		},
		names: {
			names: labels,
			toNames: props.to === undefined ? undefined : (toLabels ?? []),
			values,
			toValues: toValues ?? [],
			named,
			blend: props.blend,
			staging: props.staging,
			enterStagger: props.enterStagger,
			fontSize: props.labelFontSize ?? DEFAULT_NAME_FONT_SIZE,
			gap: props.labelGap ?? DEFAULT_LABEL_GAP,
			zIndex: props.zIndex,
		} satisfies BarNamesProps,
	};
}

/**
 * A one-series categorical bar chart with names underneath, as its own plot
 * sized by `width`/`height` (not inside an `axes` or `chart`). Children
 * share its coordinates: slot `i` is centred at `i + 0.5`. For horizontal,
 * stacked or multi-layer bars use a `chart` with {@link bars}, which this is
 * built from.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { barChart } from "@sophistry/charts";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * const sales = [
 * 	{ quarter: "Q1", units: 120 },
 * 	{ quarter: "Q2", units: 90 },
 * ];
 * scene.add(barChart.create({ data: sales, value: "units", label: "quarter", width: 8, height: 4 }));
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#bars
 * @category Charts
 */
export const barChart = defineComposite<BarChartProps<AnyDatum>>({
	name: "BarChart",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		barWidth: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		barStrokeWidth: { invalidates: Invalidate.UPDATE },
		yAxis: { invalidates: Invalidate.UPDATE },
		baseline: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		labelGap: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const own = parts(ctx.props);
		const barsNode = bars.create(own.bars as never);
		const namesNode = barNames.create(own.names);
		const chartNode = chart.create({
			...(own.chart as object),
			children: [barsNode, namesNode, ...ctx.children],
		} as never);
		states.set(ctx.node, {
			chart: chartNode,
			bars: barsNode,
			names: namesNode,
		});
		return [chartNode];
	},
	update: (_changed, ctx) => {
		const state = states.get(ctx.node) as BarChartState;
		const own = parts(ctx.props);
		state.chart.update({
			...(own.chart as object),
			children: [state.bars, state.names, ...ctx.children],
		} as never);
		state.bars.update(own.bars as never);
		state.names.update(own.names as never);
		return [state.chart];
	},
});

/* --------------------------------------------------------------- the names */

/** Props of the internal names layer. */
interface BarNamesProps {
	names: readonly (string | undefined)[] | undefined;
	/** With a transition: `to`'s names (else undefined). */
	toNames: readonly (string | undefined)[] | undefined;
	values: readonly number[];
	toValues: readonly number[];
	/** The slots are the names (else indices). */
	named: boolean;
	blend?: number;
	staging?: JoinStaging;
	enterStagger?: number;
	fontSize: number;
	gap: number;
	zIndex?: number;
}

/** A bar's name on one frame: the bar's centre and value (data units), and the text. */
interface NameState {
	x: number;
	value: number;
	text: string | undefined;
}

/** Two names blended at `u`: they ride the bar (in data units); the text is the nearer end's. */
function blendName(a: NameState, b: NameState, u: number): NameState {
	const finite = Number.isFinite(a.value) && Number.isFinite(b.value);
	return {
		x: mix(a.x, b.x, u),
		value: finite ? mix(a.value, b.value, u) : u < 0.5 ? a.value : b.value,
		text: u < 0.5 ? a.text : b.text,
	};
}

/**
 * A name's place under the baseline, placed by its measured box so every
 * name clears the axis by the same gap.
 */
function namePlace(
	text: string,
	at: Point,
	gap: number,
	fontSize: number,
	fontFamily: string,
) {
	const size = measureLabel(text, labelStyle(fontSize, fontFamily));
	const height = size.ascent + size.descent;
	const box: Bounds = {
		minX: -size.width / 2,
		maxX: size.width / 2,
		minY: -height / 2,
		maxY: height / 2,
	};
	return nextTo(box, boundsFromCenter(at, 0, 0), DOWN, { gap });
}

const joins = new WeakMap<object, ReturnType<typeof createJoin>>();

function drawNames(ctx: CompositeContext<BarNamesProps>): SceneNode[] {
	const props = ctx.props;
	const plot = ctx.context(chartContext);
	if (!plot || !props.names)
		return ctx.list("names", [], { create: () => text.create({ text: "" }) });
	const { coords } = plot;
	const theme = ctx.theme;
	const fontFamily = theme.defaults.fontFamily;
	const progress = plot.frameProgress;
	const entries: { key: unknown; props: TextNodeProps }[] = [];
	/** Hung from the lower of the baseline and the bar's own bottom edge. */
	const anchor = (x: number, value: number): Point => {
		const foot = coords.coordsToPoint(x, coords.crossing().y);
		if (!Number.isFinite(value)) return foot;
		return {
			x: foot.x,
			y: Math.min(foot.y, coords.coordsToPoint(x, value).y),
		};
	};
	const push = (key: unknown, text: string, at: Point, opacity?: number) =>
		entries.push({
			key,
			props: {
				text,
				place: namePlace(text, at, props.gap, props.fontSize, fontFamily),
				fontSize: props.fontSize,
				color: theme.palette.muted,
				// Faded in whole, as the axes' names are, rather than written on.
				opacity: progress < 1 ? (opacity ?? 1) * progress : opacity,
				zIndex: props.zIndex,
			},
		});
	if (props.toNames === undefined) {
		const band = plot.xBand;
		props.names.forEach((name, index) => {
			if (!name) return;
			// A bar stands only where its value is finite and its slot is on the axis.
			const value =
				band?.start(index) === undefined ? Number.NaN : props.values[index];
			push(index, name, anchor(index + 0.5, value as number));
		});
	} else {
		/** Each bar's identity, as `bars` keys it: its name. */
		const keysOf = (names: readonly (string | undefined)[]) =>
			datumKeys(names.length, (i) => names[i]);
		const join = (joins.get(ctx.node) as ReturnType<typeof createJoin>)({
			fromKeys: keysOf(props.names),
			toKeys: keysOf(props.toNames),
			blend: props.blend,
			staging: props.staging,
			chartStages: plot.join,
			enterStagger: props.enterStagger,
		});
		const band = plot.xBand;
		if (band) {
			const at = (
				names: readonly (string | undefined)[],
				values: readonly number[],
				index: number | undefined,
			) => {
				if (index === undefined) return undefined;
				const x = band.center(props.named ? (names[index] as BandKey) : index);
				if (x === undefined) return undefined;
				return {
					index,
					state: { x, value: values[index] as number, text: names[index] },
				};
			};
			for (const key of join.keys) {
				const frame: JoinFrame<NameState> | undefined = joinFrame(
					join,
					at(props.names, props.values, join.fromSlots.get(key)),
					at(props.toNames, props.toValues, join.toSlots?.get(key)),
					blendName,
					key,
				);
				if (!frame || !(frame.presence > 0) || !frame.state.text) continue;
				push(
					key,
					frame.state.text,
					anchor(frame.state.x, frame.state.value),
					frame.presence < 1 ? frame.presence : undefined,
				);
			}
		}
	}
	return ctx.list("names", entries, {
		key: (entry) => entry.key,
		create: (entry) => text.create(entry.props),
		update: (node, entry) => {
			node.update(entry.props);
		},
	});
}

/** The names under a bar chart's bars, timed with the frame. Internal. */
const barNames = defineComposite<BarNamesProps>({
	name: "BarNames",
	props: {
		names: { invalidates: Invalidate.UPDATE },
		toNames: { invalidates: Invalidate.UPDATE },
		values: { default: [], invalidates: Invalidate.UPDATE },
		toValues: { default: [], invalidates: Invalidate.UPDATE },
		named: { default: false, invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		fontSize: {
			default: DEFAULT_NAME_FONT_SIZE,
			invalidates: Invalidate.UPDATE,
		},
		gap: { default: DEFAULT_LABEL_GAP, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		joins.set(ctx.node, createJoin());
		return drawNames(ctx);
	},
	update: (_changed, ctx) => drawNames(ctx),
});
