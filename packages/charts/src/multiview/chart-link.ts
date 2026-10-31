/**
 * Linked frames: `chartLink` shares scales between `chart`s, and
 * `rangeBrush` is the interaction that drives a linked range. Both are
 * driven by tracks, so they scrub and seek.
 */

import type {
	CompositeContext,
	ContextKey,
	SceneNode,
	SceneNodeWheelEvent,
} from "@sophistry/core";
import {
	createContextKey,
	defineComposite,
	Invalidate,
	rect,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type {
	BandKey,
	BandScale,
	Range,
	RangeTransition,
} from "@sophistry/core/geometry";
import { chartContext } from "../context";
import type { ChartColorOptions, ChartFrame } from "../frame/types";
import type { BrushAxis, BrushCell } from "./brush";
import { boxBrushDrags, brushDrags, brushWheel } from "./brush";
import type { ChartGroup } from "./chart-group";
import { chartGroupContext, createChartGroup } from "./chart-group";

/**
 * Props for {@link chartLink}.
 *
 * @category Charts
 */
export interface ChartLinkProps {
	/**
	 * Share the x axis: every member fits x to the union of all members' layers.
	 * @default true
	 */
	x?: boolean;
	/**
	 * Share the y axis the same way.
	 * @default false
	 */
	y?: boolean;
	/**
	 * A range every member sharing x takes (unless it gives its own `xRange`): one value to zoom
	 * them all. Omitted, the shared fit.
	 */
	xRange?: Range | RangeTransition;
	/** A range every member sharing y takes; see `xRange`. */
	yRange?: Range | RangeTransition;
	/** The members' one colour scale: order, colours and legend names. */
	color?: ChartColorOptions;
	/** The `chart`s to link, anywhere inside. */
	children?: readonly SceneNode[];
}

const linkGroups = new WeakMap<object, ChartGroup>();

function linkOptions(ctx: CompositeContext<ChartLinkProps>) {
	const props = ctx.props;
	linkGroups.get(ctx.node)?.setOptions({
		color: props.color,
		xRange: props.xRange,
		yRange: props.yRange,
		palette: ctx.theme.palette.series,
	});
}

/**
 * Links the `chart`s inside it: one shared colour scale, and the axes chosen by `x`/`y`
 * fitted to the union of every member's data (or all set to `xRange`/`yRange`). A member with
 * its own `xRange` keeps it, so an overview with a {@link rangeBrush} can drive linked detail
 * views. Each member draws its own legend; set `legend: false` on all but one. Which axes are
 * shared (`x`, `y`) is read once, at creation.
 *
 * @example
 * ```ts
 * import { derive, track } from "@sophistry/core";
 * import { chart, chartLink, linePlot } from "@sophistry/charts";
 *
 * const data = [3, 1, 4, 1, 5, 9, 2, 6];
 * const from = track(2);
 * const to = track(5);
 * chartLink.create({
 * 	xRange: derive([from, to], (a, b) => [a, b]),
 * 	children: [chart.create({ width: 8, height: 3, children: [linePlot.create({ data })] })],
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#multiple-views
 * @category Charts
 */
export const chartLink = defineComposite<ChartLinkProps>({
	name: "ChartLink",
	props: {
		x: { invalidates: Invalidate.NONE },
		y: { invalidates: Invalidate.NONE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const group = createChartGroup();
		linkGroups.set(ctx.node, group);
		linkOptions(ctx);
		ctx.provide(chartGroupContext, {
			group,
			keys: {
				x: ctx.props.x === false ? undefined : "x",
				y: ctx.props.y ? "y" : undefined,
			},
		});
		return ctx.children;
	},
	update: (changed, ctx) => {
		linkOptions(ctx);
		return changed.has("children") ? ctx.children : undefined;
	},
});

/**
 * A per-axis option of {@link rangeBrush}: one value for every brushed axis, or one per axis.
 *
 * @category Charts
 */
export type BrushAxisOption<V> = V | { x?: V; y?: V };

/**
 * Props for {@link rangeBrush}.
 *
 * @category Charts
 */
export interface RangeBrushProps {
	/** The selection's low end, in data units, read and written while dragging. Use with `axis`. */
	from?: BrushCell;
	/** The selection's high end, in data units. */
	to?: BrushCell;
	/**
	 * The axis `from`/`to` run along.
	 * @default "x"
	 */
	axis?: "x" | "y";
	/** The x selection's two ends, `[from, to]`; with `y` too, a box brush. */
	x?: readonly [BrushCell, BrushCell];
	/** The y selection's two ends; with `x`, a box brush. */
	y?: readonly [BrushCell, BrushCell];
	/**
	 * Where the ends may go, in data units: `[min, max]`, or per axis. Defaults to the frame's
	 * range on each axis.
	 */
	bounds?: BrushAxisOption<readonly [number, number]>;
	/**
	 * The narrowest selection an edge drag can make, in data units (or per axis). Defaults to 0
	 * (one category on a band axis).
	 */
	minSpan?: BrushAxisOption<number>;
	/**
	 * On a band axis, keep the ends on whole categories (the tracks hold slot edges, `0`..`n`).
	 * Read the selection with {@link brushedCategories}. Defaults to true on a band axis.
	 */
	snap?: boolean;
	/** Fill and edge colour. Defaults to the theme's first series colour. */
	color?: ColorInput;
	/**
	 * Opacity of the selection's fill.
	 * @default 0.18
	 */
	fillOpacity?: number;
	/**
	 * Draw a draggable edge at each end (and corners on a box brush).
	 * @default true
	 */
	handles?: boolean;
	/** Read-only: draw the selection but take no input. */
	disabled?: boolean;
	/**
	 * Let the wheel over the brush grow or shrink it about the cursor, within `bounds` and
	 * `minSpan`.
	 * @default false
	 */
	wheel?: boolean;
	/**
	 * Multiplies the wheel's resize.
	 * @default 1
	 */
	wheelSpeed?: number;
	/**
	 * Accessible name of the selection; its edges add `"start"`/`"end"`.
	 * @default "selected range"
	 */
	label?: string;
	/**
	 * Reveal, 0..1: fades in with the frame's data.
	 * @default 1
	 */
	progress?: number;
	zIndex?: number;
	visible?: boolean;
}

const HANDLE_WIDTH = 0.07;
/** A box brush's corner handles: squares this many edge widths across. */
const CORNER_SCALE = 2.4;

/** A per-axis option's value for one axis. Internal. */
export function brushAxisOption<V>(
	option: BrushAxisOption<V> | undefined,
	axis: "x" | "y",
	isValue: (option: BrushAxisOption<V>) => option is V,
): V | undefined {
	if (option === undefined) return undefined;
	return isValue(option) ? option : option[axis];
}
export const isPair = (
	option: BrushAxisOption<readonly [number, number]>,
): option is readonly [number, number] => Array.isArray(option);
export const isNumber = (option: BrushAxisOption<number>): option is number =>
	typeof option === "number";

/**
 * The categories a band brush's selection covers: those whose slot's middle lies between
 * `from` and `to`. Pass the axis's {@link BandScale} (`chartHandle(node).xBand`) or the
 * categories in axis order.
 *
 * @category Charts
 */
export function brushedCategories<K extends BandKey>(
	categories: readonly K[] | BandScale<K>,
	from: number,
	to: number,
): K[] {
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	const inside = (slot: number) =>
		slot >= 0 && slot + 0.5 >= lo && slot + 0.5 <= hi;
	if (isBandScale(categories))
		return categories.domain.filter((key) => inside(categories.index(key)));
	return categories.filter((_, index) => inside(index));
}

function isBandScale<K extends BandKey>(
	value: readonly K[] | BandScale<K>,
): value is BandScale<K> {
	return !Array.isArray(value);
}

/** The reason a brush cell's write reruns the brush's update. */
const CELLS: ContextKey<unknown> = createContextKey("brushCells");

/** What a brush keeps between updates. */
interface BrushState {
	frame: ChartFrame;
	cells: {
		x: readonly [BrushCell, BrushCell] | undefined;
		y: readonly [BrushCell, BrushCell] | undefined;
	};
	body: SceneNode;
	/** The edge handles, in draw order. */
	edges: SceneNode[];
	corners: SceneNode[];
	/** Places every part from the frame and the cells. */
	place(): void;
}

const brushStates = new WeakMap<object, BrushState>();

/**
 * Throws unless the node is inside a chart, and returns its frame.
 * @internal
 */
export function requireFrame(
	frame: ChartFrame | null,
	name: string,
): ChartFrame {
	if (!frame) throw new Error(`${name} must be placed inside a chart.`);
	return frame;
}

function setupBrush(ctx: CompositeContext<RangeBrushProps>): SceneNode[] {
	const props = ctx.props;
	const frame = requireFrame(ctx.context(chartContext), "rangeBrush");
	// Which axes are brushed is the brush's structure: read once.
	const single =
		props.from && props.to ? ([props.from, props.to] as const) : undefined;
	const cellsX = props.x ?? (props.axis !== "y" ? single : undefined);
	const cellsY = props.y ?? (props.axis === "y" ? single : undefined);
	if (!cellsX && !cellsY)
		throw new Error(
			"rangeBrush needs `from` and `to`, or `x` and/or `y` pairs.",
		);
	for (const cell of [...(cellsX ?? []), ...(cellsY ?? [])]) {
		const stop = cell.subscribe(() => ctx.invalidate(CELLS));
		ctx.onDispose(stop);
	}
	const coords = () => state.frame.coords;
	const axisOf = (
		axis: "x" | "y",
		pair: readonly [BrushCell, BrushCell],
	): BrushAxis => ({
		axis,
		from: pair[0],
		to: pair[1],
		bounds: () => brushAxisOption(ctx.props.bounds, axis, isPair),
		minSpan: () => brushAxisOption(ctx.props.minSpan, axis, isNumber),
		snap: () =>
			ctx.props.snap !== false &&
			(axis === "x" ? state.frame.xBand : state.frame.yBand) !== undefined,
	});
	const disabled = () => ctx.props.disabled ?? false;
	const resize = brushWheel({
		coords,
		axes: [
			...(cellsX ? [axisOf("x", cellsX)] : []),
			...(cellsY ? [axisOf("y", cellsY)] : []),
		],
		speed: () => ctx.props.wheelSpeed ?? 1,
	});
	const onWheel = (event: SceneNodeWheelEvent) => !disabled() && resize(event);
	const label = () => ctx.props.label ?? "selected range";
	/** What every part of the brush is drawn with. */
	const common = () => ({
		fill: ctx.props.color ?? ctx.theme.palette.series[0],
		stroke: "none",
		opacity: (ctx.props.progress ?? 1) * state.frame.dataProgress,
		zIndex: ctx.props.zIndex,
		visible: ctx.props.visible,
		onWheel: ctx.props.wheel ? onWheel : undefined,
	});

	let state: BrushState;
	if (cellsX && cellsY) {
		const gestures = boxBrushDrags({
			coords,
			x: axisOf("x", cellsX),
			y: axisOf("y", cellsY),
			disabled,
		});
		const corner = HANDLE_WIDTH * CORNER_SCALE;
		const body = rect.create({ ...gestures.body } as never);
		const edges = (["from", "to"] as const).flatMap((end) => [
			rect.create({ ...gestures.x[end] } as never),
			rect.create({ ...gestures.y[end] } as never),
		]);
		const corners = gestures.corners.map((handle) =>
			rect.create({
				...handle.drag,
				// Pointer only: the edges carry the same moves for the keyboard.
				focusable: false,
			} as never),
		);
		state = {
			frame,
			cells: { x: cellsX, y: cellsY },
			body,
			edges,
			corners,
			place() {
				const c = coords();
				const a = c.coordsToPoint(cellsX[0].peek(), cellsY[0].peek());
				const b = c.coordsToPoint(cellsX[1].peek(), cellsY[1].peek());
				const box = {
					cx: (a.x + b.x) / 2,
					cy: (a.y + b.y) / 2,
					width: Math.abs(b.x - a.x),
					height: Math.abs(b.y - a.y),
				};
				const shared = common();
				body.update({
					center: { x: box.cx, y: box.cy },
					width: box.width,
					height: box.height,
					...shared,
					fillOpacity: ctx.props.fillOpacity ?? 0.18,
					label: label(),
				} as never);
				const ends = [
					["from", a],
					["to", b],
				] as const;
				ends.forEach(([end, at], i) => {
					const name = end === "from" ? "start" : "end";
					edges[2 * i]?.update({
						center: { x: at.x, y: box.cy },
						width: HANDLE_WIDTH,
						height: box.height,
						...shared,
						label: `${label()} x ${name}`,
					} as never);
					edges[2 * i + 1]?.update({
						center: { x: box.cx, y: at.y },
						width: box.width,
						height: HANDLE_WIDTH,
						...shared,
						label: `${label()} y ${name}`,
					} as never);
				});
				gestures.corners.forEach((handle, i) => {
					const x = handle.x === "a" ? a.x : b.x;
					const y = handle.y === "a" ? a.y : b.y;
					corners[i]?.update({
						center: { x, y },
						width: corner,
						height: corner,
						...shared,
					} as never);
				});
			},
		};
	} else {
		const along = (cellsX ? "x" : "y") as "x" | "y";
		const pair = (cellsX ?? cellsY) as readonly [BrushCell, BrushCell];
		const vertical = () => along === "y";
		const axis = axisOf(along, pair);
		const { pointAt, drag } = brushDrags({
			coords,
			from: pair[0],
			to: pair[1],
			vertical,
			bounds: axis.bounds,
			minSpan: axis.minSpan,
			snap: axis.snap,
			disabled,
		});
		const body = rect.create({ ...drag.body } as never);
		const edges = [
			rect.create({ ...drag.from } as never),
			rect.create({ ...drag.to } as never),
		];
		state = {
			frame,
			cells: { x: cellsX, y: cellsY },
			body,
			edges,
			corners: [],
			place() {
				const area = coords().area();
				const a = pointAt(pair[0].peek());
				const b = pointAt(pair[1].peek());
				const box = vertical()
					? {
							cx: (area.minX + area.maxX) / 2,
							cy: (a.y + b.y) / 2,
							width: area.maxX - area.minX,
							height: Math.abs(b.y - a.y),
							a: a.y,
							b: b.y,
						}
					: {
							cx: (a.x + b.x) / 2,
							cy: (area.minY + area.maxY) / 2,
							width: Math.abs(b.x - a.x),
							height: area.maxY - area.minY,
							a: a.x,
							b: b.x,
						};
				const shared = common();
				body.update({
					center: { x: box.cx, y: box.cy },
					width: box.width,
					height: box.height,
					...shared,
					fillOpacity: ctx.props.fillOpacity ?? 0.18,
					label: label(),
				} as never);
				/** An end's draggable edge: a thin bar across the plot at `at`. */
				const edge = (node: SceneNode | undefined, at: number, end: string) =>
					node?.update({
						center: vertical() ? { x: box.cx, y: at } : { x: at, y: box.cy },
						width: vertical() ? box.width : HANDLE_WIDTH,
						height: vertical() ? HANDLE_WIDTH : box.height,
						...shared,
						label: `${label()} ${end}`,
					} as never);
				edge(edges[0], box.a, "start");
				edge(edges[1], box.b, "end");
			},
		};
	}
	brushStates.set(ctx.node, state);
	state.place();
	return brushChildren(ctx, state);
}

function brushChildren(
	ctx: CompositeContext<RangeBrushProps>,
	state: BrushState,
): SceneNode[] {
	return ctx.props.handles === false
		? [state.body]
		: [state.body, ...state.edges, ...state.corners];
}

/**
 * A draggable selection on a `chart`: a band between `from` and `to` on one axis, or a
 * box with `x` and `y`. It holds no state of its own: the tracks are the state, so any chart
 * reading them (`xRange: derive([from, to], (a, b) => [a, b])`) is linked. Drag the body to
 * move, an edge or corner to resize; the body and edges are also keyboard-focusable (arrows,
 * Shift for fine steps, Escape cancels a drag). Which tracks it brushes is read once, at
 * creation.
 *
 * @example
 * ```ts
 * import { track } from "@sophistry/core";
 * import { chart, linePlot, rangeBrush } from "@sophistry/charts";
 *
 * const data = [3, 1, 4, 1, 5, 9, 2, 6];
 * const from = track(2);
 * const to = track(4);
 * chart.create({
 * 	width: 8,
 * 	height: 2,
 * 	children: [linePlot.create({ data }), rangeBrush.create({ from, to })],
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#multiple-views
 * @category Charts
 */
export const rangeBrush = defineComposite<RangeBrushProps>({
	name: "RangeBrush",
	props: {
		// Tracks the brush writes: kind "event", so a track is held, not bound.
		from: { kind: "event", invalidates: Invalidate.NONE },
		to: { kind: "event", invalidates: Invalidate.NONE },
		axis: { invalidates: Invalidate.NONE },
		x: { invalidates: Invalidate.NONE },
		y: { invalidates: Invalidate.NONE },
		bounds: { invalidates: Invalidate.UPDATE },
		minSpan: { invalidates: Invalidate.UPDATE },
		snap: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		handles: { invalidates: Invalidate.UPDATE },
		disabled: { invalidates: Invalidate.UPDATE },
		wheel: { invalidates: Invalidate.UPDATE },
		wheelSpeed: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: setupBrush,
	update: (_changed, ctx) => {
		const state = brushStates.get(ctx.node) as BrushState;
		state.frame = requireFrame(ctx.context(chartContext), "rangeBrush");
		state.place();
		return brushChildren(ctx, state);
	},
});
