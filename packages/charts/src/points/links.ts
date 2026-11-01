/**
 * `links` and `vectors`: straight segments between data points, optionally
 * arrowed. One instances node per layer: `line` items, or `arrow` items
 * (with a tip) for `arrow: true` and for every vector. Items are keyed by
 * datum index. The reveal is each item's
 * `progress` channel, tracing its outline.
 */

import type {
	ArrowProps,
	CompositeContext,
	LineProps,
	SceneNode,
} from "@sophistry/core";
import { arrow, defineComposite, Invalidate, line } from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { positionOf } from "../band.js";
import type { BatchedMark } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel, PositionValue } from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	numberValues,
	resolveChannel,
} from "../data/channels.js";
import type { ChartFrame } from "../frame/types.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { tooltipContext, tooltipText } from "../tooltip.js";
import { keyedMemo } from "../util.js";
import type { SegmentItem } from "./segment-marks.js";
import { createItemHandlers, stableShared, tooltipsOn } from "./shared.js";

const DEFAULT_TIP_LENGTH = 0.18;

/**
 * Everything {@link links} and {@link vectors} share.
 *
 * @category Charts
 */
export interface SegmentStyleProps<T> {
	/** Line colour, constant or `(d, i) => colour`. Defaults to the theme's first series colour. */
	color?: ColorChannel<T>;
	/** Line width. */
	strokeWidth?: number;
	opacity?: number;
	/**
	 * Arrow-tip length, when there is a tip.
	 * @default 0.18
	 */
	tipLength?: number;
	/**
	 * Reveal, 0..1: each segment draws from its start to its end.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering one segment after the next, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/** Hover tooltip: `true` for the segment's coordinates, or `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	zIndex?: number;
	visible?: boolean;
}

/**
 * Props of {@link links}.
 *
 * @category Charts
 */
export interface LinksProps<T = unknown> extends SegmentStyleProps<T> {
	/** One segment per datum. */
	data: readonly T[];
	/** Start x: a number in data units (a `Date` reads as epoch ms) or a category on a band axis. */
	x1: Channel<T, BandKey | PositionValue>;
	/** Start y: a number in data units or a category on a band axis. */
	y1: Channel<T, BandKey | PositionValue>;
	/** End x, as `x1`. */
	x2: Channel<T, BandKey | PositionValue>;
	/** End y, as `y1`. */
	y2: Channel<T, BandKey | PositionValue>;
	/**
	 * Draw an arrow tip at the end.
	 * @default false
	 */
	arrow?: boolean;
}

/**
 * Props of {@link vectors}.
 *
 * @category Charts
 */
export interface VectorsProps<T = unknown> extends SegmentStyleProps<T> {
	/** One arrow per datum. */
	data: readonly T[];
	/** Tail x, in data units (a `Date` reads as epoch ms). */
	x: Channel<T, PositionValue>;
	/** Tail y, in data units. */
	y: Channel<T, PositionValue>;
	/** X component, in data units (scaled by `scale`). */
	u: Channel<T, number>;
	/** Y component, in data units (scaled by `scale`). */
	v: Channel<T, number>;
	/**
	 * Multiplies every vector before drawing, to fit long ones in.
	 * @default 1
	 */
	scale?: number;
}

interface SegmentRow {
	x1: BandKey;
	y1: BandKey;
	x2: BandKey;
	y2: BandKey;
}

interface LinkItem extends SegmentItem {
	/** The full segment's end: where its tooltip points. */
	end: Point;
	index: number;
}

type LinkMark = BatchedMark<
	LinkItem,
	ArrowProps & LineProps,
	SceneNode<ArrowProps & LineProps>,
	keyof (ArrowProps & LineProps)
>;

interface LinksState {
	layer: ChartLayer;
	tooltip: TooltipState | null;
	arrowed: boolean | undefined;
	mark: LinkMark | undefined;
	rows: ReturnType<typeof keyedMemo<SegmentRow[]>>;
	shared: (next: Record<string, unknown>) => Record<string, unknown>;
	handlers: ReturnType<typeof createItemHandlers>;
	current: {
		props: SegmentStyleProps<AnyDatum> & { data: readonly unknown[] };
		frame: ChartFrame | null;
		rows: SegmentRow[];
	};
}

/** The layer's node, remade when it gains or loses its tips. */
function markFor(state: LinksState, arrowed: boolean): LinkMark {
	if (state.mark && state.arrowed === arrowed) return state.mark;
	state.arrowed = arrowed;
	state.mark = createBatchedMark(
		(arrowed ? arrow : line) as never,
		{
			channels: {
				from: (item: LinkItem) => item.from,
				to: (item: LinkItem) => item.to,
				stroke: (item: LinkItem) => item.stroke,
				progress: (item: LinkItem) => item.progress ?? 1,
			},
		} as never,
	) as LinkMark;
	return state.mark;
}

/** The shared body: each row's two ends, drawn as a segment. */
function drawSegments(
	ctx: CompositeContext<
		SegmentStyleProps<AnyDatum> & { data: readonly unknown[] }
	>,
	state: LinksState,
	rows: SegmentRow[],
	arrowed: boolean,
	name: string,
): SceneNode[] {
	const props = ctx.props;
	const { layer, tooltip } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error(`${name} must be placed inside a chart or axes.`);
	const theme = ctx.theme;
	state.current = { props, frame, rows };
	const extent = (keys: BandKey[]) => {
		const categories = keys.filter((k) => typeof k === "string");
		return categories.length > 0
			? { categories }
			: { values: keys.filter((k): k is number => typeof k === "number") };
	};
	layer.report({
		x: extent(rows.flatMap((r) => [r.x1, r.x2])),
		y: extent(rows.flatMap((r) => [r.y1, r.y2])),
	});
	const colorOf = colorResolver(
		props.color as ColorChannel<unknown>,
		theme.palette.series.slice(0, 1),
		theme.palette.foreground,
	);
	const pointOf = (x: BandKey, y: BandKey): Point | null => {
		const px = positionOf(frame?.xBand, x);
		const py = positionOf(frame?.yBand, y);
		return px === undefined || py === undefined
			? null
			: coords.coordsToPoint(px, py);
	};
	const progress = layer.progress(props.progress) ?? 1;
	const items: LinkItem[] = [];
	rows.forEach((row, index) => {
		const a = pointOf(row.x1, row.y1);
		const b = pointOf(row.x2, row.y2);
		if (!a || !b) return;
		const t = staggered(progress, index, rows.length, props.stagger ?? 0);
		if (!(t > 0)) return;
		items.push({
			key: index,
			from: a,
			to: b,
			progress: Math.min(1, t),
			end: b,
			stroke: colorOf(props.data[index], index),
			index,
		});
	});
	const mark = markFor(state, arrowed);
	mark.update(
		items,
		state.shared({
			strokeWidth: props.strokeWidth,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
			...(arrowed ? { tipLength: props.tipLength ?? DEFAULT_TIP_LENGTH } : {}),
			...state.handlers(
				tooltipsOn(tooltip, props.tooltip),
				`${name}, ${items.length} segments`,
			),
		}) as never,
	);
	return [mark.node];
}

/** A segment's tooltip: its two ends, as the axes write them. */
function tipText(state: LinksState, index: number) {
	const { props, frame, rows } = state.current;
	const row = rows[index];
	return tooltipText(
		props.tooltip,
		() => {
			if (!row) return "";
			const n = (axis: "x" | "y", v: BandKey | undefined) =>
				v === undefined
					? String(v)
					: (
							frame?.format(axis) ??
							((u: BandKey) =>
								typeof u === "number" ? formatTick(u) : String(u))
						)(v);
			return `(${n("x", row.x1)}, ${n("y", row.y1)}) → (${n("x", row.x2)}, ${n("y", row.y2)})`;
		},
		props.data[index],
		index,
		state.tooltip ?? undefined,
	);
}

const styleProps = {
	data: { default: [], invalidates: Invalidate.UPDATE },
	color: { invalidates: Invalidate.UPDATE },
	strokeWidth: { invalidates: Invalidate.UPDATE },
	opacity: { invalidates: Invalidate.UPDATE },
	tipLength: { invalidates: Invalidate.UPDATE },
	progress: { default: 1, invalidates: Invalidate.UPDATE },
	stagger: { invalidates: Invalidate.UPDATE },
	tooltip: { invalidates: Invalidate.UPDATE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
} as const;

function newState(
	ctx: CompositeContext<
		SegmentStyleProps<AnyDatum> & { data: readonly unknown[] }
	>,
): LinksState {
	const tooltip = ctx.context(tooltipContext);
	const state: LinksState = {
		layer: chartLayer(ctx),
		tooltip,
		arrowed: undefined,
		mark: undefined,
		rows: keyedMemo(),
		shared: stableShared(),
		handlers: () => ({}),
		current: { props: ctx.props, frame: null, rows: [] },
	};
	state.handlers = createItemHandlers(
		tooltip,
		(item) => {
			const own = state.mark?.itemAt(item);
			return own ? tipText(state, own.index) : undefined;
		},
		(item) => state.mark?.itemAt(item)?.end,
	);
	return state;
}

const linkStates = new WeakMap<object, LinksState>();
function drawLinks(ctx: CompositeContext<LinksProps<AnyDatum>>) {
	const state = linkStates.get(ctx.node) as LinksState;
	const props = ctx.props;
	const dates = ctx.context(dateSinkContext);
	const rows = state.rows(
		[props.data, props.x1, props.y1, props.x2, props.y2, dates],
		() => {
			const read = (channel: unknown, name: string) =>
				resolveChannel<unknown, BandKey | PositionValue>(
					channel as Channel<unknown, BandKey | PositionValue>,
					undefined,
					name,
					dates,
				);
			const [x1, y1, x2, y2] = [
				read(props.x1, "x1"),
				read(props.y1, "y1"),
				read(props.x2, "x2"),
				read(props.y2, "y2"),
			];
			return props.data.map((d, i) => ({
				x1: x1(d, i) as BandKey,
				y1: y1(d, i) as BandKey,
				x2: x2(d, i) as BandKey,
				y2: y2(d, i) as BandKey,
			}));
		},
	);
	return drawSegments(ctx as never, state, rows, props.arrow === true, "Links");
}

const vectorStates = new WeakMap<object, LinksState>();
function drawVectors(ctx: CompositeContext<VectorsProps<AnyDatum>>) {
	const state = vectorStates.get(ctx.node) as LinksState;
	const props = ctx.props;
	const dates = ctx.context(dateSinkContext);
	const rows = state.rows(
		[props.data, props.x, props.y, props.u, props.v, props.scale, dates],
		() => {
			const scale = props.scale ?? 1;
			const values = (channel: unknown, name: string) =>
				numberValues(
					props.data,
					channel as Channel<unknown, number>,
					undefined,
					name,
					dates,
				);
			const xs = values(props.x, "x");
			const ys = values(props.y, "y");
			const us = values(props.u, "u");
			const vs = values(props.v, "v");
			return props.data.map((_, i) => ({
				x1: xs[i] as number,
				y1: ys[i] as number,
				x2: (xs[i] as number) + (us[i] as number) * scale,
				y2: (ys[i] as number) + (vs[i] as number) * scale,
			}));
		},
	);
	return drawSegments(ctx as never, state, rows, true, "Vectors");
}

/**
 * Straight segments from `(x1, y1)` to `(x2, y2)`, optionally arrowed: before/after pairs,
 * dumbbells, migrations. Each draws in the direction of change. One instances node.
 *
 * @example
 * ```ts
 * import { chart, links } from "@sophistry/charts";
 *
 * const moves = [
 * 	{ from: 0, a: 1, to: 2, b: 3 },
 * 	{ from: 1, a: 3, to: 3, b: 0 },
 * ];
 * chart.create({ width: 8, height: 4, children: [links.create({ data: moves, x1: "from", y1: "a", x2: "to", y2: "b", arrow: true })] });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#marks
 * @category Charts
 */
export const links = defineComposite<LinksProps<AnyDatum>>({
	name: "Links",
	props: {
		...styleProps,
		x1: { invalidates: Invalidate.UPDATE },
		y1: { invalidates: Invalidate.UPDATE },
		x2: { invalidates: Invalidate.UPDATE },
		y2: { invalidates: Invalidate.UPDATE },
		arrow: { invalidates: Invalidate.UPDATE },
	} as never,
	setup: (ctx) => {
		linkStates.set(ctx.node, newState(ctx as never));
		return drawLinks(ctx);
	},
	update: (_changed, ctx) => drawLinks(ctx),
});

/**
 * Arrows from `(x, y)` along `(u, v)`, a quiver plot for data you already have (for a sampled
 * function, use `vectorField`). Each grows from its tail. One instances node.
 *
 * @example
 * ```ts
 * import { chart, vectors } from "@sophistry/charts";
 *
 * const wind = [
 * 	{ x: 0, y: 0, u: 1, v: 0.5 },
 * 	{ x: 1, y: 0, u: 0.8, v: 1 },
 * ];
 * chart.create({ width: 8, height: 4, children: [vectors.create({ data: wind, x: "x", y: "y", u: "u", v: "v", scale: 0.5 })] });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#marks
 * @category Charts
 */
export const vectors = defineComposite<VectorsProps<AnyDatum>>({
	name: "Vectors",
	props: {
		...styleProps,
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		u: { invalidates: Invalidate.UPDATE },
		v: { invalidates: Invalidate.UPDATE },
		scale: { invalidates: Invalidate.UPDATE },
	} as never,
	setup: (ctx) => {
		vectorStates.set(ctx.node, newState(ctx as never));
		return drawVectors(ctx);
	},
	update: (_changed, ctx) => drawVectors(ctx),
});
