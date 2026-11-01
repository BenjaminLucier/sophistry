/**
 * Parallel coordinates: numeric variables side by side as vertical axes,
 * each datum a polyline through its value on every axis.
 *
 * The lines are one path batch (one item per drawn datum, its own stroke;
 * hover and taps resolve per item). A line's partial reveal is its item's
 * `progress`, traced by arc length. The axes are
 * core `numberLine`s and labels.
 */

import type { CompositeContext, SceneNode } from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	LEFT,
	label,
	numberLine,
	pathBatch,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { Point, Polyline, Range } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { Channel, ColorChannel } from "../data/channels.js";
import { colorResolver, numberValues } from "../data/channels.js";
import { itemTooltipHandlers } from "../item-tooltip.js";
import { parallelAxisX, parallelLines } from "../math/parallel.js";
import { fitRange } from "../math/range.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { createTooltipState, tooltipText } from "../tooltip.js";

const DEFAULT_OPACITY = 0.6;
const DEFAULT_STROKE_WIDTH = 0.025;
const DEFAULT_TICK_FONT_SIZE = 0.18;
const DEFAULT_AXIS_LABEL_FONT_SIZE = 0.24;
const AXIS_LABEL_GAP = 0.18;
/** Share of `progress` spent drawing the axes before any line. */
const AXIS_SHARE = 0.3;

/**
 * One axis of a {@link parallelCoordinates} chart.
 *
 * @category Charts
 */
export interface ParallelAxis<T> {
	/** The value each datum takes on this axis; non-finite values break the datum's line. */
	value: Channel<T, number>;
	/** Written above the axis. */
	label?: string;
	/** `[min, max, step?]` in data units. Omitted, fitted to the data. */
	range?: Range;
}

/** @category Charts */
export interface ParallelCoordinatesProps<T> {
	/** One polyline per datum. */
	data: readonly T[];
	/** One vertical axis per entry, evenly spaced left to right. */
	axes: readonly ParallelAxis<T>[];
	/** Distance from the first axis to the last. */
	width: number;
	/** Height of each axis. */
	height: number;
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/** One colour for every line, or `(d, i) => colour`. Wins over `colors`. */
	color?: ColorChannel<T>;
	/** Colours cycled across the lines by index. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/**
	 * Line width.
	 * @default 0.025
	 */
	strokeWidth?: number;
	/**
	 * Line opacity, 0..1, so dense bundles read darker.
	 * @default 0.6
	 */
	opacity?: number;
	/**
	 * Font size of the axis labels.
	 * @default 0.24
	 */
	axisLabelFontSize?: number;
	/**
	 * Font size of the tick numbers.
	 * @default 0.18
	 */
	tickFontSize?: number;
	/**
	 * Reveal, 0..1: the axes draw first, then every line draws left to right across them.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the line reveal spent staggering one datum after the next, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/** Hover tooltip: `true` lists the datum's value on each axis, or `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	zIndex?: number;
	visible?: boolean;
}

/** What a parallel-coordinates chart keeps between updates. */
interface ParallelState {
	tooltip: TooltipState;
	lines: SceneNode;
	/** The datum index of each drawn item (lines not yet revealed are left out). */
	itemDatum: number[];
	/** Each drawn item's tooltip anchor, scene units. */
	itemTop: Point[];
	columns: (
		data: readonly AnyDatum[],
		axes: readonly ParallelAxis<AnyDatum>[],
	) => number[][];
	geometry: (
		columns: number[][],
		axes: readonly ParallelAxis<AnyDatum>[],
		count: number,
	) => { ranges: Range[]; lines: ReturnType<typeof parallelLines> };
	/**
	 * Each datum's runs in scene units, kept while the lines and the chart's place hold, so a
	 * reveal reuses the same outlines (the renderer's arc lengths are cached by outline).
	 */
	placed: (
		lines: ReturnType<typeof parallelLines>,
		width: number,
		height: number,
		x: number,
		y: number,
	) => Polyline[][];
}

const parallelStates = new WeakMap<object, ParallelState>();

function drawParallel(
	ctx: CompositeContext<ParallelCoordinatesProps<AnyDatum>>,
	state: ParallelState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const axes = props.axes ?? [];
	const columns = state.columns(props.data, axes);
	const { ranges, lines } = state.geometry(columns, axes, props.data.length);
	const center = props.center ?? { x: 0, y: 0 };
	const origin = {
		x: center.x - props.width / 2,
		y: center.y - props.height / 2,
	};
	/** Normalized (0..1 each way) → scene units. */
	const toScene = (p: Point): Point => ({
		x: origin.x + p.x * props.width,
		y: origin.y + p.y * props.height,
	});
	const progress = props.progress ?? 1;
	const axisProgress = clamp01(progress / AXIS_SHARE);
	const lineShare = clamp01((progress - AXIS_SHARE) / (1 - AXIS_SHARE));

	// The axes and their labels.
	const lineNodes = ctx.list("axes", axes, {
		key: (_, j) => j,
		create: () => numberLine.create({ range: [0, 1] } as never),
	});
	const labelNodes = ctx.list("axisLabels", axes, {
		key: (_, j) => j,
		create: () => label.create({ text: "" }),
	});
	const nodes: SceneNode[] = [];
	axes.forEach((axis, j) => {
		const x = toScene({ x: parallelAxisX(j, axes.length), y: 0 }).x;
		const lineNode = lineNodes[j] as SceneNode;
		lineNode.update({
			range: ranges[j] ?? [0, 1],
			length: props.height,
			center: { x, y: origin.y + props.height / 2 },
			rotation: Math.PI / 2,
			numberDirection: LEFT,
			numberFontSize: props.tickFontSize ?? DEFAULT_TICK_FONT_SIZE,
			progress: axisProgress,
			zIndex: props.zIndex,
			visible: props.visible,
		} as never);
		nodes.push(lineNode);
		const labelNode = labelNodes[j] as SceneNode;
		labelNode.update({
			text: axis.label ?? "",
			x,
			y: origin.y + props.height + AXIS_LABEL_GAP,
			baseline: "bottom",
			fontSize: props.axisLabelFontSize ?? DEFAULT_AXIS_LABEL_FONT_SIZE,
			color: theme.palette.foreground,
			opacity: axisProgress,
			zIndex: props.zIndex,
			visible: props.visible !== false && !!axis.label,
		} as never);
		nodes.push(labelNode);
	});

	// The lines: one path batch item per datum with something drawn.
	const colorFor = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const placedLines = state.placed(
		lines,
		props.width,
		props.height,
		center.x,
		center.y,
	);
	const items = [];
	state.itemDatum = [];
	state.itemTop = [];
	for (let index = 0; index < props.data.length; index++) {
		const t = staggered(
			lineShare,
			index,
			props.data.length,
			props.stagger ?? 0,
		);
		if (t <= 0) continue;
		const placed = placedLines[index] ?? [];
		if (placed.length === 0) continue;
		// Above the line's highest point.
		let top: Point = toScene({ x: 0.5, y: 1 });
		let best = Number.NEGATIVE_INFINITY;
		for (const run of placed)
			for (const p of run)
				if (p.y > best) {
					best = p.y;
					top = p;
				}
		state.itemDatum.push(index);
		state.itemTop.push(top);
		items.push({
			polylines: placed,
			closed: false,
			stroke: colorFor(props.data[index] as AnyDatum, index),
			progress: Math.min(1, t),
		});
	}
	const defaultTooltip = (_: AnyDatum, index: number) =>
		axes
			.map((axis, j) => {
				const value = columns[j]?.[index];
				const name = axis.label ?? `#${j + 1}`;
				return `${name}: ${value !== undefined && Number.isFinite(value) ? formatTick(value) : "–"}`;
			})
			.join(" · ");
	const handlers = props.tooltip
		? itemTooltipHandlers(
				state.tooltip,
				(item) => {
					const index = state.itemDatum[item];
					return index === undefined
						? undefined
						: tooltipText(
								ctx.props.tooltip,
								defaultTooltip,
								ctx.props.data[index] as AnyDatum,
								index,
							);
				},
				(item) => state.itemTop[item],
				() => "parallel coordinates",
			)
		: {};
	state.lines.update({
		items,
		strokeWidth: props.strokeWidth ?? DEFAULT_STROKE_WIDTH,
		opacity: props.opacity ?? DEFAULT_OPACITY,
		zIndex: (props.zIndex ?? 0) + 1,
		visible: props.visible !== false && items.length > 0,
		label: handlers.label,
		onEnter: handlers.onEnter,
		onLeave: handlers.onLeave,
		onTap: handlers.onTap,
		itemLabel: handlers.itemLabel,
	} as never);
	nodes.push(state.lines);
	return nodes;
}

/**
 * Parallel coordinates: numeric variables side by side as vertical axes, each datum a
 * polyline through its value on every axis, for spotting clusters and trade-offs across many
 * dimensions. Sized by `width` and `height`; needs no `chart`. See {@link parallelLines}
 * for the geometry alone. The lines are one path batch.
 *
 * @example
 * ```ts
 * import { parallelCoordinates } from "@sophistry/charts";
 *
 * const cars = [
 * 	{ mpg: 30, hp: 95, weight: 1100 },
 * 	{ mpg: 22, hp: 150, weight: 1500 },
 * 	{ mpg: 15, hp: 240, weight: 1900 },
 * ];
 * parallelCoordinates.create({
 * 	data: cars,
 * 	axes: [
 * 		{ value: "mpg", label: "mpg" },
 * 		{ value: "hp", label: "hp" },
 * 		{ value: "weight", label: "weight" },
 * 	],
 * 	width: 8,
 * 	height: 4,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#lines-scatter-and-error-bars
 * @category Charts
 */
export const parallelCoordinates = defineComposite<
	ParallelCoordinatesProps<AnyDatum>
>({
	name: "ParallelCoordinates",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		axes: { default: [], invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		axisLabelFontSize: { invalidates: Invalidate.UPDATE },
		tickFontSize: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: ParallelState = {
			tooltip: createTooltipState(),
			lines: pathBatch.create({ items: [] }),
			itemDatum: [],
			itemTop: [],
			/** `columns[j][i]`: datum `i`'s value on axis `j`. */
			columns: ctx.memo((data, axes) =>
				axes.map((axis, j) =>
					numberValues(data, axis.value, undefined, `axes[${j}].value`),
				),
			),
			geometry: ctx.memo((columns, axes, count) => {
				const ranges = axes.map(
					(axis, j) => axis.range ?? fitRange(columns[j] ?? []),
				);
				const rows = Array.from({ length: count }, (_, i) =>
					columns.map((column) => column[i] as number),
				);
				return { ranges, lines: parallelLines(rows, ranges) };
			}),
			placed: ctx.memo((lines, width, height, x, y) =>
				lines.map((line) =>
					line.segments.map((run) =>
						run.map((p) => ({
							x: x - width / 2 + p.x * width,
							y: y - height / 2 + p.y * height,
						})),
					),
				),
			),
		};
		parallelStates.set(ctx.node, state);
		return drawParallel(ctx, state);
	},
	update: (_changed, ctx) =>
		drawParallel(ctx, parallelStates.get(ctx.node) as ParallelState),
});
