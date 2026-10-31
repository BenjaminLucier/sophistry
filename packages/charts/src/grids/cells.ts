/**
 * `cells`: a grid of categorical cells coloured by a value, the categorical
 * heatmap. The cells are one instances node of `rect`s keyed by datum key
 * (per-cell picking through `event.key`, colour tweens through `transition`);
 * their text, when asked for, is one `label` per cell (text does not batch).
 * Keyed `to`/`blend` transitions slide cells with their bands and blend
 * their colours, each end through its own ramp.
 */

import type {
	ColorRampSpec,
	CompositeContext,
	CoordinateSystem,
	SceneNode,
	TextProps,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	label,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { BandKey, Bounds } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { resolveColorRamp } from "@sophistry/core/internal";
import type { Colormap } from "@sophistry/core/themes";
import { bandSpan } from "../band";
import type { MarkTransition } from "../batch";
import type { ColorNorm, RampScaleProps } from "../color-norm";
import { colorNorm, rampOf } from "../color-norm";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, ColorChannel, DateSink } from "../data/channels";
import {
	dateSinkContext,
	numberValues,
	resolveChannel,
	resolveColor,
} from "../data/channels";
import { endSpace } from "../end-space";
import type { RampExtent } from "../frame/types";
import { itemTooltipHandlers } from "../item-tooltip";
import type { JoinEnd } from "../join";
import { createKeyedData, joinFrames, layerTransition } from "../join";
import { blendCss, mixBounds, readableOn } from "../mix";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props";
import { staggered } from "../stagger";
import type { TooltipSpec } from "../tooltip";
import { tooltipContext, tooltipText } from "../tooltip";
import { keyedMemo, mix } from "../util";
import type { CellItem, CellRects } from "./cell-rects";
import { boxPlacement, createCellRects } from "./cell-rects";

const DEFAULT_INSET = 0.03;
const DEFAULT_LABEL_FONT_SIZE = 0.22;
const DEFAULT_STAGGER = 0.5;

/**
 * Props of {@link cells}.
 *
 * @category Charts
 */
export interface CellsProps<T = unknown>
	extends RampScaleProps,
		KeyedTransitionProps<T>,
		RevealProps {
	/** One cell per datum. */
	data: readonly T[];
	/** The cell's column: a category on the band x axis. */
	x: Channel<T, BandKey>;
	/** The cell's row: a category on the band y axis. */
	y: Channel<T, BandKey>;
	/**
	 * The number the cell's colour encodes, through `ramp`. Non-finite values leave the cell out.
	 */
	value?: Channel<T, number>;
	/** A colour per cell, overriding `value`'s ramp: constant or `(d, i) => colour`. */
	color?: ColorChannel<T>;
	/**
	 * How `value` becomes colour: a colormap name (`"viridis"`), CSS stops, or `(t) => colour`.
	 * Defaults to the theme's ramp.
	 */
	ramp?: ColorRampSpec;
	/** Value at the bottom of the ramp. Defaults to the smallest value. */
	rampMin?: number;
	/** Value at the top of the ramp. Defaults to the largest value. */
	rampMax?: number;
	/**
	 * Text in each cell: `true` writes the value, a channel writes anything. Its colour is picked
	 * to read on the fill.
	 */
	labels?: boolean | Channel<T, string>;
	/**
	 * Font size of the labels.
	 * @default 0.22
	 */
	labelFontSize?: number;
	/**
	 * Gap left around each cell.
	 * @default 0.03
	 */
	inset?: number;
	/**
	 * Fill opacity, 0..1.
	 * @default 1
	 */
	fillOpacity?: number;
	/**
	 * Reveal, 0..1: cells fade in in reading order, top row first.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering across the cells, 0..0.95.
	 * @default 0.5
	 */
	stagger?: number;
	/**
	 * Hover tooltip: `true` for a row per channel (`x`, `y`, `value`), or a template, function or
	 * options. See {@link TooltipSpec}.
	 */
	tooltip?: TooltipSpec<T>;
	/**
	 * How cells move and change colour when `data` changes (outside a `to`
	 * blend): a tween or a spring in the node's tween bank; new cells fade in,
	 * removed ones fade out. Omitted, data changes are instant.
	 */
	transition?: MarkTransition;
	/**
	 * Paint order; the cells' text paints one above. Defaults to `UNDER_AXES_Z_INDEX` (above the
	 * grid, under the axes).
	 */
	zIndex?: number;
	/** Set to false to hide the cells. */
	visible?: boolean;
	/**
	 * Each cell's identity across transitions; give a key to follow a datum that moves to another
	 * cell. See {@link KeyedTransitionProps}. Defaults to its (column, row) pair.
	 */
	key?: Channel<T, BandKey>;
	/**
	 * The data to transition to, matched to `data` by `key`: shared cells blend colour (each end
	 * through its own ramp) and slide with their bands; others fade in or out. See {@link
	 * KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
}

/** One dataset's cells: column and row, value, and the ramp's domain over them. */
interface Side {
	data: readonly unknown[];
	places: { x: BandKey; y: BandKey }[];
	values: number[];
	norm: ColorNorm;
}

/** A cell on one frame: its band edges in data units, its fill and its text. */
interface CellState {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	fill: string;
	text: string | undefined;
}

/** Two cells blended at `u`: edges in data units, fill in OKLCH, text switching halfway. */
function blendCell(a: CellState, b: CellState, u: number): CellState {
	return {
		x0: mix(a.x0, b.x0, u),
		x1: mix(a.x1, b.x1, u),
		y0: mix(a.y0, b.y0, u),
		y1: mix(a.y1, b.y1, u),
		fill: blendCss(a.fill, b.fill, u),
		text: u < 0.5 ? a.text : b.text,
	};
}

/** What one cell draws on a frame. */
interface CellMark extends CellItem {
	text: string | undefined;
	/** The side and index its datum is read from (the nearer end's). */
	side: Side;
	index: number;
}

/** What a cells layer keeps between updates. */
interface CellsState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	from: (deps: readonly unknown[], make: () => Side) => Side;
	to: (deps: readonly unknown[], make: () => Side) => Side;
	colormap: (deps: readonly unknown[], make: () => Colormap) => Colormap;
	fromRamp: (deps: readonly unknown[], make: () => RampExtent) => RampExtent;
	toRamp: (deps: readonly unknown[], make: () => RampExtent) => RampExtent;
	placeKey: (
		deps: readonly unknown[],
		make: () => (d: unknown, i: number) => BandKey,
	) => (d: unknown, i: number) => BandKey;
	rects: CellRects<CellMark>;
}

const states = new WeakMap<object, CellsState>();

function sideOf(
	props: Readonly<CellsProps<AnyDatum>>,
	data: readonly unknown[],
	dates: DateSink | null,
): Side {
	const x = resolveChannel<unknown, BandKey>(
		props.x as Channel<unknown, BandKey>,
		undefined,
		"x",
		dates,
	);
	const y = resolveChannel<unknown, BandKey>(
		props.y as Channel<unknown, BandKey>,
		undefined,
		"y",
		dates,
	);
	const values =
		props.value === undefined
			? data.map(() => Number.NaN)
			: numberValues(
					data,
					props.value as Channel<unknown, number>,
					undefined,
					"value",
					dates,
				);
	return {
		data,
		places: data.map((d, i) => ({
			x: x(d, i) as BandKey,
			y: y(d, i) as BandKey,
		})),
		values,
		norm: colorNorm(values, {
			rampScale: props.rampScale,
			rampMidpoint: props.rampMidpoint,
			rampMin: props.rampMin,
			rampMax: props.rampMax,
			always: true,
		}),
	};
}

function draw(ctx: CompositeContext<CellsProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as CellsState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!frame || !coords)
		throw new Error("Cells must be placed inside a chart.");
	const dates = ctx.context(dateSinkContext);
	const tooltip = ctx.context(tooltipContext);
	const theme = ctx.theme;

	const colormap = state.colormap([props.ramp, theme.palette.ramp], () =>
		resolveColorRamp(props.ramp, () => theme.palette.ramp),
	);
	const sideDeps = (data: readonly unknown[]) => [
		data,
		props.x,
		props.y,
		props.value,
		props.rampScale,
		props.rampMidpoint,
		props.rampMin,
		props.rampMax,
	];
	const from = state.from(sideDeps(props.data), () =>
		sideOf(props, props.data, dates),
	);
	const to =
		props.to === undefined
			? undefined
			: state.to(sideDeps(props.to), () =>
					sideOf(props, props.to as readonly unknown[], dates),
				);
	/** A cell's default key: its (column, row) pair. */
	const placeKey = state.placeKey([props.x, props.y], () => {
		const x = resolveChannel(
			props.x as Channel<unknown, BandKey>,
			undefined,
			"x",
		);
		const y = resolveChannel(
			props.y as Channel<unknown, BandKey>,
			undefined,
			"y",
		);
		return (d: unknown, i: number): BandKey =>
			`${typeof x(d, i)}:${String(x(d, i))}\u0000${typeof y(d, i)}:${String(y(d, i))}`;
	});
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key ?? placeKey,
		series: undefined,
		of: undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame.join,
		enterStagger: props.enterStagger,
		dates,
	});
	/** Whether the colour bar shows `to`'s ramp: past the blend's midpoint. */
	const nearTo = keyed.active && keyed.t >= 0.5;
	const extentsOf = (side: Side) => ({
		x: { categories: side.places.map((k) => k.x), padding: 0 },
		y: { categories: side.places.map((k) => k.y), padding: 0 },
	});
	const ramp =
		props.value === undefined
			? undefined
			: to && nearTo
				? state.toRamp([to.norm, colormap], () =>
						rampOf(to.norm, to.norm.domain, colormap),
					)
				: state.fromRamp([from.norm, colormap], () =>
						rampOf(from.norm, from.norm.domain, colormap),
					);
	layer.report({
		...extentsOf(from),
		covers: true,
		ramp,
		transition: to
			? layerTransition(keyed, props.staging, extentsOf(to))
			: undefined,
	});

	const colorOf = resolveColor(props.color);
	/** A cell's fill at one end: its own colour, else its value through that end's ramp. */
	const fillOf = (side: Side, index: number): string | undefined => {
		// A colour function may return nothing for a datum; the colormap applies.
		const explicit = colorOf?.(side.data[index], index);
		if (explicit) return explicit;
		const value = side.values[index] as number;
		if (!Number.isFinite(value)) return undefined;
		// Values the norm has no place for (not positive on a log norm) are missing.
		const t = side.norm.unit(value);
		return Number.isFinite(t) ? colormap(t) : undefined;
	};
	const labelOf = (() => {
		if (!props.labels) return undefined;
		if (props.labels === true) {
			return (side: Side, i: number) => {
				const value = side.values[i] as number;
				return Number.isFinite(value) ? formatTick(value) : "";
			};
		}
		const read = resolveChannel(
			props.labels as Channel<unknown, string>,
			undefined,
			"labels",
		);
		return (side: Side, i: number) => read(side.data[i], i);
	})();

	/** Where each end draws while an axis changes kind across the transition. */
	const space = endSpace(frame, coords);
	const frames = joinFrames<CellState>(
		keyed,
		(end: JoinEnd, index) => {
			const side = end === "from" ? from : to;
			const place = side?.places[index];
			if (!side || !place) return undefined;
			const xs = bandSpan(space.band(end, "x"), place.x);
			const ys = bandSpan(space.band(end, "y"), place.y);
			const fill = fillOf(side, index);
			if (!xs || !ys || !fill) return undefined;
			return {
				x0: xs[0],
				x1: xs[1],
				y0: ys[0],
				y1: ys[1],
				fill,
				text: labelOf?.(side, index) || undefined,
			};
		},
		blendCell,
		space.swapping,
	);

	/** Reading order: top row first, left to right, from the bands' slots (the nearer end's place, in its bands). */
	const rankOf = (
		place: { x: BandKey; y: BandKey } | undefined,
		end: JoinEnd,
	): [number, number] => {
		const xBand = space.band(end, "x");
		const yBand = space.band(end, "y");
		if (!xBand || !yBand || !place) return [0, 1];
		const columns = xBand.domain.length;
		const rows = yBand.domain.length;
		const row = rows - 1 - yBand.index(place.y);
		return [row * columns + xBand.index(place.x), columns * rows];
	};
	const inset = props.inset ?? DEFAULT_INSET;
	const boxFor = (cell: CellState, system: CoordinateSystem): Bounds => {
		const a = system.coordsToPoint(cell.x0, cell.y0);
		const b = system.coordsToPoint(cell.x1, cell.y1);
		return {
			minX: Math.min(a.x, b.x) + inset,
			maxX: Math.max(a.x, b.x) - inset,
			minY: Math.min(a.y, b.y) + inset,
			maxY: Math.max(a.y, b.y) - inset,
		};
	};

	const reveal = layer.progress(props.progress) ?? 1;
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	const items: CellMark[] = [];
	for (const key of keyed.keys) {
		// A key on its way out reads no frame, so its cell hides.
		const own = frames.get(key);
		if (!own || !(own.presence > 0)) continue;
		// Mid-swap, each end's cell through its own plot, blended.
		const box = space.shape(
			own,
			(cell, _end, system) => boxFor(cell, system),
			mixBounds,
		);
		if (!box) continue;
		const side = (own.end === "to" ? to : from) as Side;
		const [rank, count] = rankOf(side.places[own.index], own.end);
		items.push({
			key,
			...boxPlacement(box),
			fill: own.state.fill,
			// The reveal and the join's presence together: cells fade in and out.
			opacity: staggered(reveal, rank, count, stagger) * own.presence,
			text: own.state.text,
			side,
			index: own.index,
		});
	}

	const zIndex = props.zIndex ?? UNDER_AXES_Z_INDEX;
	const handlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const cell = state.rects.itemAt(item);
			if (!cell) return undefined;
			const place = cell.side.places[cell.index];
			const value = cell.side.values[cell.index] as number;
			return tooltipText(
				props.tooltip,
				() => [
					{
						channel: "x",
						of: props.x,
						value: place?.x,
						format: frame.format("x"),
					},
					{
						channel: "y",
						of: props.y,
						value: place?.y,
						format: frame.format("y"),
					},
					{
						channel: "value",
						of: props.value,
						value: Number.isFinite(value) ? value : undefined,
						color: cell.fill,
					},
				],
				cell.side.data[cell.index],
				cell.index,
				tooltip ?? undefined,
			);
		},
		(item) => {
			const cell = state.rects.itemAt(item);
			return cell
				? { x: cell.center.x, y: cell.center.y + cell.height / 2 }
				: undefined;
		},
		() => "Cells",
	);
	state.rects.update(
		items,
		{
			stroke: "none",
			fillOpacity: props.fillOpacity,
			zIndex,
			visible: props.visible,
			...(tooltip && (props.tooltip !== undefined || tooltip.config())
				? {
						label: handlers.label,
						onEnter: handlers.onEnter,
						onLeave: handlers.onLeave,
						onTap: handlers.onTap,
						itemLabel: handlers.itemLabel,
					}
				: {}),
		} as never,
		{ transition: props.transition, animate: !keyed.active && reveal >= 1 },
	);

	// The cells' text: one label per cell that writes some, in a colour that reads on its fill.
	const written = items.filter((item) => item.text);
	const fontSize = props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
	const textOf = (item: CellMark): Partial<TextProps> & { text: string } => ({
		text: item.text as string,
		x: item.center.x,
		y: item.center.y,
		fontSize,
		color: readableOn(
			item.fill ?? theme.palette.background,
			theme.palette.foreground,
			theme.palette.background,
		),
		opacity: item.opacity,
		zIndex: zIndex + 1,
		visible: props.visible,
	});
	const labels = ctx.list("labels", written, {
		key: (item) => item.key,
		create: (item) => label.create(textOf(item)),
		update: (node, item) => node.update(textOf(item)),
	});
	return [state.rects.node, ...labels];
}

/**
 * A grid of categorical cells coloured by a value: the categorical heatmap. Both axes become
 * band axes with no gap; `labels` writes each value in a colour that reads on its cell. Must
 * sit inside a `chart`. The cells are one instances node; tooltips resolve per cell.
 *
 * @example
 * ```ts
 * import { cells, chart } from "@sophistry/charts";
 *
 * const sales = [
 * 	{ month: "Jan", region: "north", total: 12 },
 * 	{ month: "Jan", region: "south", total: 7 },
 * 	{ month: "Feb", region: "north", total: 9 },
 * 	{ month: "Feb", region: "south", total: 11 },
 * ];
 * chart.create({
 * 	width: 6,
 * 	height: 3,
 * 	colorbar: true,
 * 	children: [cells.create({ data: sales, x: "month", y: "region", value: "total", labels: true })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const cells = defineComposite<CellsProps<AnyDatum>>({
	name: "Cells",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		rampMin: { invalidates: Invalidate.UPDATE },
		rampMax: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMidpoint: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		inset: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			keyed: createKeyedData<AnyDatum>(),
			from: keyedMemo(),
			to: keyedMemo(),
			colormap: keyedMemo(),
			fromRamp: keyedMemo(),
			toRamp: keyedMemo(),
			placeKey: keyedMemo(),
			rects: createCellRects<CellMark>(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
