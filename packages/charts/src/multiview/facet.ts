/**
 * Small multiples: one `chart` per category, laid out in a grid, sharing
 * scales, one colour scale and one legend.
 *
 * Each panel is a `chart` inside a plain `group` that provides the panel's
 * {@link ChartGroupScope} (its share keys and grid place); the panels and
 * the facet meet in one {@link ChartGroup}. The facet watches the group, so
 * a panel whose guide room or axis span changed lays the grid out again in
 * the same commit.
 */

import type {
	CompositeContext,
	ContainerNode,
	ContextKey,
	SceneNode,
} from "@sophistry/core";
import {
	createContextKey,
	defineComposite,
	group as groupNode,
	Invalidate,
	label,
} from "@sophistry/core";
import type {
	BandKey,
	Point,
	Range,
	RangeTransition,
} from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import { chart } from "../chart";
import type { Channel } from "../data/channels";
import { resolveChannel } from "../data/channels";
import { halfLine } from "../frame/guide-metrics";
import type {
	ChartAxisOptions,
	ChartColorOptions,
	ChartSizeLegendOptions,
	ChartXAxisOptions,
	ChartYAxisOptions,
} from "../frame/types";
import type { FacetSlot, SideRoom } from "../math/facet";
import { facetGrid, facetSlots, outerEdge, panelProgress } from "../math/facet";
import { uniqueKeys } from "../math/ordinal";
import type { AnyDatum, LayersReveal } from "../props";
import { shallowEqual } from "../util";
import type { ChartGroup, ChartGroupScope } from "./chart-group";
import {
	chartGroupContext,
	createChartGroup,
	sameRatios,
	spanRatios,
} from "./chart-group";
import type { GroupGuideOptions, GroupGuides } from "./group-guides";
import { createGroupGuides, PANELS_END_WITH_GUIDES } from "./group-guides";

const DEFAULT_PANEL_TITLE_FONT_SIZE = 0.3;
/** Across a column gap: room for the end numbers of two shared x axes to sit side by side. */
const DEFAULT_GAP = 0.55;
/** Above each panel's plot, below its title, when the panels share x and the gap holds titles only. */
const DEFAULT_GAP_Y = 0.25;
/** Between the grid's right-hand guides (or plots) and the row titles in the margin. */
const ROW_TITLE_GAP = 0.2;

/**
 * How a {@link facet}'s panels share their axes, for both axes or per axis: `"shared"` panels
 * fit one range (numbers on the outer panels only), `"independent"` each fit their own; x may
 * be `"column"` (shared down each column) and y `"row"` (shared along each row). `size` sets
 * whether sized marks (`scatter`'s `size`) share one size scale; it is `"shared"` by default.
 *
 * @category Charts
 */
export type FacetScales =
	| "shared"
	| "independent"
	| {
			x?: "shared" | "independent" | "column";
			y?: "shared" | "independent" | "row";
			size?: "shared" | "independent";
	  };

/**
 * How a {@link facet} sizes its panels along an axis: `"fixed"` (equal, or by
 * `widths`/`heights`) or `"free"` (by the length of the panels' ranges). For both axes or per axis.
 *
 * @category Charts
 */
export type FacetSpace =
	| "fixed"
	| "free"
	| { x?: "fixed" | "free"; y?: "fixed" | "free" };

/**
 * One panel of a {@link facet}, as its `panel` builder receives it.
 *
 * @category Charts
 */
export interface FacetPanel<T> {
	/** The rows of `data` in this panel. */
	readonly data: T[];
	/** The rows of `to` in this panel (empty when `to` has none here); undefined without `to`. */
	readonly to: T[] | undefined;
	/** The panel's `row` category, when faceting by rows. */
	readonly row: BandKey | undefined;
	/** The panel's `column` category, when faceting by columns. */
	readonly column: BandKey | undefined;
	/** Reading-order index (row-major). */
	readonly index: number;
}

/**
 * Props for {@link facet}.
 *
 * @category Charts
 */
export interface FacetProps<T> {
	/** The rows, split into panels by `row` and `column`. */
	data: readonly T[];
	/**
	 * A keyed transition's far end, split like `data` and handed to each panel as `panel.to`.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** The category that picks a panel's grid row. */
	row?: Channel<T, BandKey>;
	/** The category that picks a panel's grid column. */
	column?: Channel<T, BandKey>;
	/** The row categories, in order. Defaults to the order first seen. */
	rows?: readonly BandKey[];
	/** The column categories, in order. Defaults to the order first seen. */
	columns?: readonly BandKey[];
	/**
	 * When faceting by one variable: panels per line, filling left to right, then top to bottom.
	 * Defaults to one line.
	 */
	wrap?: number;
	/** Width of the grid of plots (a right-hand legend fits inside; see `autosize`). */
	width: number;
	/** Height of the grid of plots. */
	height: number;
	/** Centre of the grid. Defaults to the origin. */
	center?: Point;
	/**
	 * How the panels share their axes; see {@link FacetScales}. Read once, at creation.
	 * @default "shared"
	 */
	scales?: FacetScales;
	/**
	 * Relative column widths, left to right: `[2, 1]` makes the first column twice as wide. Missing
	 * or non-positive entries count as 1. Defaults to equal columns.
	 */
	widths?: readonly number[];
	/** Relative row heights, top to bottom, as `widths`. */
	heights?: readonly number[];
	/**
	 * `"free"` sizes columns by their panels' x ranges and rows by their y ranges (or per axis), so
	 * one band or unit is equally long in every panel. Pair with `scales: { x: "column" }` for
	 * exact sizing. `widths`/`heights` win.
	 * @default "fixed"
	 */
	space?: FacetSpace;
	/**
	 * Space between neighbouring panels, beyond their titles and numbers. Defaults to 0.55 across,
	 * 0.25 down.
	 */
	gap?: number | { x?: number; y?: number };
	/**
	 * As `chart`'s `autosize`, over the whole grid: `"fit"` fits legend, colour bar and right-hand
	 * numbers inside `width`; `"contain"` fits everything inside `width × height`; `"pad"` makes
	 * the grid of plots exactly `width × height`.
	 * @default "fit"
	 */
	autosize?: "fit" | "pad" | "contain";
	/**
	 * Each panel's title, as a function of the panel, or `false` for none. Defaults to its category
	 * (`"row · column"`, or the column only when rows are titled in the margin).
	 */
	panelTitle?: ((panel: FacetPanel<T>) => string) | false;
	/**
	 * Font size of the panel and row titles.
	 * @default 0.3
	 */
	panelTitleFontSize?: number;
	/**
	 * When faceting by `row` (without `wrap`): write each row's category once in the right margin
	 * and the column categories above the top row only. `false` titles every panel `"row ·
	 * column"`.
	 * @default true
	 */
	marginTitles?: boolean;
	/** A row's title in the margin. Defaults to `String(row)`. */
	rowTitle?: (row: BandKey, index: number) => string;
	/** Fixed x range for every panel, or a `{ from, to, t }` transition. Omitted, fitted. */
	xRange?: Range | RangeTransition;
	/** Fixed y range for every panel. */
	yRange?: Range | RangeTransition;
	/** As `chart`'s `axis`, for every panel. */
	axis?: ChartAxisOptions;
	/** As `chart`'s `xAxis`, for every panel. */
	xAxis?: ChartXAxisOptions;
	/** As `chart`'s `yAxis`, for every panel. */
	yAxis?: ChartYAxisOptions;
	/** As `chart`'s `grid`, for every panel. */
	grid?: boolean | "x" | "y";
	gridColor?: string;
	/** As `chart`'s `clip`, for every panel. */
	clip?: boolean;
	/** As `chart`'s `reveal`, for every panel. */
	reveal?: LayersReveal;
	tip?: boolean;
	/** The shared colour scale: order, colours and legend names. */
	color?: ChartColorOptions;
	/**
	 * One legend for every panel: on the right (`true`, `"right"`) or in a row over the grid
	 * (`"top"`). `false` never draws one. On the right by default whenever a layer reports a
	 * series.
	 */
	legend?: boolean | "right" | "top";
	legendTitle?: string;
	legendFontSize?: number;
	/**
	 * Size keys shared by every panel, for layers sized by value (`scatter`'s `size`), placed with
	 * the legend as `chart`'s `sizeLegend`. Drawn only while the panels share a size scale. `false`
	 * hides them; an object sets title, values and format.
	 * @default true
	 */
	sizeLegend?: boolean | ChartSizeLegendOptions;
	/**
	 * One colour bar for every panel, from the first value-coloured layer.
	 * @default false
	 */
	colorbar?: boolean;
	colorbarLabel?: string;
	/** A title over the grid. */
	title?: string;
	titleFontSize?: number;
	/** One x-axis title, centred under the grid. */
	xLabel?: string;
	/** One y-axis title, centred left of the grid, reading upward. */
	yLabel?: string;
	axisLabelFontSize?: number;
	/**
	 * Reveal, 0..1: every panel draws its frame, then its data; the legend, size key and colour bar
	 * come last.
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the data reveal spent staggering panels in reading order, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	zIndex?: number;
	visible?: boolean;
	/**
	 * Draws one panel's layers: called with the panel when it is
	 * made, and again when its rows change, returning the layer nodes (`scatter.create(...)`).
	 * A plain value prop: the bindings pass the function through untouched, so in Solid or React
	 * give it a function returning nodes made with the definitions' `create`.
	 */
	panel: (panel: FacetPanel<T>) => readonly SceneNode[];
}

/** The share key of a slot: its row and column categories. */
const slotKey = (slot: Pick<FacetSlot, "rowKey" | "columnKey">) =>
	JSON.stringify([slot.rowKey ?? null, slot.columnKey ?? null]);

/** A panel without rows: one shared list, so an empty panel is not rebuilt. */
const NO_ROWS: readonly unknown[] = Object.freeze([]);

/** Why the facet reruns: its group published something. */
const GROUP_LAYOUT: ContextKey<unknown> = createContextKey("facetGroup");

/** One panel's nodes and the rows it was built from. */
interface PanelEntry {
	wrapper: ContainerNode;
	plot: SceneNode;
	scope: ChartGroupScope;
	data: unknown[];
	to: unknown[] | undefined;
	slot: FacetSlot;
}

/** What a facet keeps between updates. */
interface FacetState {
	group: ChartGroup;
	guides: GroupGuides;
	modes: { x: string; y: string };
	stacked: { x: boolean; y: boolean };
	panels: Map<string, PanelEntry>;
	rowTitles: SceneNode[];
	/** Rows per panel at each end, kept by identity while their content holds. */
	split: {
		data: readonly unknown[] | undefined;
		to: readonly unknown[] | undefined;
		row: unknown;
		column: unknown;
		from: Map<string, unknown[]>;
		toRows: Map<string, unknown[]> | undefined;
	} | null;
	ratios: { widths?: readonly number[]; heights?: readonly number[] };
}

const facetStates = new WeakMap<object, FacetState>();

function setupFacet(ctx: CompositeContext<FacetProps<AnyDatum>>): SceneNode[] {
	const mode = (axis: "x" | "y") => {
		const scales = ctx.props.scales ?? "shared";
		return typeof scales === "string" ? scales : (scales[axis] ?? "shared");
	};
	// Read once: how the axes are shared is the grid's structure.
	const modes = { x: mode("x"), y: mode("y") };
	const group = createChartGroup();
	const state: FacetState = {
		group,
		guides: createGroupGuides(),
		modes,
		/**
		 * Whether an axis's inner panels leave out its numbers: shared along the line the
		 * panels stack in, so the outer panel's serve them all.
		 */
		stacked: {
			x: modes.x === "shared" || modes.x === "column",
			y: modes.y === "shared" || modes.y === "row",
		},
		panels: new Map(),
		rowTitles: [],
		split: null,
		ratios: {},
	};
	facetStates.set(ctx.node, state);
	ctx.onDispose(group.watch(() => ctx.invalidate(GROUP_LAYOUT)));
	ctx.onDispose(() => state.guides.dispose());
	return drawFacet(ctx, state);
}

/** A panel's share key on an axis: the grid's, its column's or row's, or none. */
function shareKey(
	state: FacetState,
	axis: "x" | "y",
	slot: FacetSlot,
): string | undefined {
	const own = state.modes[axis];
	if (own === "shared") return axis;
	if (own === "column") return `${axis}:col:${slot.column}`;
	if (own === "row") return `${axis}:row:${slot.row}`;
	return undefined;
}

/** Rows per panel, at each end; a panel's list keeps its identity while its rows are the same. */
function splitRows(
	ctx: CompositeContext<FacetProps<AnyDatum>>,
	state: FacetState,
) {
	const props = ctx.props;
	const last = state.split;
	if (
		last &&
		last.data === props.data &&
		last.to === props.to &&
		last.row === props.row &&
		last.column === props.column
	)
		return last;
	const row = resolveChannel(props.row, undefined, "row");
	const column = resolveChannel(props.column, undefined, "column");
	const split = (
		rows: readonly AnyDatum[] | undefined,
		before: Map<string, unknown[]> | undefined,
	) => {
		if (!rows) return undefined;
		const out = new Map<string, unknown[]>();
		rows.forEach((datum, i) => {
			const key = slotKey({
				rowKey: row?.(datum, i) as BandKey | undefined,
				columnKey: column?.(datum, i) as BandKey | undefined,
			});
			const list = out.get(key);
			if (list) list.push(datum);
			else out.set(key, [datum]);
		});
		if (before)
			for (const [key, list] of out) {
				const kept = before.get(key);
				if (kept && shallowEqual(kept, list)) out.set(key, kept);
			}
		return out;
	};
	state.split = {
		data: props.data,
		to: props.to,
		row: props.row,
		column: props.column,
		from: split(props.data, last?.from) ?? new Map(),
		toRows: split(props.to, last?.toRows),
	};
	return state.split;
}

function drawFacet(
	ctx: CompositeContext<FacetProps<AnyDatum>>,
	state: FacetState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const group = state.group;
	group.setOptions({
		color: props.color,
		shareSize:
			typeof props.scales !== "object" || props.scales.size !== "independent",
		palette: theme.palette.series,
	});

	const row = resolveChannel(props.row, undefined, "row");
	const column = resolveChannel(props.column, undefined, "column");
	const both: readonly AnyDatum[] = props.to
		? [...props.data, ...props.to]
		: props.data;
	const rowKeys = row
		? (props.rows ?? uniqueKeys(both.map((d, i) => row(d, i) as BandKey)))
		: [];
	const columnKeys = column
		? (props.columns ?? uniqueKeys(both.map((d, i) => column(d, i) as BandKey)))
		: [];
	const layout = facetSlots(rowKeys, columnKeys, props.wrap);
	const rows = splitRows(ctx, state);
	const titleSize = props.panelTitleFontSize ?? DEFAULT_PANEL_TITLE_FONT_SIZE;
	/** Whether the rows are titled in the right margin: faceting by `row`, one category per grid row. */
	const marginTitled =
		props.marginTitles !== false &&
		rowKeys.length > 0 &&
		layout.rows === rowKeys.length;

	// The panels: made once per slot, their layers rebuilt only when their rows change.
	const ids = layout.slots.map(slotKey);
	const seen = new Set<string>();
	layout.slots.forEach((slot, i) => {
		const id = ids[i] as string;
		seen.add(id);
		const data = rows.from.get(id) ?? (NO_ROWS as unknown[]);
		const to = rows.toRows
			? (rows.toRows.get(id) ?? (NO_ROWS as unknown[]))
			: undefined;
		const panel: FacetPanel<AnyDatum> = {
			data,
			to,
			row: slot.rowKey,
			column: slot.columnKey,
			index: slot.index,
		};
		const keys = {
			x: shareKey(state, "x", slot),
			y: shareKey(state, "y", slot),
		};
		let entry = state.panels.get(id);
		if (!entry) {
			const plot = chart.create({
				width: 1,
				height: 1,
				children: props.panel(panel),
			});
			const wrapper = groupNode.create({}) as unknown as ContainerNode;
			const scope: ChartGroupScope = {
				group,
				keys,
				place: { row: slot.row, column: slot.column },
			};
			wrapper.provide(chartGroupContext, scope);
			wrapper.setChildren([plot]);
			entry = { wrapper, plot, scope, data, to, slot };
			state.panels.set(id, entry);
		} else {
			if (entry.data !== data || entry.to !== to) {
				entry.plot.set("children" as never, props.panel(panel) as never);
				entry.data = data;
				entry.to = to;
			}
			if (
				entry.slot.row !== slot.row ||
				entry.slot.column !== slot.column ||
				entry.scope.keys.x !== keys.x ||
				entry.scope.keys.y !== keys.y
			) {
				// A panel's column (or row) changed with the categories: a new scope rejoins.
				entry.scope = {
					group,
					keys,
					place: { row: slot.row, column: slot.column },
				};
				entry.wrapper.provide(chartGroupContext, entry.scope);
			}
			entry.slot = slot;
		}
	});
	for (const [id, entry] of state.panels)
		if (!seen.has(id)) {
			entry.wrapper.dispose();
			state.panels.delete(id);
		}

	// Room: the panels' guides (with the row titles on the right), the group's own guides.
	const panelsRoom = group.room();
	const rowTitleRoom = marginTitled ? ROW_TITLE_GAP + titleSize * 1.2 : 0;
	const panelRoom: SideRoom =
		rowTitleRoom > 0
			? { ...panelsRoom, right: panelsRoom.right + rowTitleRoom }
			: panelsRoom;
	const guideOptions: GroupGuideOptions = {
		title: props.title,
		titleFontSize: props.titleFontSize,
		xLabel: props.xLabel,
		yLabel: props.yLabel,
		axisLabelFontSize: props.axisLabelFontSize,
		legend: props.legend,
		legendWidth: props.width,
		legendTitle: props.legendTitle,
		legendFontSize: props.legendFontSize,
		sizeLegend: props.sizeLegend,
		colorbar: props.colorbar,
		colorbarLabel: props.colorbarLabel,
	};
	// The keys on the right stack within the grid of plots' height.
	const first = state.guides.measure(group, guideOptions, theme);
	guideOptions.keysHeight =
		props.autosize !== "contain"
			? props.height
			: props.height -
				panelRoom.top -
				panelRoom.bottom -
				first.vertical.top -
				first.vertical.bottom;
	const measured =
		first.sizeKeys.length > 0
			? state.guides.measure(group, guideOptions, theme)
			: first;
	/**
	 * The room above the plots of the rows below the first: with the rows titled in the
	 * margin only the top row carries (column) titles, so the gaps between rows leave room
	 * for what the lower panels draw there.
	 */
	let innerTop = panelsRoom.top;
	if (marginTitled) {
		innerTop = 0;
		for (const panel of group.panels())
			if (panel.place && panel.place.row > 0)
				innerTop = Math.max(innerTop, panel.state.room.top);
	}
	const given = props.gap;
	const spacing =
		typeof given === "number"
			? { x: given, y: given }
			: { x: given?.x ?? DEFAULT_GAP, y: given?.y ?? DEFAULT_GAP_Y };
	const own = measured.room;
	const outer: SideRoom =
		props.autosize === "pad"
			? { left: 0, right: 0, top: 0, bottom: 0 }
			: props.autosize !== "contain"
				? { left: 0, right: panelRoom.right + own.right, top: 0, bottom: 0 }
				: {
						left: panelRoom.left + own.left,
						right: panelRoom.right + own.right,
						top: panelRoom.top + own.top,
						bottom: panelRoom.bottom + own.bottom,
					};
	const free = (axis: "x" | "y") => {
		const space = props.space ?? "fixed";
		return typeof space === "string"
			? space === "free"
			: space[axis] === "free";
	};
	// Column widths and row heights: given, or by the panels' longest ranges with `space="free"`.
	const ratios = {
		widths:
			props.widths ??
			(free("x") ? spanRatios(group.panels(), "x", layout.columns) : undefined),
		heights:
			props.heights ??
			(free("y") ? spanRatios(group.panels(), "y", layout.rows) : undefined),
	};
	if (
		sameRatios(ratios.widths, state.ratios.widths) &&
		sameRatios(ratios.heights, state.ratios.heights)
	)
		Object.assign(ratios, state.ratios);
	state.ratios = ratios;
	const grid = facetGrid({
		widthRatios: ratios.widths,
		heightRatios: ratios.heights,
		rows: layout.rows,
		columns: layout.columns,
		width: props.width,
		height: props.height,
		center: props.center,
		// Independent axes write numbers on every panel: leave them room.
		gapX:
			spacing.x + (state.stacked.y ? 0 : panelsRoom.left + panelsRoom.right),
		gapY: spacing.y + innerTop + (state.stacked.x ? 0 : panelsRoom.bottom),
		outer,
	});

	const overall = props.progress ?? 1;
	const panelsEnd = measured.guided ? PANELS_END_WITH_GUIDES : 1;
	const panels = clamp01(overall / panelsEnd);
	const legendProgress =
		panelsEnd >= 1 ? 1 : clamp01((overall - panelsEnd) / (1 - panelsEnd));
	const xFar = (props.xAxis?.position ?? props.axis?.position) === "top";
	const yFar = (props.yAxis?.position ?? props.axis?.position) === "right";

	const children: SceneNode[] = [];
	layout.slots.forEach((slot, i) => {
		const entry = state.panels.get(ids[i] as string) as PanelEntry;
		const cell = grid.cells[slot.row]?.[slot.column];
		if (!cell) return;
		const panel: FacetPanel<AnyDatum> = {
			data: entry.data,
			to: entry.to,
			row: slot.rowKey,
			column: slot.columnKey,
			index: slot.index,
		};
		let title: string | undefined;
		if (props.panelTitle === false) title = undefined;
		else if (props.panelTitle) title = props.panelTitle(panel);
		else if (marginTitled)
			// The row is titled in the margin; the column over the top row.
			title =
				slot.row === 0 && slot.columnKey !== undefined
					? String(slot.columnKey)
					: undefined;
		else {
			const parts = [slot.rowKey, slot.columnKey].filter(
				(key) => key !== undefined,
			);
			title = parts.length > 0 ? parts.join(" · ") : undefined;
		}
		/** Shared axes write their numbers on the grid's outer edge only. */
		const showX =
			!state.stacked.x ||
			outerEdge(slot, layout.slots, xFar ? "top" : "bottom");
		const showY =
			!state.stacked.y ||
			outerEdge(slot, layout.slots, yFar ? "right" : "left");
		entry.plot.update({
			width: cell.width,
			height: cell.height,
			center: cell.center,
			autosize: "pad",
			legend: false,
			xRange: props.xRange,
			yRange: props.yRange,
			axis: props.axis,
			xAxis: showX ? props.xAxis : { ...props.xAxis, numbers: false },
			yAxis: showY ? props.yAxis : { ...props.yAxis, numbers: false },
			grid: props.grid,
			gridColor: props.gridColor,
			clip: props.clip,
			reveal: props.reveal,
			tip: props.tip,
			title,
			titleFontSize: titleSize,
			progress: panelProgress(
				panels,
				slot.index,
				layout.slots.length,
				props.stagger,
			),
			zIndex: props.zIndex,
			visible: props.visible,
		} as never);
		children.push(entry.wrapper);
	});

	// The row titles, in the right margin, reading downward (as seaborn and ggplot write them).
	const titledRows = marginTitled ? rowKeys : [];
	state.rowTitles = ctx.list("rowTitles", titledRows, {
		create: () => label.create({ text: "" }),
	});
	titledRows.forEach((key, index) => {
		const cell = grid.cells[index]?.[layout.columns - 1];
		const node = state.rowTitles[index] as SceneNode;
		node.update({
			text: props.rowTitle?.(key, index) ?? String(key),
			x:
				grid.plots.maxX +
				panelsRoom.right +
				ROW_TITLE_GAP +
				halfLine(titleSize),
			y: cell?.center.y ?? 0,
			rotation: -Math.PI / 2,
			fontSize: titleSize,
			color: theme.palette.foreground,
			zIndex: props.zIndex,
			visible: props.visible !== false && cell !== undefined,
			progress: clamp01(panels / 0.5),
		} as never);
		children.push(node);
	});

	children.push(
		...state.guides.draw(
			group,
			guideOptions,
			measured,
			{
				plots: grid.plots,
				panelRoom,
				frameProgress: clamp01(panels / 0.5),
				legendProgress,
				zIndex: props.zIndex,
				visible: props.visible,
			},
			theme,
		),
	);
	return children;
}

/**
 * Small multiples: `data` split by `row` and/or `column`, one `chart` per panel whose layers
 * `panel(info)` builds. Panels share scales by default (see `scales`), one colour scale and one
 * legend, so they compare directly.
 *
 * @example
 * ```ts
 * import { facet, scatter } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ site: "coast", temp: 14, rain: 80 },
 * 	{ site: "coast", temp: 18, rain: 60 },
 * 	{ site: "hills", temp: 9, rain: 120 },
 * 	{ site: "hills", temp: 13, rain: 95 },
 * ];
 * facet.create({
 * 	data: rows,
 * 	column: "site",
 * 	width: 9,
 * 	height: 3,
 * 	panel: (panel) => [scatter.create({ data: panel.data, x: "temp", y: "rain" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#multiple-views
 * @category Charts
 */
export const facet = defineComposite<FacetProps<AnyDatum>>({
	name: "Facet",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		row: { invalidates: Invalidate.UPDATE },
		column: { invalidates: Invalidate.UPDATE },
		rows: { invalidates: Invalidate.UPDATE },
		columns: { invalidates: Invalidate.UPDATE },
		wrap: { invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		scales: { invalidates: Invalidate.NONE },
		widths: { invalidates: Invalidate.UPDATE },
		heights: { invalidates: Invalidate.UPDATE },
		space: { invalidates: Invalidate.UPDATE },
		gap: { invalidates: Invalidate.UPDATE },
		autosize: { invalidates: Invalidate.UPDATE },
		panelTitle: { invalidates: Invalidate.UPDATE },
		panelTitleFontSize: { invalidates: Invalidate.UPDATE },
		marginTitles: { invalidates: Invalidate.UPDATE },
		rowTitle: { invalidates: Invalidate.UPDATE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		axis: { invalidates: Invalidate.UPDATE },
		xAxis: { invalidates: Invalidate.UPDATE },
		yAxis: { invalidates: Invalidate.UPDATE },
		grid: { invalidates: Invalidate.UPDATE },
		gridColor: { invalidates: Invalidate.UPDATE },
		clip: { invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		tip: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		legend: { invalidates: Invalidate.UPDATE },
		legendTitle: { invalidates: Invalidate.UPDATE },
		legendFontSize: { invalidates: Invalidate.UPDATE },
		sizeLegend: { invalidates: Invalidate.UPDATE },
		colorbar: { invalidates: Invalidate.UPDATE },
		colorbarLabel: { invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		titleFontSize: { invalidates: Invalidate.UPDATE },
		xLabel: { invalidates: Invalidate.UPDATE },
		yLabel: { invalidates: Invalidate.UPDATE },
		axisLabelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		panel: { invalidates: Invalidate.UPDATE },
	},
	setup: setupFacet,
	update: (_changed, ctx) =>
		drawFacet(ctx, facetStates.get(ctx.node) as FacetState),
});
