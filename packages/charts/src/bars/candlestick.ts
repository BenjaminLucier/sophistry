/**
 * `candlestick`: candles (or OHLC bars) for price data. The wicks (and the
 * OHLC ticks) are one instances node of `line`s, the bodies one of `rect`s.
 *
 * On reveal, each line's `progress` channel traces a wick from its low end
 * and an OHLC tick out from its end, and a body grows from the open
 * towards the close; a body not started is left out of the batch.
 * Every wick paints under every body (candles don't overlap, so this
 * looks the same as painting them candle by candle).
 */

import type {
	CompositeContext,
	LineProps,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, line, rect } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Bounds, Point } from "@sophistry/core/geometry";
import { cssColor } from "@sophistry/core/internal";
import { bandSpan, positionOf } from "../band";
import type { BatchItem } from "../batch";
import { createBatchedMark } from "../batch";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, PositionValue } from "../data/channels";
import {
	dateSinkContext,
	numberValues,
	resolveChannel,
} from "../data/channels";
import { itemTooltipHandlers } from "../item-tooltip";
import type { AnyDatum } from "../props";
import { staggered } from "../stagger";
import type { TooltipField, TooltipSpec } from "../tooltip";
import { tooltipContext, tooltipText } from "../tooltip";
import { keyedMemo } from "../util";
import { tooltipProps } from "./shared";

const DEFAULT_BODY_WIDTH = 0.6;
const DEFAULT_TICK = 0.35;

/**
 * Props of {@link candlestick}.
 *
 * @category Charts
 */
export interface CandlestickProps<T = unknown> {
	/** One candle per datum: a period. */
	data: readonly T[];
	/**
	 * The period: a `Date`, Temporal value or epoch ms on a time axis, a number, or a category on a
	 * band axis.
	 */
	x: Channel<T, BandKey | PositionValue>;
	/** Price at the period's open. */
	open: Channel<T, number>;
	/** Highest price in the period. */
	high: Channel<T, number>;
	/** Lowest price in the period. */
	low: Channel<T, number>;
	/** Price at the period's close. */
	close: Channel<T, number>;
	/**
	 * Body width: a fraction of the band on a band axis, or of the smallest gap between periods on
	 * a continuous one.
	 * @default 0.6
	 */
	bodyWidth?: number;
	/**
	 * Draw OHLC bars (open tick left, close tick right) instead of candles.
	 * @default false
	 */
	ohlc?: boolean;
	/** Colour of a period that closed up. Defaults to the theme's positive colour. */
	upColor?: ColorInput;
	/** Colour of a period that closed down. Defaults to the theme's negative colour. */
	downColor?: ColorInput;
	/** Wick and OHLC line width. */
	strokeWidth?: number;
	/**
	 * Reveal, 0..1: each wick draws from low to high, then its body grows from open to close.
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering period after period in time order, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/**
	 * Hover tooltip: `true` for a row per channel (`x`, `open`, `high`, `low`, `close`), or a
	 * template, function or options. See {@link TooltipSpec}.
	 */
	tooltip?: TooltipSpec<T>;
	zIndex?: number;
	visible?: boolean;
}

/** One period's channels, as read. */
interface CandleRow {
	x: BandKey | undefined;
	open: number;
	high: number;
	low: number;
	close: number;
}

/** A line of a candle: its wick or an OHLC tick. */
interface CandleLine extends BatchItem {
	from: Point;
	to: Point;
	stroke: string;
	/** How far the line has traced from `from`, 0..1. */
	progress: number;
	index: number;
	/** Where the tooltip points. */
	at: Point;
}

/** A candle's body. */
interface CandleBody extends BatchItem {
	box: Bounds;
	fill: string;
	fillOpacity: number;
	index: number;
	at: Point;
}

/** What a candlestick keeps between updates. */
interface CandlestickState {
	layer: ChartLayer;
	rows: (deps: readonly unknown[], make: () => CandleRow[]) => CandleRow[];
	lines: ReturnType<
		typeof createBatchedMark<
			CandleLine,
			LineProps,
			SceneNode<LineProps>,
			keyof LineProps
		>
	>;
	bodies: ReturnType<
		typeof createBatchedMark<
			CandleBody,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
}

const states = new WeakMap<object, CandlestickState>();

function draw(ctx: CompositeContext<CandlestickProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as CandlestickState;
	const props = ctx.props as Readonly<CandlestickProps<unknown>>;
	const { layer } = state;
	const plot = layer.frame();
	const coords = layer.coords();
	if (!plot || !coords)
		throw new Error("Candlestick must be placed inside a chart.");
	const dates = ctx.context(dateSinkContext);
	const tooltip = ctx.context(tooltipContext);
	const theme = ctx.theme;

	const rows = state.rows(
		[
			props.data,
			props.x,
			props.open,
			props.high,
			props.low,
			props.close,
			dates,
		],
		() => {
			const x = resolveChannel<unknown, BandKey | PositionValue>(
				props.x,
				undefined,
				"x",
				dates,
			);
			const open = numberValues(props.data, props.open, undefined, "open");
			const high = numberValues(props.data, props.high, undefined, "high");
			const low = numberValues(props.data, props.low, undefined, "low");
			const close = numberValues(props.data, props.close, undefined, "close");
			return props.data.map((d, i) => ({
				x: x(d, i) as BandKey | undefined,
				open: open[i] as number,
				high: high[i] as number,
				low: low[i] as number,
				close: close[i] as number,
			}));
		},
	);
	const keys = rows.map((r) => r.x);
	const categories = keys.filter((k): k is string => typeof k === "string");
	layer.report({
		x:
			categories.length > 0
				? { categories }
				: { values: keys.filter((k): k is number => typeof k === "number") },
		y: { values: rows.flatMap((r) => [r.low, r.high]) },
	});

	const band = plot.xBand;
	/** Half the body width in data units along x. */
	const fraction = props.bodyWidth ?? DEFAULT_BODY_WIDTH;
	let halfWidth: number;
	if (band) halfWidth = (band.bandwidth * fraction) / 2;
	else {
		const xs = keys
			.filter((x): x is number => typeof x === "number")
			.sort((a, b) => a - b);
		let gap = Number.POSITIVE_INFINITY;
		for (let i = 1; i < xs.length; i++) {
			const a = xs[i - 1] as number;
			const b = xs[i] as number;
			if (b > a) gap = Math.min(gap, b - a);
		}
		if (!Number.isFinite(gap)) {
			const [lo, hi] = coords.xRange();
			gap = Math.abs(hi - lo) / 10 || 1;
		}
		halfWidth = (gap * fraction) / 2;
	}
	/** Time order, for the stagger: by x on a continuous axis, by slot on a band one. */
	const rank: number[] = [];
	rows
		.map((r, i) => ({
			i,
			at: band ? band.index(r.x as BandKey) : Number(r.x),
		}))
		.sort((a, b) => a.at - b.at)
		.forEach((entry, r) => {
			rank[entry.i] = r;
		});
	const progress = layer.progress(props.progress) ?? 1;
	const up = cssColor(props.upColor ?? theme.palette.positive);
	const down = cssColor(props.downColor ?? theme.palette.negative);
	const p = (x: number, y: number) => coords.coordsToPoint(x, y);

	const lines: CandleLine[] = [];
	const bodies: CandleBody[] = [];
	rows.forEach((r, index) => {
		const { open, high, low, close } = r;
		if (![open, high, low, close].every(Number.isFinite)) return;
		const centre = positionOf(band, r.x);
		if (centre === undefined) return;
		const span = bandSpan(band, r.x);
		const middle = span ? (span[0] + span[1]) / 2 : centre;
		const rising = close >= open;
		const t = staggered(
			progress,
			rank[index] ?? 0,
			rows.length,
			props.stagger ?? 0,
		);
		/** The wick takes the first half of a candle's reveal, the body the second. */
		const wick = Math.min(1, t * 2);
		const body = Math.max(0, t * 2 - 1);
		const color = rising ? up : down;
		const at = p(middle, high);
		if (wick > 0) {
			const from = p(middle, low);
			lines.push({
				key: `${index}:wick`,
				from,
				to: at,
				progress: wick,
				stroke: color,
				index,
				at,
			});
		}
		if (body <= 0) return;
		if (props.ohlc) {
			const openFrom = p(middle - halfWidth * DEFAULT_TICK * 2, open);
			const closeFrom = p(middle, close);
			lines.push(
				{
					key: `${index}:open`,
					from: openFrom,
					to: p(middle, open),
					progress: body,
					stroke: color,
					index,
					at,
				},
				{
					key: `${index}:close`,
					from: closeFrom,
					to: p(middle + halfWidth * DEFAULT_TICK * 2, close),
					progress: body,
					stroke: color,
					index,
					at,
				},
			);
			return;
		}
		/** Body edges, grown from the open towards the close. */
		const top = p(0, open + (close - open) * body).y;
		const bottom = p(0, open).y;
		const x = p(middle, 0).x;
		const width = Math.abs(
			p(middle + halfWidth, 0).x - p(middle - halfWidth, 0).x,
		);
		bodies.push({
			key: index,
			box: {
				minX: x - width / 2,
				maxX: x + width / 2,
				minY: Math.min(top, bottom),
				maxY: Math.max(top, bottom),
			},
			fill: color,
			fillOpacity: rising ? 0.35 : 0.9,
			index,
			at,
		});
	});

	const text = (index: number) => {
		const r = rows[index] as CandleRow;
		const price = plot.format("y");
		return tooltipText(
			props.tooltip,
			(): TooltipField[] => [
				{ channel: "x", of: props.x, value: r.x, format: plot.format("x") },
				{ channel: "open", of: props.open, value: r.open, format: price },
				{ channel: "high", of: props.high, value: r.high, format: price },
				{ channel: "low", of: props.low, value: r.low, format: price },
				{ channel: "close", of: props.close, value: r.close, format: price },
			],
			props.data[index],
			index,
			tooltip ?? undefined,
		);
	};
	const lineHandlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const own = state.lines.itemAt(item);
			return own ? text(own.index) : undefined;
		},
		(item) => state.lines.itemAt(item)?.at,
		() => "Candlestick",
	);
	const bodyHandlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const own = state.bodies.itemAt(item);
			return own ? text(own.index) : undefined;
		},
		(item) => state.bodies.itemAt(item)?.at,
		() => "Candlestick",
	);
	state.lines.update(lines, {
		strokeWidth: props.strokeWidth,
		zIndex: props.zIndex,
		visible: props.visible,
		...tooltipProps(tooltip, props.tooltip, lineHandlers),
	} as never);
	state.bodies.update(bodies, {
		strokeWidth: props.strokeWidth,
		zIndex: props.zIndex,
		visible: props.visible,
		...tooltipProps(tooltip, props.tooltip, bodyHandlers),
	} as never);
	return [state.lines.node, state.bodies.node];
}

/**
 * Candlesticks (or OHLC bars) for price data, inside a `chart` on a time
 * axis (`xAxis: { scale: "utc" }`) or a category axis. Wicks span low to
 * high, bodies open to close coloured by direction; the value axis fits the
 * prices without forcing zero.
 *
 * @example
 * ```ts
 * import { candlestick, chart } from "@sophistry/charts";
 *
 * const prices = [
 * 	{ day: new Date("2024-03-04"), o: 101, h: 106, l: 99, c: 104 },
 * 	{ day: new Date("2024-03-05"), o: 104, h: 105, l: 97, c: 98 },
 * 	{ day: new Date("2024-03-06"), o: 98, h: 103, l: 96, c: 102 },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	xAxis: { scale: "utc" },
 * 	children: [candlestick.create({ data: prices, x: "day", open: "o", high: "h", low: "l", close: "c" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#waterfalls-funnels-and-candlesticks
 * @category Charts
 */
export const candlestick = defineComposite<CandlestickProps<AnyDatum>>({
	name: "Candlestick",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		open: { invalidates: Invalidate.UPDATE },
		high: { invalidates: Invalidate.UPDATE },
		low: { invalidates: Invalidate.UPDATE },
		close: { invalidates: Invalidate.UPDATE },
		bodyWidth: { invalidates: Invalidate.UPDATE },
		ohlc: { invalidates: Invalidate.UPDATE },
		upColor: { invalidates: Invalidate.UPDATE },
		downColor: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			rows: keyedMemo<CandleRow[]>(),
			lines: createBatchedMark<
				CandleLine,
				LineProps,
				SceneNode<LineProps>,
				keyof LineProps
			>(line as never, {
				channels: {
					from: (item) => item.from,
					to: (item) => item.to,
					stroke: (item) => item.stroke,
					progress: (item) => item.progress,
				},
			}),
			bodies: createBatchedMark<
				CandleBody,
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
					fillOpacity: (item) => item.fillOpacity,
				},
			}),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
