/**
 * `eventPlot`: an event raster, one row of vertical ticks per sequence. One
 * `line` instances node for every tick of every row (see
 * `segment-marks.ts`), keyed `"row:tick"`.
 */

import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel } from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	identity,
	resolveChannel,
} from "../data/channels.js";
import type { EventRow } from "../math/eventplot.js";
import { eventPlotRows } from "../math/eventplot.js";
import type { AnyDatum } from "../props.js";
import { ranks, staggered } from "../stagger.js";
import { keyedMemo } from "../util.js";
import type { SegmentItem, SegmentMark } from "./segment-marks.js";
import { createSegmentMark } from "./segment-marks.js";
import { stableShared } from "./shared.js";

/**
 * Props of {@link eventPlot}.
 *
 * @category Charts
 */
export interface EventPlotProps<T = unknown> {
	/** One row per datum (a spike train, a subject, ...). */
	data: readonly T[];
	/**
	 * The row's event positions along x, in data units. Defaults to the datum when `data` is
	 * `number[][]`. Empty rows are fine; non-finite entries are skipped.
	 */
	events?: Channel<T, readonly number[]>;
	/**
	 * Vertical spacing between rows, in data units: row `i` is centred on `y = i * lineOffset`.
	 * @default 1
	 */
	lineOffset?: number;
	/**
	 * Length of each tick in data units, centred on its row.
	 * @default 0.8
	 */
	lineLength?: number;
	/** One colour for every row, or `(d, i) => colour`. Wins over `colors`. */
	color?: ColorChannel<T>;
	/** Colours cycled across rows by index. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/** Line width. */
	strokeWidth?: number;
	opacity?: number;
	/**
	 * Reveal, 0..1: each tick draws from its low end.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering the ticks left to right across every row, 0..0.95, so
	 * the raster fills in as the events happened.
	 * @default 0
	 */
	stagger?: number;
	zIndex?: number;
	visible?: boolean;
}

interface EventPlotState {
	layer: ChartLayer;
	ticks: SegmentMark<SegmentItem>;
	rows: ReturnType<typeof keyedMemo<EventRow[]>>;
	order: ReturnType<
		typeof keyedMemo<{ count: number; rank: number[][] } | undefined>
	>;
	shared: (next: Record<string, unknown>) => Record<string, unknown>;
}

const states = new WeakMap<object, EventPlotState>();

function draw(ctx: CompositeContext<EventPlotProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as EventPlotState;
	const props = ctx.props;
	const { layer } = state;
	const coords = layer.coords();
	if (!coords)
		throw new Error("EventPlot must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	const rows = state.rows(
		[props.data, props.events, props.lineOffset, props.lineLength, dates],
		() => {
			const read = resolveChannel<unknown, readonly number[]>(
				props.events as Channel<unknown, readonly number[]>,
				identity,
				"events",
				dates,
			);
			return eventPlotRows(
				props.data.map((d, i) => [...((read(d, i) as number[]) ?? [])]),
				{
					lineOffset: props.lineOffset ?? 1,
					lineLength: props.lineLength ?? 0.8,
				},
			);
		},
	);
	layer.report({
		x: { values: rows.flatMap((row) => row.ticks.map((tick) => tick[0].x)) },
		y: {
			values: rows.flatMap((row) =>
				row.ticks.flatMap((tick) => [tick[0].y, tick[1].y]),
			),
		},
	});
	// Each tick's place in the reveal, left to right across every row.
	const order = state.order([rows, !!props.stagger], () => {
		if (!props.stagger) return undefined;
		const flat = ranks(
			rows.flatMap((row) => row.ticks.map((tick) => tick[0].x)),
		);
		let at = 0;
		return {
			count: flat.length,
			rank: rows.map((row) => row.ticks.map(() => flat[at++] as number)),
		};
	});
	const colorOf = colorResolver(
		props.color as ColorChannel<unknown>,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const progress = layer.progress(props.progress) ?? 1;
	const items: SegmentItem[] = [];
	for (const row of rows) {
		const stroke = colorOf(props.data[row.row], row.row);
		row.ticks.forEach((tick, i) => {
			const t = order
				? staggered(
						progress,
						order.rank[row.row]?.[i] ?? 0,
						order.count,
						props.stagger ?? 0,
					)
				: progress;
			if (!(t > 0)) return;
			const from = coords.coordsToPoint(tick[0].x, tick[0].y);
			const to = coords.coordsToPoint(tick[1].x, tick[1].y);
			items.push({
				key: `${row.row}:${i}`,
				from,
				to,
				progress: Math.min(1, t),
				stroke,
			});
		});
	}
	state.ticks.update(
		items,
		state.shared({
			strokeWidth: props.strokeWidth,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
		}) as never,
	);
	return [state.ticks.node];
}

/**
 * An event raster: one row of vertical ticks per sequence (spike trains, say), each tick at an
 * event's x. Row 0 is at `y = 0`, so give the axes a y range like `[-1, data.length]`. One
 * instances node.
 *
 * @example
 * ```ts
 * import { chart, eventPlot } from "@sophistry/charts";
 *
 * chart.create({ width: 8, height: 4, yRange: [-1, 3], children: [eventPlot.create({ data: [[1, 2.5], [0.5, 3], [2]] })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const eventPlot = defineComposite<EventPlotProps<AnyDatum>>({
	name: "EventPlot",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		events: { invalidates: Invalidate.UPDATE },
		lineOffset: { invalidates: Invalidate.UPDATE },
		lineLength: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			ticks: createSegmentMark(),
			rows: keyedMemo(),
			order: keyedMemo(),
			shared: stableShared(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
