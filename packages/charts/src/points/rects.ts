/**
 * `rects`: rectangles in data space from `x1`/`x2`/`y1`/`y2`; a pair left
 * out spans the plot that way. One `rect` instances node per layer.
 *
 * Each rectangle reveals by tracing its outline while its
 * fill comes up (the item's `progress` channel: its reveal and presence).
 */

import type {
	CompositeContext,
	CoordinateSystem,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, rect } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Bounds, Point } from "@sophistry/core/geometry";
import type { MarkTransition } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel, PositionValue } from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	resolveChannel,
} from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { ChartFrame } from "../frame/types.js";
import type { JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrames,
	keyRanks,
	layerTransition,
} from "../join.js";
import { blendCss, mixBounds } from "../mix.js";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { tooltipContext, tooltipText } from "../tooltip.js";
import { keyedMemo, mix } from "../util.js";
import { createItemHandlers, stableShared, tooltipsOn } from "./shared.js";

const DEFAULT_FILL_OPACITY = 0.35;

/**
 * Props of {@link rects}.
 *
 * @category Charts
 */
export interface RectsProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One rectangle per datum. */
	data: readonly T[];
	/** Left edge, in data units (a `Date` reads as epoch ms). With `x2` also omitted, the rectangle spans the plot's full width. */
	x1?: Channel<T, PositionValue>;
	/** Right edge, in data units. */
	x2?: Channel<T, PositionValue>;
	/** Bottom edge, in data units. With `y2` also omitted, the rectangle spans the plot's full height. */
	y1?: Channel<T, PositionValue>;
	/** Top edge, in data units. */
	y2?: Channel<T, PositionValue>;
	/** Fill, constant or `(d, i) => colour`. Wins over `colors`. */
	color?: ColorChannel<T>;
	/** Colours cycled across the rectangles by index. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity, 0..1.
	 * @default 0.35
	 */
	fillOpacity?: number;
	/**
	 * Outline colour.
	 * @default "none"
	 */
	stroke?: ColorInput;
	strokeWidth?: number;
	opacity?: number;
	/**
	 * Reveal, 0..1: each rectangle traces its outline as its fill comes up.
	 * @default 1
	 */
	progress?: number;
	/** Hover tooltip: `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	/** How rectangles move when `data` changes outside a `to` blend; see {@link MarkTransition}. */
	transition?: MarkTransition;
	/**
	 * Paint order; higher draws later. Behind the data by default.
	 * @default -1
	 */
	zIndex?: number;
	visible?: boolean;
}

/** A rectangle's edges in data units; a pair left out spans the plot that way. */
interface RectEdges {
	x1?: number;
	x2?: number;
	y1?: number;
	y2?: number;
}

/** A rectangle on one frame: its edges and its fill. */
interface RectState extends RectEdges {
	fill: string;
}

interface RectItem {
	key: BandKey;
	center: Point;
	width: number;
	height: number;
	fill: string;
	/** The reveal and the join's presence together, 0..1. */
	progress: number;
	top: Point;
	frame: JoinFrame<RectState>;
}

interface RectsState {
	layer: ChartLayer;
	tooltip: TooltipState | null;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	boxes: ReturnType<
		typeof createBatchedMark<
			RectItem,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
	rows: {
		from: ReturnType<typeof keyedMemo<RectEdges[]>>;
		to: ReturnType<typeof keyedMemo<RectEdges[]>>;
	};
	shared: (next: Record<string, unknown>) => Record<string, unknown>;
	handlers: ReturnType<typeof createItemHandlers>;
	current: { props: RectsProps<AnyDatum>; frame: ChartFrame | null };
}

const states = new WeakMap<object, RectsState>();

/** A rectangle's box in scene units, through `coords`; an omitted pair spans the area. */
function boxFor(row: RectEdges, coords: CoordinateSystem): Bounds | null {
	const area = coords.area();
	const xs =
		row.x1 === undefined && row.x2 === undefined
			? [area.minX, area.maxX]
			: [row.x1 ?? row.x2, row.x2 ?? row.x1].map(
					(x) => coords.coordsToPoint(x as number, 0).x,
				);
	const ys =
		row.y1 === undefined && row.y2 === undefined
			? [area.minY, area.maxY]
			: [row.y1 ?? row.y2, row.y2 ?? row.y1].map(
					(y) => coords.coordsToPoint(0, y as number).y,
				);
	if (![...xs, ...ys].every(Number.isFinite)) return null;
	const [x0, x1] = xs as [number, number];
	const [y0, y1] = ys as [number, number];
	return {
		minX: Math.min(x0, x1),
		maxX: Math.max(x0, x1),
		minY: Math.min(y0, y1),
		maxY: Math.max(y0, y1),
	};
}

function draw(ctx: CompositeContext<RectsProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as RectsState;
	const props = ctx.props;
	const { layer, tooltip } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) throw new Error("Rects must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	state.current = { props, frame };

	const rowsOf = (data: readonly unknown[], end: "from" | "to") =>
		state.rows[end](
			[data, props.x1, props.x2, props.y1, props.y2, dates],
			() => {
				const read = (
					channel: Channel<unknown, PositionValue> | undefined,
					name: string,
				) => resolveChannel(channel, undefined, name, dates);
				const [x1, x2, y1, y2] = [
					read(props.x1 as Channel<unknown, PositionValue> | undefined, "x1"),
					read(props.x2 as Channel<unknown, PositionValue> | undefined, "x2"),
					read(props.y1 as Channel<unknown, PositionValue> | undefined, "y1"),
					read(props.y2 as Channel<unknown, PositionValue> | undefined, "y2"),
				];
				return data.map((d, i) => ({
					x1: x1?.(d, i) as number | undefined,
					x2: x2?.(d, i) as number | undefined,
					y1: y1?.(d, i) as number | undefined,
					y2: y2?.(d, i) as number | undefined,
				}));
			},
		);
	const fromRows = rowsOf(props.data, "from");
	const toRows = props.to ? rowsOf(props.to, "to") : undefined;
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
	const extentsOf = (rows: readonly RectEdges[]) => {
		const numbers = (values: (number | undefined)[]) =>
			values.filter((v): v is number => typeof v === "number");
		return {
			x: { values: numbers(rows.flatMap((r) => [r.x1, r.x2])) },
			y: { values: numbers(rows.flatMap((r) => [r.y1, r.y2])) },
		};
	};
	layer.report({
		...extentsOf(fromRows),
		transition: layerTransition(
			keyed,
			props.staging,
			toRows ? extentsOf(toRows) : {},
		),
	});

	const fillOf = colorResolver(
		props.color as ColorChannel<unknown>,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	/** The plotting area's corners in data units: where an edge left out stands. */
	const area = coords.area();
	const lo = coords.pointToCoords({ x: area.minX, y: area.minY });
	const hi = coords.pointToCoords({ x: area.maxX, y: area.maxY });
	const sides = { x1: lo.x, x2: hi.x, y1: lo.y, y2: hi.y };
	/**
	 * Two rectangles blended at `u`, edge by edge in data units; a pair left out at one end blends
	 * from or to the plot's sides.
	 */
	const blendRect = (a: RectState, b: RectState, u: number): RectState => {
		const pair = (p: "x" | "y") => {
			const [l, h] =
				p === "x" ? (["x1", "x2"] as const) : (["y1", "y2"] as const);
			const aOut = a[l] === undefined && a[h] === undefined;
			const bOut = b[l] === undefined && b[h] === undefined;
			if (aOut && bOut) return { [l]: undefined, [h]: undefined };
			const at = (r: RectState, k: typeof l | typeof h, out: boolean) =>
				out ? sides[k] : (r[k] ?? (r[k === l ? h : l] as number));
			return {
				[l]: mix(at(a, l, aOut), at(b, l, bOut), u),
				[h]: mix(at(a, h, aOut), at(b, h, bOut), u),
			};
		};
		return {
			...(pair("x") as RectEdges),
			...(pair("y") as RectEdges),
			fill: a.fill === b.fill ? a.fill : blendCss(a.fill, b.fill, u),
		};
	};
	const space = endSpace(frame, coords);
	const frames = joinFrames<RectState>(
		keyed,
		(end, index) => {
			const row = (end === "from" ? fromRows : toRows)?.[index];
			const data = end === "from" ? props.data : props.to;
			if (!row || !data) return undefined;
			return { ...row, fill: fillOf(data[index], index) };
		},
		blendRect,
		space.swapping,
	);
	const rank = keyRanks(keyed.keys);
	const count = keyed.active ? keyed.keys.length : props.data.length;
	const progress = layer.progress(props.progress) ?? 1;
	const items: RectItem[] = [];
	for (const key of keyed.keys) {
		const own = frames.get(key);
		if (!own || !(own.presence > 0)) continue;
		const box = space.shape(
			own,
			(edges, _end, system) => boxFor(edges, system),
			mixBounds,
		);
		if (!box) continue;
		const t =
			staggered(progress, rank.get(key) ?? 0, count, props.stagger ?? 0) *
			own.presence;
		if (!(t > 0)) continue;
		items.push({
			key,
			center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
			width: box.maxX - box.minX,
			height: box.maxY - box.minY,
			fill: own.state.fill,
			progress: Math.min(1, t),
			top: { x: (box.minX + box.maxX) / 2, y: box.maxY },
			frame: own,
		});
	}
	state.boxes.update(
		items,
		state.shared({
			fillOpacity: props.fillOpacity ?? DEFAULT_FILL_OPACITY,
			stroke: props.stroke ?? "none",
			strokeWidth: props.strokeWidth,
			opacity: props.opacity,
			zIndex: props.zIndex ?? -1,
			visible: props.visible,
			...state.handlers(
				tooltipsOn(tooltip, props.tooltip),
				`Rects, ${items.length} rectangles`,
			),
		}) as never,
		{ transition: props.transition, animate: !keyed.active && progress >= 1 },
	);
	return [state.boxes.node];
}

/**
 * Rectangles in data space from `x1`/`x2`/`y1`/`y2`. Leave out a pair and the rectangle spans
 * the plot that way: a vertical or horizontal span (shaded recessions, a target band); with all
 * four, a floating box. Drawn behind the data by default. One instances node.
 *
 * @example
 * ```ts
 * import { chart, rects } from "@sophistry/charts";
 *
 * const recessions = [
 * 	{ start: 2001.2, end: 2001.9 },
 * 	{ start: 2008, end: 2009.5 },
 * ];
 * chart.create({ width: 8, height: 4, children: [rects.create({ data: recessions, x1: "start", x2: "end" })] });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#marks
 * @category Charts
 */
export const rects = defineComposite<RectsProps<AnyDatum>>({
	name: "Rects",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x1: { invalidates: Invalidate.UPDATE },
		x2: { invalidates: Invalidate.UPDATE },
		y1: { invalidates: Invalidate.UPDATE },
		y2: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
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
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const tooltip = ctx.context(tooltipContext);
		const state: RectsState = {
			layer,
			tooltip,
			keyed: createKeyedData<AnyDatum>(),
			boxes: createBatchedMark<
				RectItem,
				RectProps,
				SceneNode<RectProps>,
				keyof RectProps
			>(rect as never, {
				channels: {
					center: (item) => item.center,
					width: (item) => item.width,
					height: (item) => item.height,
					fill: (item) => item.fill,
					progress: (item) => item.progress,
				},
				// An entering rectangle draws in; a leaving one undraws where it stands.
				enter: { progress: 0 },
				exit: { progress: 0 },
			}),
			rows: { from: keyedMemo(), to: keyedMemo() },
			shared: stableShared(),
			handlers: () => ({}),
			current: { props: ctx.props, frame: null },
		};
		state.handlers = createItemHandlers(
			tooltip,
			(item) => {
				const own = state.boxes.itemAt(item);
				if (!own) return undefined;
				const { props } = state.current;
				const data = own.frame.end === "to" ? props.to : props.data;
				return (
					tooltipText(
						props.tooltip,
						() => "",
						data?.[own.frame.index],
						own.frame.index,
						state.tooltip ?? undefined,
					) || undefined
				);
			},
			(item) => state.boxes.itemAt(item)?.top,
		);
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
