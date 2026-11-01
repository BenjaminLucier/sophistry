/**
 * `waterfall`: how a starting value became a final one, change by change. A
 * preset: a `chart` whose children are a `bars` layer (floating steps) and a
 * `ruleY` layer (the dashed connectors), then the user's children.
 */

import type { AxisOptions, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { Point, Range } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import type { Theme } from "@sophistry/core/themes";
import { chart } from "../chart.js";
import type { Channel } from "../data/channels.js";
import { identity, numberValues, resolveChannel } from "../data/channels.js";
import type { WaterfallStep } from "../math/waterfall.js";
import { waterfallSteps } from "../math/waterfall.js";
import type { AnyDatum } from "../props.js";
import type { TooltipSpec } from "../tooltip.js";
import { bars } from "./bars.js";
import { ruleY } from "./rules.js";

const DEFAULT_BAR_WIDTH = 0.6;
const DEFAULT_STAGGER = 0.6;

/**
 * Props of {@link waterfall}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export interface WaterfallProps<T = unknown> {
	/** One step per datum, in order. */
	data: readonly T[];
	/**
	 * The change this step makes. Defaults to the datum when `data` is `number[]`; ignored on a
	 * total.
	 */
	value?: Channel<T, number>;
	/** The name under each bar. Omitted, no names are drawn. */
	label?: Channel<T, string>;
	/** Marks a subtotal/total bar, drawn from zero to the running total. */
	total?: Channel<T, boolean>;
	/** Width of the plotting area. */
	width: number;
	/** Height of the plotting area. */
	height: number;
	/** Centre of the plotting area. Defaults to the origin. */
	center?: Point;
	/** `[min, max, step?]` for the value axis. Omitted, fitted to the running total, including zero. */
	yRange?: Range;
	/** Styling and tick options for the value axis. */
	yAxis?: AxisOptions;
	/**
	 * Bar width as a fraction of its slot.
	 * @default 0.6
	 */
	barWidth?: number;
	/** Colour of an increase. Defaults to the theme's positive colour. */
	upColor?: ColorInput;
	/** Colour of a decrease. Defaults to the theme's negative colour. */
	downColor?: ColorInput;
	/** Colour of a total. Defaults to the theme's first series colour. */
	totalColor?: ColorInput;
	/**
	 * Write each step's change past the bar's end (`+20`, `−30`).
	 * @default true
	 */
	labels?: boolean;
	/**
	 * Draw the dashed connector from each bar's end to the next bar's start.
	 * @default true
	 */
	connectors?: boolean;
	/** Title above the chart. */
	title?: string;
	/**
	 * Reveal, 0..1: the frame, then the steps left to right (each growing from the running total),
	 * connectors after.
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the data reveal spent staggering step after step, 0..0.95.
	 * @default 0.6
	 */
	stagger?: number;
	/** Hover tooltip per step. Defaults to the step's name and change. */
	tooltip?: TooltipSpec<T>;
	zIndex?: number;
	visible?: boolean;
	/** Placed inside the chart's coordinate context (slot `i` is centred at `i + 0.5`). */
	children?: readonly SceneNode[];
}

/** A change written with its sign: `+20`, `−30`, `0`. */
function signed(delta: number): string {
	return delta > 0
		? `+${formatTick(delta)}`
		: delta < 0
			? `−${formatTick(-delta)}`
			: "0";
}

/** Each update's props of the chart, the bars and the connectors. */
function parts(props: Readonly<WaterfallProps<unknown>>, theme: Theme) {
	const deltas = numberValues(props.data, props.value, identity, "value");
	const readTotal = resolveChannel(props.total, undefined, "total");
	const steps = waterfallSteps(
		deltas,
		props.data.map((d, i) => readTotal?.(d, i) === true),
	);
	const readName = resolveChannel(props.label, undefined, "label");
	const names = readName
		? props.data.map((d, i) => readName(d, i) ?? "")
		: undefined;
	const barWidth = props.barWidth ?? DEFAULT_BAR_WIDTH;
	/**
	 * Dashed connectors, from each bar's end to the next bar at the running total: one entry per
	 * bar, the connector leading into it, so connector `i` shares bar `i`'s place in
	 * the stagger and arrives as that bar grows. A bar with none (the first, or one not starting at
	 * its neighbour's level) holds a non-finite entry, which draws nothing.
	 */
	const pad = (1 - barWidth) / 2;
	const connectors = steps.map((next, i) => {
		const step = steps[i - 1];
		// A total restarts from zero, but its top is the running total, so the
		// connector still lands on it.
		const level = step?.end ?? Number.NaN;
		if (!step || (next.kind !== "total" && next.base !== level))
			return { level: Number.NaN, from: Number.NaN, to: Number.NaN };
		return { level, from: i - pad, to: i + pad };
	});
	const colorOf = (kind: WaterfallStep["kind"]) =>
		kind === "total"
			? (props.totalColor ?? theme.palette.series[0])
			: kind === "up"
				? (props.upColor ?? theme.palette.positive)
				: (props.downColor ?? theme.palette.negative);
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	return {
		chart: {
			width: props.width,
			height: props.height,
			center: props.center,
			yRange: props.yRange,
			xAxis: {
				scale: "band" as const,
				categories: props.data.map((_, i) => i),
				padding: 1 - barWidth,
				categoryLabel: (_: unknown, i: number) => names?.[i] ?? "",
				numbers: names !== undefined,
			},
			yAxis: { zero: true, ...props.yAxis },
			title: props.title,
			progress: props.progress,
			zIndex: props.zIndex,
			visible: props.visible,
		},
		bars: {
			data: steps,
			category: (_: unknown, i: number) => i,
			base: (s: WaterfallStep) => s.base,
			value: (s: WaterfallStep) => s.end,
			color: (s: WaterfallStep) => colorOf(s.kind) as string,
			labels:
				props.labels === false
					? false
					: (s: WaterfallStep) =>
							s.kind === "total" ? formatTick(s.end) : signed(s.delta),
			stagger,
			tooltip:
				props.tooltip === undefined || props.tooltip === false
					? props.tooltip
					: (s: WaterfallStep, i: number) =>
							props.tooltip === true
								? `${names?.[i] ?? i}: ${
										s.kind === "total" ? formatTick(s.end) : signed(s.delta)
									}`
								: (props.tooltip as (d: unknown, i: number) => string)(
										props.data[i],
										i,
									),
			zIndex: props.zIndex,
			visible: props.visible,
		},
		connectors:
			props.connectors === false
				? undefined
				: {
						data: connectors,
						y: (c: { level: number }) => c.level,
						x1: (c: { from: number }) => c.from,
						x2: (c: { to: number }) => c.to,
						color: theme.palette.muted,
						dash: [0.06, 0.06],
						strokeWidth: 0.015,
						// Each connector arrives with the bar it leads into.
						stagger,
						zIndex: props.zIndex,
						visible: props.visible,
					},
	};
}

/** What a waterfall keeps: its chart, bars and connectors nodes. */
interface WaterfallState {
	chart: SceneNode;
	bars: SceneNode;
	connectors: SceneNode | null;
}

const states = new WeakMap<object, WaterfallState>();

/**
 * A waterfall chart: how a starting value became a final one, change by
 * change. Each bar floats from the running total before it to the total
 * after; `total` bars stand on zero. A preset over `chart`, {@link bars}
 * and {@link ruleY}.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { waterfall } from "@sophistry/charts";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * scene.add(
 * 	waterfall.create({
 * 		data: [{ name: "Start", v: 100 }, { name: "Sales", v: 40 }, { name: "Costs", v: -25 }, { name: "End", total: true }],
 * 		value: "v",
 * 		label: "name",
 * 		total: "total",
 * 		width: 8,
 * 		height: 4,
 * 	}),
 * );
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#waterfalls-funnels-and-candlesticks
 * @category Charts
 */
export const waterfall = defineComposite<WaterfallProps<AnyDatum>>({
	name: "Waterfall",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		total: { invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		yAxis: { invalidates: Invalidate.UPDATE },
		barWidth: { invalidates: Invalidate.UPDATE },
		upColor: { invalidates: Invalidate.UPDATE },
		downColor: { invalidates: Invalidate.UPDATE },
		totalColor: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		connectors: { invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const own = parts(ctx.props, ctx.theme);
		const state: WaterfallState = {
			chart: chart.create({ width: own.chart.width, height: own.chart.height }),
			bars: bars.create(own.bars as never),
			connectors: own.connectors ? ruleY.create(own.connectors as never) : null,
		};
		states.set(ctx.node, state);
		return place(ctx.children, state, own);
	},
	update: (_changed, ctx) => {
		const state = states.get(ctx.node) as WaterfallState;
		const own = parts(ctx.props, ctx.theme);
		state.bars.update(own.bars as never);
		if (own.connectors) {
			if (state.connectors) state.connectors.update(own.connectors as never);
			else state.connectors = ruleY.create(own.connectors as never);
		} else state.connectors = null;
		return place(ctx.children, state, own);
	},
});

/** Writes the chart's props and children. */
function place(
	children: readonly SceneNode[],
	state: WaterfallState,
	own: ReturnType<typeof parts>,
): SceneNode[] {
	state.chart.update({
		...(own.chart as object),
		children: [
			state.bars,
			...(state.connectors ? [state.connectors] : []),
			...children,
		],
	} as never);
	return [state.chart];
}
