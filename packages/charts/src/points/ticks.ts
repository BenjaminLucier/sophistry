/**
 * `tickX` / `tickY`: short marks at positions along one axis, a rug on the
 * axis or one tick spanning each band (a strip plot). One `line` instances
 * node per layer (see `segment-marks.ts`).
 */

import type { CompositeContext, CoordinateSystem } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { BandKey, BandScale, Point } from "@sophistry/core/geometry";
import { bandSpan, positionOf } from "../band.js";
import type { MarkTransition } from "../batch.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel, PositionValue } from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	identity,
	resolveChannel,
} from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { AxisExtent, ChartFrame } from "../frame/types.js";
import type { JoinEnd, JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrames,
	keyRanks,
	layerTransition,
} from "../join.js";
import { blendCss, mixPoints } from "../mix.js";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { tooltipContext, tooltipText } from "../tooltip.js";
import { keyedMemo, mix } from "../util.js";
import type { SegmentItem, SegmentMark } from "./segment-marks.js";
import { createSegmentMark } from "./segment-marks.js";
import { createItemHandlers, stableShared, tooltipsOn } from "./shared.js";

const DEFAULT_LENGTH = 0.3;

/**
 * What {@link tickX} and {@link tickY} share.
 *
 * @category Charts
 */
export interface TickBaseProps<T> extends KeyedTransitionProps<T>, RevealProps {
	/** One tick per datum. */
	data: readonly T[];
	/**
	 * Tick length, when not spanning a band.
	 * @default 0.3
	 */
	length?: number;
	/** Tick colour, constant or `(d, i) => colour`. Defaults to the theme's first series colour. */
	color?: ColorChannel<T>;
	/** Line width. */
	strokeWidth?: number;
	opacity?: number;
	/**
	 * Reveal, 0..1: each tick draws from its low end.
	 * @default 1
	 */
	progress?: number;
	/** Hover tooltip: `true` for its category (if any) and value, or a template, function or options. */
	tooltip?: TooltipSpec<T>;
	/** How ticks move when `data` changes outside a `to` blend; see {@link MarkTransition}. */
	transition?: MarkTransition;
	zIndex?: number;
	visible?: boolean;
}

/**
 * Props of {@link tickX}.
 *
 * @category Charts
 */
export interface TickXProps<T = unknown> extends TickBaseProps<T> {
	/** Position along x, in data units (a `Date` reads as epoch ms). Defaults to the datum when `data` is `number[]`. */
	x?: Channel<T, PositionValue>;
	/**
	 * Which row the tick sits in: a category on a band y axis spans that band (a strip plot); a
	 * number centres a `length`-long tick on it. Omitted, the tick sits on the x axis (a rug).
	 */
	y?: Channel<T, BandKey | PositionValue>;
}

/**
 * Props of {@link tickY}.
 *
 * @category Charts
 */
export interface TickYProps<T = unknown> extends TickBaseProps<T> {
	/** Position along y, in data units (a `Date` reads as epoch ms). Defaults to the datum when `data` is `number[]`. */
	y?: Channel<T, PositionValue>;
	/** Which column the tick sits in; see {@link TickXProps.y}. Omitted, the tick sits on the y axis. */
	x?: Channel<T, BandKey | PositionValue>;
}

/** One tick's channels, as given. */
interface TickRow {
	along: number;
	across: BandKey | undefined;
}

/** A tick on one frame: its value in data units, its two edges across in scene units, its colour. */
interface TickState {
	along: number;
	lo: number;
	hi: number;
	color: string;
}

function blendTick(a: TickState, b: TickState, u: number): TickState {
	return {
		along: mix(a.along, b.along, u),
		lo: mix(a.lo, b.lo, u),
		hi: mix(a.hi, b.hi, u),
		color: a.color === b.color ? a.color : blendCss(a.color, b.color, u),
	};
}

interface TickItem extends SegmentItem {
	high: Point;
	frame: JoinFrame<TickState>;
}

interface TicksState {
	layer: ChartLayer;
	tooltip: TooltipState | null;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	ticks: SegmentMark<TickItem>;
	rows: {
		from: ReturnType<typeof keyedMemo<TickRow[]>>;
		to: ReturnType<typeof keyedMemo<TickRow[]>>;
	};
	shared: (next: Record<string, unknown>) => Record<string, unknown>;
	handlers: ReturnType<typeof createItemHandlers>;
	current: {
		props: TickBaseProps<AnyDatum> & { x?: unknown; y?: unknown };
		frame: ChartFrame | null;
		fromRows: TickRow[];
		toRows: TickRow[] | undefined;
	};
}

type AnyTickProps = TickBaseProps<AnyDatum> & {
	x?: Channel<AnyDatum, BandKey | PositionValue>;
	y?: Channel<AnyDatum, BandKey | PositionValue>;
};

/**
 * Where a tick runs across its axis, `[low, high]` in scene units: its band's edges, else
 * `length` centred on its row.
 */
function tickAcross(
	coords: CoordinateSystem,
	band: BandScale | undefined,
	axesAt: { x: number; y: number },
	vertical: boolean,
	row: TickRow,
	length: number,
): [number, number] | null {
	if (!Number.isFinite(row.along)) return null;
	const span = bandSpan(band, row.across);
	const point = (along: number, across: number) =>
		vertical
			? coords.coordsToPoint(along, across)
			: coords.coordsToPoint(across, along);
	if (span) {
		const a = point(row.along, span[0]);
		const b = point(row.along, span[1]);
		return vertical
			? [Math.min(a.y, b.y), Math.max(a.y, b.y)]
			: [Math.min(a.x, b.x), Math.max(a.x, b.x)];
	}
	// Centred on the axis as drawn (its `position`), not the baseline.
	const across =
		positionOf(band, row.across) ?? (vertical ? axesAt.y : axesAt.x);
	const centre = point(row.along, across);
	const half = length / 2;
	return vertical
		? [centre.y - half, centre.y + half]
		: [centre.x - half, centre.x + half];
}

/** A tick's two ends in scene units, low end first. */
function tickEnds(
	coords: CoordinateSystem,
	vertical: boolean,
	tick: TickState,
): [Point, Point] | null {
	if (!Number.isFinite(tick.along)) return null;
	if (vertical) {
		const x = coords.coordsToPoint(tick.along, 0).x;
		return [
			{ x, y: tick.lo },
			{ x, y: tick.hi },
		];
	}
	const y = coords.coordsToPoint(0, tick.along).y;
	return [
		{ x: tick.lo, y },
		{ x: tick.hi, y },
	];
}

/** The shared body: `vertical` ticks (tickX) stand at an x and run up y; tickY is the transpose. */
function drawTicks(
	ctx: CompositeContext<AnyTickProps>,
	states: WeakMap<object, TicksState>,
	vertical: boolean,
	name: string,
) {
	const state = states.get(ctx.node) as TicksState;
	const props = ctx.props;
	const { layer, tooltip } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error(`${name} must be placed inside a chart or axes.`);
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	const along = vertical ? props.x : props.y;
	const across = vertical ? props.y : props.x;
	const alongName = vertical ? "x" : "y";

	const rowsOf = (data: readonly unknown[], end: "from" | "to") =>
		state.rows[end]([data, along, across, dates], () => {
			const readAlong = resolveChannel<unknown, PositionValue>(
				along as Channel<unknown, PositionValue>,
				identity,
				alongName,
				dates,
			);
			const readAcross = resolveChannel(
				across as Channel<unknown, BandKey | PositionValue> | undefined,
				undefined,
				vertical ? "y" : "x",
				dates,
			);
			return data.map((d, i) => ({
				along: readAlong(d, i) as number,
				across: readAcross?.(d, i) as BandKey | undefined,
			}));
		});
	const fromRows = rowsOf(props.data, "from");
	const toRows = props.to ? rowsOf(props.to, "to") : undefined;
	state.current = { props, frame, fromRows, toRows };
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: undefined,
		of: undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		dates,
	});
	/** One end's extents: along, its values; across, its rows (categories when any is one). */
	const extentsOf = (rows: readonly TickRow[]) => {
		const alongExtent: AxisExtent = { values: rows.map((r) => r.along) };
		const keys = rows.flatMap((r) =>
			r.across === undefined ? [] : [r.across],
		);
		const categories = keys.filter((k) => typeof k === "string");
		const acrossExtent: AxisExtent =
			categories.length > 0
				? { categories }
				: { values: keys.filter((k): k is number => typeof k === "number") };
		return vertical
			? { x: alongExtent, y: acrossExtent }
			: { x: acrossExtent, y: alongExtent };
	};
	layer.report({
		...extentsOf(fromRows),
		transition: layerTransition(
			keyed,
			props.staging,
			toRows ? extentsOf(toRows) : {},
		),
	});

	const colorOf = colorResolver(
		props.color as ColorChannel<unknown>,
		theme.palette.series.slice(0, 1),
		theme.palette.foreground,
	);
	const space = endSpace(frame, coords);
	const length = props.length ?? DEFAULT_LENGTH;
	const frames = joinFrames<TickState>(
		keyed,
		(end: JoinEnd, index) => {
			const row = (end === "from" ? fromRows : toRows)?.[index];
			const data = end === "from" ? props.data : props.to;
			if (!row || !data) return undefined;
			const span = tickAcross(
				space.coords(end),
				space.band(end, vertical ? "y" : "x"),
				space.axesAt(end),
				vertical,
				row,
				length,
			);
			if (!span) return undefined;
			return {
				along: row.along,
				lo: span[0],
				hi: span[1],
				color: colorOf(data[index], index),
			};
		},
		blendTick,
		space.swapping,
	);
	const rank = keyRanks(keyed.keys);
	const count = keyed.active ? keyed.keys.length : props.data.length;
	const progress = layer.progress(props.progress) ?? 1;
	const items: TickItem[] = [];
	for (const key of keyed.keys) {
		const own = frames.get(key);
		if (!own || !(own.presence > 0)) continue;
		const reveal =
			staggered(progress, rank.get(key) ?? 0, count, props.stagger ?? 0) *
			own.presence;
		if (!(reveal > 0)) continue;
		const line = space.shape(
			own,
			(tick, _end, system) => tickEnds(system, vertical, tick),
			mixPoints,
		);
		if (!line) continue;
		items.push({
			key,
			from: line[0],
			to: line[1],
			progress: Math.min(1, reveal),
			high: line[1],
			stroke: own.state.color,
			frame: own,
		});
	}
	state.ticks.update(
		items,
		state.shared({
			strokeWidth: props.strokeWidth,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
			...state.handlers(
				tooltipsOn(tooltip, props.tooltip),
				`${name}, ${items.length} ticks`,
			),
		}) as never,
		{ transition: props.transition, animate: !keyed.active && progress >= 1 },
	);
	return [state.ticks.node];
}

/** A tick's tooltip: its row (if any) and value. */
function tipText(
	state: TicksState,
	own: JoinFrame<TickState>,
	vertical: boolean,
) {
	const { props, frame, fromRows, toRows } = state.current;
	const toEnd = own.end === "to";
	const row = (toEnd ? toRows : fromRows)?.[own.index];
	const data = toEnd ? props.to : props.data;
	const alongName = vertical ? "x" : "y";
	const acrossName = vertical ? "y" : "x";
	return tooltipText(
		props.tooltip,
		() => [
			{
				channel: acrossName,
				of: vertical ? props.y : props.x,
				value: row?.across,
				format: frame?.format(acrossName),
			},
			{
				channel: alongName,
				of: vertical ? props.x : props.y,
				value: row?.along,
				format: frame?.format(alongName),
			},
		],
		data?.[own.index],
		own.index,
		state.tooltip ?? undefined,
	);
}

const tickProps = {
	data: { default: [], invalidates: Invalidate.UPDATE },
	x: { invalidates: Invalidate.UPDATE },
	y: { invalidates: Invalidate.UPDATE },
	length: { invalidates: Invalidate.UPDATE },
	color: { invalidates: Invalidate.UPDATE },
	strokeWidth: { invalidates: Invalidate.UPDATE },
	opacity: { invalidates: Invalidate.UPDATE },
	progress: { default: 1, invalidates: Invalidate.UPDATE },
	stagger: { invalidates: Invalidate.UPDATE },
	tooltip: { invalidates: Invalidate.UPDATE },
	key: { invalidates: Invalidate.UPDATE },
	to: { invalidates: Invalidate.UPDATE },
	blend: { invalidates: Invalidate.UPDATE },
	staging: { invalidates: Invalidate.UPDATE },
	enterStagger: { invalidates: Invalidate.UPDATE },
	transition: { invalidates: Invalidate.UPDATE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
} as const;

/** `setup` and `update` of one orientation. */
function tickDefinition(vertical: boolean, name: string) {
	const states = new WeakMap<object, TicksState>();
	return {
		setup: (ctx: CompositeContext<AnyTickProps>) => {
			const layer = chartLayer(ctx);
			const tooltip = ctx.context(tooltipContext);
			const state: TicksState = {
				layer,
				tooltip,
				keyed: createKeyedData<AnyDatum>(),
				ticks: createSegmentMark<TickItem>(),
				rows: { from: keyedMemo(), to: keyedMemo() },
				shared: stableShared(),
				handlers: () => ({}),
				current: {
					props: ctx.props,
					frame: null,
					fromRows: [],
					toRows: undefined,
				},
			};
			state.handlers = createItemHandlers(
				tooltip,
				(item) => {
					const own = state.ticks.itemAt(item);
					return own ? tipText(state, own.frame, vertical) : undefined;
				},
				(item) => state.ticks.itemAt(item)?.high,
			);
			states.set(ctx.node, state);
			return drawTicks(ctx, states, vertical, name);
		},
		update: (_changed: unknown, ctx: CompositeContext<AnyTickProps>) =>
			drawTicks(ctx, states, vertical, name),
	};
}

const tickXDefinition = tickDefinition(true, "TickX") as unknown as {
	setup: never;
	update: never;
};
const tickYDefinition = tickDefinition(false, "TickY") as unknown as {
	setup: never;
	update: never;
};

/**
 * Short vertical marks at x positions: a rug on the x axis, or with a category `y` one tick
 * spanning each band, a strip plot that never overplots into a blob. One instances node.
 *
 * @example
 * ```ts
 * import { chart, tickX } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ group: "a", value: 3 },
 * 	{ group: "b", value: 5 },
 * ];
 * chart.create({ width: 8, height: 4, children: [tickX.create({ data: rows, x: "value", y: "group" })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const tickX = defineComposite<TickXProps<AnyDatum>>({
	name: "TickX",
	props: tickProps,
	...tickXDefinition,
});

/**
 * Short horizontal marks at y positions: the transpose of {@link tickX}.
 *
 * @example
 * ```ts
 * import { chart, tickY } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ group: "a", value: 3 },
 * 	{ group: "b", value: 5 },
 * ];
 * chart.create({ width: 8, height: 4, children: [tickY.create({ data: rows, y: "value", x: "group" })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const tickY = defineComposite<TickYProps<AnyDatum>>({
	name: "TickY",
	props: tickProps,
	...tickYDefinition,
});
