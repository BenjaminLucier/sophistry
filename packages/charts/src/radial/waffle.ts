/**
 * `waffle`: a grid of unit cells coloured by category.
 *
 * Two instances nodes of `square`: the empty grid (one shared fill, faded
 * in together) and the filled cells (keyed by their place in the grid, each
 * its own fill; a cell grows from its centre as its turn in the fill
 * comes). Hover,
 * taps and tooltips resolve per cell (`event.item`), each telling its
 * category. The legend's swatches and labels are single nodes.
 */

import type {
	ColorInput,
	CompositeContext,
	RectProps,
	SceneNode,
	SquareProps,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	instances,
	label,
	rect,
	square,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { clamp01, cssColor } from "@sophistry/core/internal";
import type { BatchItem } from "../batch";
import { createBatchedMark } from "../batch";
import type { Channel, ColorChannel, RequiredUnless } from "../data/channels";
import {
	colorResolver,
	identity,
	numberValues,
	resolveChannel,
} from "../data/channels";
import { itemTooltipHandlers } from "../item-tooltip";
import type { WaffleCell } from "../math/waffle";
import { largestRemainder, waffleCells } from "../math/waffle";
import type { AnyDatum } from "../props";
import { staggered } from "../stagger";
import { textWidth } from "../text-width";
import type { TooltipSpec } from "../tooltip";
import { tooltipText } from "../tooltip";
import { createOwnTooltip } from "./shared";

/** Share of `progress` spent fading in the empty grid before the cells fill. */
const FRAME_SHARE = 0.15;
const DEFAULT_STAGGER = 0.9;
const DEFAULT_CELL_SIZE = 0.3;
const DEFAULT_GAP = 0.05;
const DEFAULT_LEGEND_FONT_SIZE = 0.22;
/** Corner radius as a fraction of the cell size. */
const CELL_ROUNDING = 0.12;

/** @category Charts */
export interface WaffleBaseProps<T> {
	/** One category per datum, filling cells in data order. */
	data: readonly T[];
	/**
	 * The category's value; only shares matter. Defaults to the datum when `data` is `number[]`;
	 * required otherwise. Negative and non-finite values count as 0.
	 */
	value?: Channel<T, number>;
	/** The category's name, for the legend and tooltips. */
	label?: Channel<T, string>;
	/**
	 * Rows of cells.
	 * @default 10
	 */
	rows?: number;
	/**
	 * Columns of cells.
	 * @default 10
	 */
	columns?: number;
	/**
	 * Width of the box the grid fits in; cells are the largest squares that fit with `height`.
	 * Ignored when `cellSize` is given.
	 */
	width?: number;
	/** Height of the box the grid fits in. */
	height?: number;
	/** Side of one cell. Wins over `width`/`height`. Defaults to 0.3 when none is given. */
	cellSize?: number;
	/**
	 * Space between cells.
	 * @default 0.05
	 */
	gap?: number;
	/** Centre of the grid (not counting the legend). Defaults to the origin. */
	center?: Point;
	/** One colour for every category, or `(d, i) => colour`. Wins over `colors`. */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the categories by index. Defaults to the theme's categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Draw the empty grid behind the cells.
	 * @default true
	 */
	track?: boolean;
	/** Colour of the empty grid. Defaults to the theme's grid colour. */
	trackColor?: ColorInput;
	/**
	 * A row of swatches with each category's label and percentage.
	 * @default false
	 */
	legend?: boolean;
	/**
	 * Where the legend sits: under the grid or in a column to its right.
	 * @default "bottom"
	 */
	legendPosition?: "bottom" | "right";
	/**
	 * Legend font size.
	 * @default 0.22
	 */
	legendFontSize?: number;
	/**
	 * Reveal, 0..1: the empty grid fades in, then cells grow one after another in fill order.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the cells' reveal spent staggering cell after cell, 0..0.95.
	 * @default 0.9
	 */
	stagger?: number;
	/**
	 * Hover tooltip over the cell under the pointer: `true` for "label: value (pct)", or `(d, i) =>
	 * string` for its category.
	 */
	tooltip?: TooltipSpec<T>;
	/** Paint order; higher draws later. */
	zIndex?: number;
	visible?: boolean;
}

/**
 * Props of {@link waffle}: `value` is required unless `data` is `number[]`.
 *
 * @category Charts
 */
export type WaffleProps<T> = WaffleBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** One cell as drawn. */
interface CellItem extends BatchItem {
	center: Point;
	size: number;
	fill: string;
	/** Its category (the datum's index). */
	category: number;
}

/** The grid's cell size and placement. */
interface Layout {
	size: number;
	gridWidth: number;
	gridHeight: number;
	pitch: number;
	cx: number;
	cy: number;
}

/** One legend entry, laid out. */
interface LegendItem {
	index: number;
	text: string;
	swatch: Point;
	textAt: Point;
}

/** What a waffle keeps between updates. */
interface WaffleState {
	tooltip: ReturnType<typeof createOwnTooltip>;
	track: ReturnType<
		typeof instances<
			SquareProps,
			SceneNode<SquareProps>,
			never,
			CellItem,
			number
		>
	>;
	cells: ReturnType<
		typeof createBatchedMark<
			CellItem,
			SquareProps,
			SceneNode<SquareProps>,
			keyof SquareProps
		>
	>;
	values: (data: readonly unknown[], value: unknown) => number[];
	labels: (
		data: readonly unknown[],
		label: unknown,
	) => readonly string[] | undefined;
	cellsOf: (
		values: readonly number[],
		rows: number | undefined,
		columns: number | undefined,
	) => WaffleCell[];
	percents: (values: readonly number[]) => number[];
}

const states = new WeakMap<object, WaffleState>();

function draw(ctx: CompositeContext<WaffleProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as WaffleState;
	const props = ctx.props;
	const theme = ctx.theme;
	const tooltip = state.tooltip(ctx);
	const zIndex = props.zIndex ?? 0;

	const progress = clamp01(props.progress ?? 1);
	if (props.visible === false || !(progress > 0)) {
		// Hidden: the batches stay (removed children are disposed), empty.
		state.track.update({ data: [] } as never);
		state.cells.update([]);
		ctx.list("legend", [], { create: () => label.create({ text: "" }) });
		ctx.list("swatches", [], {
			create: () => rect.create({ width: 0, height: 0 }),
		});
		return [state.track, state.cells.node, ...state.tooltip.overlay(ctx)];
	}

	const values = state.values(props.data, props.value);
	const labels = state.labels(props.data, props.label);
	const cells = state.cellsOf(values, props.rows, props.columns);
	/** Whole percentages that sum to exactly 100. */
	const percents = state.percents(values);
	const total = cells.length;
	const last = cells[total - 1];
	const columns = last ? last.column + 1 : 0;
	const rows = last ? last.row + 1 : 0;
	const gap = Math.max(0, props.gap ?? DEFAULT_GAP);
	let size = props.cellSize;
	if (size === undefined) {
		const fits: number[] = [];
		if (props.width !== undefined && columns > 0)
			fits.push((props.width - gap * (columns - 1)) / columns);
		if (props.height !== undefined && rows > 0)
			fits.push((props.height - gap * (rows - 1)) / rows);
		size = fits.length > 0 ? Math.min(...fits) : DEFAULT_CELL_SIZE;
	}
	size = Math.max(0, size);
	const layout: Layout = {
		size,
		gridWidth: columns * size + Math.max(0, columns - 1) * gap,
		gridHeight: rows * size + Math.max(0, rows - 1) * gap,
		pitch: size + gap,
		cx: props.center?.x ?? 0,
		cy: props.center?.y ?? 0,
	};
	const centerOf = (cell: WaffleCell): Point => ({
		x:
			layout.cx -
			layout.gridWidth / 2 +
			layout.size / 2 +
			cell.column * layout.pitch,
		y:
			layout.cy -
			layout.gridHeight / 2 +
			layout.size / 2 +
			cell.row * layout.pitch,
	});

	const frameT = clamp01(progress / FRAME_SHARE);
	const dataT = clamp01((progress - FRAME_SHARE) / (1 - FRAME_SHARE));
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	/** A cell's own reveal, by its place in fill order. */
	const revealOf = (rank: number) => staggered(dataT, rank, total, stagger);
	const colorFor = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const describe = (index: number) => {
		const name = labels?.[index];
		const body = `${formatTick(values[index] as number)} (${percents[index]}%)`;
		return name ? `${name}: ${body}` : body;
	};

	// The empty grid.
	const trackCells: CellItem[] =
		props.track !== false
			? cells.map((cell, i) => ({
					key: i,
					center: centerOf(cell),
					size: layout.size,
					fill: "",
					category: -1,
				}))
			: [];
	state.track.update({
		data: trackCells,
		shared: {
			fill: cssColor(props.trackColor ?? theme.palette.grid),
			stroke: "none",
			size: layout.size,
			cornerRadius: layout.size * CELL_ROUNDING,
			opacity: frameT,
			zIndex,
			visible: true,
		},
	} as never);

	// The cells, each growing from its centre as its turn in the fill comes.
	const items: CellItem[] = [];
	const firstRanks: number[] = values.map(() => -1);
	for (const cell of cells) {
		if (cell.category < 0) continue;
		if ((firstRanks[cell.category] as number) < 0)
			firstRanks[cell.category] = cell.rank;
		const t = revealOf(cell.rank);
		if (!(t > 0)) continue;
		items.push({
			key: cell.rank,
			center: centerOf(cell),
			size: layout.size * t,
			fill: colorFor(props.data[cell.category], cell.category),
			category: cell.category,
		});
	}
	const tipped = props.tooltip !== undefined || !!tooltip.config();
	const handlers = itemTooltipHandlers(
		tooltip,
		(item) => {
			const cell = state.cells.itemAt(item);
			if (!cell) return undefined;
			return tooltipText(
				props.tooltip,
				(_datum, index) => describe(index),
				props.data[cell.category],
				cell.category,
				tooltip,
			);
		},
		// Over the top centre of the cell under the pointer.
		(item) => {
			const cell = state.cells.itemAt(item);
			return cell
				? { x: cell.center.x, y: cell.center.y + layout.size / 2 }
				: undefined;
		},
		() => "Waffle",
	);
	state.cells.update(
		items,
		{
			stroke: "none",
			zIndex: zIndex + 1,
			visible: true,
			...(tipped
				? {
						label: handlers.label,
						onEnter: handlers.onEnter,
						onLeave: handlers.onLeave,
						onTap: handlers.onTap,
						itemLabel: handlers.itemLabel,
					}
				: {}),
		} as never,
		{ transition: undefined, animate: false },
	);

	// The legend: a swatch and "label pct%" per category, each appearing with
	// its category's first cell.
	const legendFontSize = props.legendFontSize ?? DEFAULT_LEGEND_FONT_SIZE;
	const legend: LegendItem[] = [];
	if (props.legend) {
		const fontSize = legendFontSize;
		const fontFamily = theme.defaults.fontFamily;
		const swatch = fontSize * 0.9;
		const swatchGap = fontSize * 0.4;
		const entries = values.map((_, index) => {
			const name = labels?.[index];
			const text = name ? `${name} ${percents[index]}%` : `${percents[index]}%`;
			return { index, text, width: textWidth(text, fontSize, fontFamily) };
		});
		if (props.legendPosition === "right") {
			const left = layout.cx + layout.gridWidth / 2 + fontSize * 1.2;
			const top = layout.cy + layout.gridHeight / 2 - fontSize * 0.6;
			entries.forEach((entry, k) => {
				legend.push({
					index: entry.index,
					text: entry.text,
					swatch: { x: left + swatch / 2, y: top - k * fontSize * 1.6 },
					textAt: {
						x: left + swatch + swatchGap,
						y: top - k * fontSize * 1.6,
					},
				});
			});
		} else {
			const itemGap = fontSize * 1.2;
			const rowWidth =
				entries.reduce(
					(sum, entry) => sum + swatch + swatchGap + entry.width,
					0,
				) +
				itemGap * Math.max(0, entries.length - 1);
			const y = layout.cy - layout.gridHeight / 2 - fontSize * 1.4;
			let x = layout.cx - rowWidth / 2;
			for (const entry of entries) {
				legend.push({
					index: entry.index,
					text: entry.text,
					swatch: { x: x + swatch / 2, y },
					textAt: { x: x + swatch + swatchGap, y },
				});
				x += swatch + swatchGap + entry.width + itemGap;
			}
		}
	}
	/** A legend entry appears with its category's first cell. */
	const legendReveal = (index: number) => {
		const own = firstRanks[index] as number;
		if (own >= 0) return revealOf(own);
		// A category with no cells appears where it would have started.
		let next = total - 1;
		for (let k = index + 1; k < firstRanks.length; k++) {
			if ((firstRanks[k] as number) >= 0) {
				next = firstRanks[k] as number;
				break;
			}
		}
		return revealOf(Math.max(0, next));
	};
	const shownLegend = legend
		.map((item) => ({ item, reveal: legendReveal(item.index) }))
		.filter(({ reveal }) => reveal > 0);
	const side = legendFontSize * 0.9;
	const swatches = ctx.list("swatches", shownLegend, {
		key: ({ item }) => item.index,
		create: ({ item, reveal }) => rect.create(swatchProps(item, reveal)),
		update: (node, { item, reveal }) => {
			node.update(swatchProps(item, reveal));
		},
	});
	function swatchProps(item: LegendItem, reveal: number): RectProps {
		return {
			center: item.swatch,
			width: side,
			height: side,
			cornerRadius: side * CELL_ROUNDING,
			fill: colorFor(props.data[item.index], item.index),
			stroke: "none",
			opacity: reveal,
			zIndex,
		};
	}
	const texts = ctx.list("legend", shownLegend, {
		key: ({ item }) => item.index,
		create: ({ item, reveal }) => label.create(textProps(item, reveal)),
		update: (node, { item, reveal }) => {
			node.update(textProps(item, reveal));
		},
	});
	function textProps(item: LegendItem, reveal: number) {
		return {
			text: item.text,
			x: item.textAt.x,
			y: item.textAt.y,
			align: "left" as const,
			fontSize: legendFontSize,
			color: theme.palette.foreground,
			opacity: reveal,
			zIndex,
		};
	}
	const legendNodes: SceneNode[] = [];
	swatches.forEach((swatchNode, i) => {
		legendNodes.push(swatchNode, texts[i] as SceneNode);
	});
	return [
		state.track,
		state.cells.node,
		...legendNodes,
		...state.tooltip.overlay(ctx),
	];
}

/**
 * A waffle chart: a grid of unit cells (10 × 10 by default, one cell per percent) coloured by
 * category in proportion to each value, filling row by row from the bottom-left. Counts are
 * rounded so they always fill the grid exactly. Draws in scene units; needs no `chart`. The
 * cells are one instances node. See {@link waffleCells} for the cell assignment alone.
 *
 * @example
 * ```ts
 * import { waffle } from "@sophistry/charts";
 *
 * waffle.create({
 * 	data: [
 * 		{ name: "Yes", n: 62 },
 * 		{ name: "No", n: 38 },
 * 	],
 * 	value: "n",
 * 	label: "name",
 * 	legend: true,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#gauges-bullets-waffles-mosaics-and-radial-bars
 * @category Charts
 */
export const waffle = defineComposite<WaffleProps<AnyDatum>>({
	name: "Waffle",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		rows: { invalidates: Invalidate.UPDATE },
		columns: { invalidates: Invalidate.UPDATE },
		width: { invalidates: Invalidate.UPDATE },
		height: { invalidates: Invalidate.UPDATE },
		cellSize: { invalidates: Invalidate.UPDATE },
		gap: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		track: { invalidates: Invalidate.UPDATE },
		trackColor: { invalidates: Invalidate.UPDATE },
		legend: { invalidates: Invalidate.UPDATE },
		legendPosition: { invalidates: Invalidate.UPDATE },
		legendFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			tooltip: createOwnTooltip(),
			track: instances(square as never, {
				data: [] as CellItem[],
				key: (item: CellItem) => item.key as number,
				channels: { center: (item: CellItem) => item.center },
			}) as never,
			cells: createBatchedMark<
				CellItem,
				SquareProps,
				SceneNode<SquareProps>,
				keyof SquareProps
			>(square as never, {
				channels: {
					center: (item) => item.center,
					size: (item) => item.size,
					cornerRadius: (item) => item.size * CELL_ROUNDING,
					fill: (item) => item.fill,
				},
			}),
			values: ctx.memo((data: readonly unknown[], value: unknown) =>
				numberValues(
					data,
					value as Channel<unknown, number> | undefined,
					identity,
					"value",
				),
			),
			labels: ctx.memo((data: readonly unknown[], channel: unknown) => {
				const read = resolveChannel(
					channel as Channel<unknown, string> | undefined,
					undefined,
					"label",
				);
				return read ? data.map((d, i) => read(d, i)) : undefined;
			}),
			cellsOf: ctx.memo(
				(
					values: readonly number[],
					rows: number | undefined,
					columns: number | undefined,
				) => waffleCells(values, { rows, columns }),
			),
			percents: ctx.memo((values: readonly number[]) =>
				largestRemainder(values, 100),
			),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
