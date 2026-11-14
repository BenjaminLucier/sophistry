/**
 * A scatter-plot matrix: every pair of variables against each other, with
 * each variable's distribution on the diagonal. One `chart` per panel in
 * one group: columns share x, rows share y.
 */

import type { CompositeContext, ContextKey, SceneNode } from "@sophistry/core";
import {
	createContextKey,
	DOWN,
	defineComposite,
	Invalidate,
	text,
} from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { anchoredLabelProps, clamp01 } from "@sophistry/core/internal";
import { bin } from "../bars/transforms.js";
import { density } from "../curves/density.js";
import type { Channel } from "../data/channels.js";
import { AXIS_LABEL_GAP, halfLine } from "../frame/guide-metrics.js";
import { secondaryY } from "../frame/secondary-axes.js";
import type { ChartAxisOptions, ChartColorOptions } from "../frame/types.js";
import type { FacetSlot } from "../math/facet.js";
import { facetGrid, outerEdge, panelProgress } from "../math/facet.js";
import { rects } from "../points/rects.js";
import { scatter } from "../points/scatter.js";
import type { AnyDatum } from "../props.js";
import { shallowEqual } from "../util.js";
import type { ChartGroup, GroupMember } from "./chart-group.js";
import { createChartGroup, sameRatios, spanRatios } from "./chart-group.js";
import type { FacetSpace } from "./facet.js";
import type { GroupGuideOptions, GroupGuides } from "./group-guides.js";
import { createGroupGuides, PANELS_END_WITH_GUIDES } from "./group-guides.js";
import type { PanelNodes } from "./panels.js";
import { makePanel, outerRoom, watchGroup } from "./panels.js";

const DEFAULT_GAP = 0.35;
const DEFAULT_VAR_LABEL_FONT_SIZE = 0.3;
const HISTOGRAM_OPACITY = 0.55;

/**
 * An off-diagonal panel of a {@link pairPlot}, as `offDiagonal` receives it.
 *
 * @category Charts
 */
export interface PairPanel<T> {
	/** Every row. */
	data: readonly T[];
	/** The variable on this panel's x axis (its column's). */
	x: string;
	/** The variable on its y axis (its row's). */
	y: string;
	/** Grid row, from the top. */
	row: number;
	/** Grid column, from the left. */
	column: number;
}

/**
 * Props for {@link pairPlot}.
 *
 * @category Charts
 */
export interface PairPlotProps<T> {
	/** The rows. */
	data: readonly T[];
	/** The numeric fields to pair, in order: the matrix's rows (top to bottom) and columns (left to right). */
	variables: readonly string[];
	/** A variable's title under its column and beside its row. Defaults to its name. */
	variableLabels?: Partial<Record<string, string>>;
	/** Splits the points and the diagonal's densities by category, one colour each, keyed by one legend. */
	series?: Channel<T, BandKey>;
	/** The points' identity channel, as `scatter`'s `key`. */
	key?: Channel<T, BandKey>;
	/** Width of the matrix of plots (a legend fits inside; see `autosize`). */
	width: number;
	/** Height of the matrix of plots. */
	height: number;
	/** Centre of the matrix. Defaults to the origin. */
	center?: Point;
	/**
	 * Space between neighbouring panels.
	 * @default 0.35
	 */
	gap?: number;
	/** Relative column widths, left to right (one per variable), as `facet`'s `widths`. */
	widths?: readonly number[];
	/** Relative row heights, top to bottom, as `facet`'s `heights`. */
	heights?: readonly number[];
	/**
	 * `"free"` sizes each column and row by its variable's range (or per axis), so one unit is one
	 * length across the matrix. As `facet`'s `space`; `widths`/`heights` win.
	 * @default "fixed"
	 */
	space?: FacetSpace;
	/**
	 * What the diagonal draws: `"density"` (one curve per series), `"histogram"` (bins of the whole
	 * sample), or `false` for nothing.
	 * @default "density"
	 */
	diag?: "density" | "histogram" | false;
	/** Histogram diagonal: how many bins. */
	binCount?: number;
	/**
	 * Draw only the lower triangle and the diagonal. Read once, at creation.
	 * @default false
	 */
	corner?: boolean;
	/**
	 * Marker radius.
	 * @default 0.05
	 */
	radius?: number;
	/**
	 * Draws an off-diagonal panel's layers instead of the default scatter: a function returning
	 * layer nodes, called when the panel is made and when `data` changes. A plain value prop; the
	 * bindings pass it through untouched.
	 */
	offDiagonal?: (panel: PairPanel<T>) => readonly SceneNode[];
	/** Every panel's axes (tick options, `nice`, `zero`, ...). */
	axis?: ChartAxisOptions;
	grid?: boolean | "x" | "y";
	/**
	 * As `chart`'s `autosize`, over the whole matrix.
	 * @default "fit"
	 */
	autosize?: "fit" | "pad" | "contain";
	color?: ChartColorOptions;
	/**
	 * One legend: on the right (`true`, `"right"`) or in a row over the matrix (`"top"`).
	 * On the right by default when `series` is given.
	 */
	legend?: boolean | "right" | "top";
	legendTitle?: string;
	legendFontSize?: number;
	title?: string;
	titleFontSize?: number;
	/**
	 * Font size of the variables' titles.
	 * @default 0.3
	 */
	labelFontSize?: number;
	/**
	 * Reveal, 0..1: every panel's frame, then the data (see `stagger`), then the legend.
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
}

/** A pair-plot slot: its grid place and the variables on its axes. */
interface PairSlot extends FacetSlot {
	xVar: string;
	yVar: string;
}

/** Why the matrix reruns: its group published something. */
const GROUP_LAYOUT: ContextKey<unknown> = createContextKey("pairPlotGroup");

interface PairState {
	group: ChartGroup;
	guides: GroupGuides;
	corner: boolean;
	/** One phantom member per variable, reporting its raw extent on both axes. */
	phantoms: Map<string, GroupMember>;
	panels: Map<string, PanelNodes & { deps: readonly unknown[] }>;
	ratios: { widths?: readonly number[]; heights?: readonly number[] };
}

const pairStates = new WeakMap<object, PairState>();
const variableKey = (name: string) => `v:${name}`;
const slotId = (slot: PairSlot) =>
	`${slot.row}:${slot.column}:${slot.xVar}:${slot.yVar}`;

/** A panel's layers: the diagonal's distribution on a secondary axis, else a scatter (or `offDiagonal`). */
function panelLayers(
	props: PairPlotProps<AnyDatum>,
	slot: PairSlot,
): readonly SceneNode[] {
	const read = (name: string) => (d: AnyDatum) =>
		Number((d as Record<string, unknown>)[name]);
	if (slot.row !== slot.column) {
		if (props.offDiagonal)
			return props.offDiagonal({
				data: props.data,
				x: slot.xVar,
				y: slot.yVar,
				row: slot.row,
				column: slot.column,
			});
		return [
			scatter.create({
				data: props.data,
				x: read(slot.xVar),
				y: read(slot.yVar),
				series: props.series,
				key: props.key,
				radius: props.radius ?? 0.05,
			} as never),
		];
	}
	const diag = props.diag ?? "density";
	if (diag === false) return [];
	const layer =
		diag === "density"
			? density.create({
					data: props.data,
					x: read(slot.xVar),
					series: props.series,
					commonNorm: true,
				} as never)
			: rects.create({
					data: bin(props.data, {
						x: read(slot.xVar),
						binCount: props.binCount,
					}),
					x1: "x1",
					x2: "x2",
					y1: () => 0,
					y2: "y",
					fillOpacity: HISTOGRAM_OPACITY,
				} as never);
	return [secondaryY.create({ children: [layer] } as never)];
}

function drawPairPlot(
	ctx: CompositeContext<PairPlotProps<AnyDatum>>,
	state: PairState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const group = state.group;
	group.setOptions({ color: props.color, palette: theme.palette.series });
	const variables = props.variables ?? [];
	const n = variables.length;

	// One phantom panel per variable reports its raw extent on both axes, so every row and
	// column fits its data — even one with only a diagonal panel (a corner matrix's first row
	// and last column), whose density follows the fit rather than adding its tails to it.
	/** A variable's finite extremes: all a fit reads, and cheap to compare. */
	const values = (name: string) => {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const d of props.data) {
			const value = Number((d as Record<string, unknown>)[name]);
			if (!Number.isFinite(value)) continue;
			if (value < min) min = value;
			if (value > max) max = value;
		}
		return min <= max ? [min, max] : [];
	};
	for (const [name, member] of state.phantoms)
		if (!variables.includes(name)) {
			member.dispose();
			state.phantoms.delete(name);
		}
	for (const name of variables) {
		let member = state.phantoms.get(name);
		if (!member) {
			member = group.join(
				{ keys: { x: variableKey(name), y: variableKey(name) } },
				() => {},
			);
			state.phantoms.set(name, member);
		}
		const extent = { values: values(name) };
		member.publishReports([{ x: extent, y: extent }]);
	}

	const slots: PairSlot[] = [];
	variables.forEach((yVar, row) => {
		variables.forEach((xVar, column) => {
			if (state.corner && column > row) return;
			slots.push({ index: slots.length, row, column, xVar, yVar });
		});
	});
	const seen = new Set<string>();
	for (const slot of slots) {
		const id = slotId(slot);
		seen.add(id);
		const deps = [
			props.data,
			props.series,
			props.key,
			props.radius,
			props.diag,
			props.binCount,
			props.offDiagonal,
		];
		const entry = state.panels.get(id);
		if (!entry) {
			const diagonal = slot.row === slot.column;
			const panel = makePanel(
				{
					group,
					keys: {
						x: variableKey(slot.xVar),
						y: variableKey(slot.yVar),
						// The diagonal's density follows its column's x fit; it has no y of its
						// own (the density is on the secondary axis).
						follows: diagonal ? { x: true, y: true } : undefined,
					},
					place: { row: slot.row, column: slot.column },
				},
				panelLayers(props, slot),
			);
			state.panels.set(id, { ...panel, deps });
		} else if (!shallowEqual(entry.deps, deps)) {
			entry.plot.set("children" as never, panelLayers(props, slot) as never);
			entry.deps = deps;
		}
	}
	for (const [id, entry] of state.panels)
		if (!seen.has(id)) {
			entry.wrapper.dispose();
			state.panels.delete(id);
		}

	const labelSize = props.labelFontSize ?? DEFAULT_VAR_LABEL_FONT_SIZE;
	const guideOptions: GroupGuideOptions = {
		title: props.title,
		titleFontSize: props.titleFontSize,
		legend: props.legend,
		legendWidth: props.width,
		legendTitle: props.legendTitle,
		legendFontSize: props.legendFontSize,
	};
	const measured = state.guides.measure(group, guideOptions, theme);
	const panelsRoom = group.room();
	/** The variables' titles under the bottom row and left of the left column. */
	const varRoom = AXIS_LABEL_GAP + labelSize * 1.2;
	const own = measured.room;
	const outer = outerRoom(props.autosize, panelsRoom, own, {
		left: panelsRoom.left + varRoom,
		right: panelsRoom.right + own.right,
		top: panelsRoom.top + own.top,
		bottom: panelsRoom.bottom + varRoom,
	});
	const free = (axis: "x" | "y") => {
		const space = props.space ?? "fixed";
		return typeof space === "string"
			? space === "free"
			: space[axis] === "free";
	};
	const ratios = {
		widths:
			props.widths ??
			(free("x") ? spanRatios(group.panels(), "x", n) : undefined),
		heights:
			props.heights ??
			(free("y") ? spanRatios(group.panels(), "y", n) : undefined),
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
		rows: n,
		columns: n,
		width: props.width,
		height: props.height,
		center: props.center,
		gapX: props.gap ?? DEFAULT_GAP,
		gapY: props.gap ?? DEFAULT_GAP,
		outer,
	});

	const overall = props.progress ?? 1;
	const panelsEnd = measured.guided ? PANELS_END_WITH_GUIDES : 1;
	const panels = clamp01(overall / panelsEnd);
	const legendProgress =
		panelsEnd >= 1 ? 1 : clamp01((overall - panelsEnd) / (1 - panelsEnd));
	const frameProgress = clamp01(panels / 0.5);

	const children: SceneNode[] = [];
	for (const slot of slots) {
		const entry = state.panels.get(slotId(slot)) as PanelNodes;
		const cell = grid.cells[slot.row]?.[slot.column];
		if (!cell) continue;
		const diagonal = slot.row === slot.column;
		entry.plot.update({
			width: cell.width,
			height: cell.height,
			center: cell.center,
			autosize: "pad",
			legend: false,
			axis: props.axis,
			xAxis: { numbers: outerEdge(slot, slots, "bottom") ? undefined : false },
			yAxis: { numbers: outerEdge(slot, slots, "left") ? undefined : false },
			y2Axis: { visible: false },
			grid: props.grid,
			clip: diagonal,
			progress: panelProgress(panels, slot.index, slots.length, props.stagger),
			zIndex: props.zIndex,
			visible: props.visible,
		} as never);
		children.push(entry.wrapper);
	}

	// The variables' names: under the bottom row, left of the left column.
	const name = (variable: string) =>
		props.variableLabels?.[variable] ?? variable;
	const bottoms = ctx.list("bottomLabels", variables, {
		create: () => text.create({ text: "" }),
	});
	const lefts = ctx.list("leftLabels", variables, {
		create: () => text.create({ text: "" }),
	});
	variables.forEach((variable, index) => {
		const bottom = grid.cells[n - 1]?.[index];
		const left = grid.cells[index]?.[0];
		if (!bottom || !left) return;
		const under = bottoms[index] as SceneNode;
		under.update({
			...anchoredLabelProps(
				{
					text: name(variable),
					at: { x: bottom.center.x, y: bottom.center.y - bottom.height / 2 },
					direction: DOWN,
					gap: AXIS_LABEL_GAP + panelsRoom.bottom,
					fontSize: labelSize,
					color: theme.palette.foreground,
					zIndex: props.zIndex,
					progress: frameProgress,
				},
				theme.defaults.fontFamily,
				under.get("place" as never),
			),
			visible: props.visible,
		} as never);
		const beside = lefts[index] as SceneNode;
		beside.update({
			text: name(variable),
			x:
				left.center.x -
				left.width / 2 -
				panelsRoom.left -
				AXIS_LABEL_GAP -
				halfLine(labelSize),
			y: left.center.y,
			rotation: Math.PI / 2,
			fontSize: labelSize,
			color: theme.palette.foreground,
			zIndex: props.zIndex,
			visible: props.visible,
			progress: frameProgress,
		} as never);
		children.push(under, beside);
	});

	children.push(
		...state.guides.draw(
			group,
			guideOptions,
			measured,
			{
				plots: grid.plots,
				panelRoom: panelsRoom,
				frameProgress,
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
 * A pair plot (scatter-plot matrix): panel (row `i`, column `j`) plots `variables[j]` against
 * `variables[i]`, and the diagonal shows each variable's distribution. Columns share x scales
 * and rows share y scales, so a point lines up across the matrix; a `series` is one colour
 * everywhere with one legend.
 *
 * @example
 * ```ts
 * import { pairPlot } from "@sophistry/charts";
 *
 * const flowers = [
 * 	{ kind: "iris", petal: 1.4, sepal: 5.1, width: 3.5 },
 * 	{ kind: "iris", petal: 1.3, sepal: 4.9, width: 3 },
 * 	{ kind: "lily", petal: 4.7, sepal: 7, width: 3.2 },
 * 	{ kind: "lily", petal: 4.5, sepal: 6.4, width: 3.2 },
 * ];
 * pairPlot.create({
 * 	data: flowers,
 * 	variables: ["petal", "sepal", "width"],
 * 	series: "kind",
 * 	width: 6,
 * 	height: 6,
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#multiple-views
 * @category Charts
 */
export const pairPlot = defineComposite<PairPlotProps<AnyDatum>>({
	name: "PairPlot",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		variables: { default: [], invalidates: Invalidate.UPDATE },
		variableLabels: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		width: { default: 6, invalidates: Invalidate.UPDATE },
		height: { default: 6, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		gap: { invalidates: Invalidate.UPDATE },
		widths: { invalidates: Invalidate.UPDATE },
		heights: { invalidates: Invalidate.UPDATE },
		space: { invalidates: Invalidate.UPDATE },
		diag: { invalidates: Invalidate.UPDATE },
		binCount: { invalidates: Invalidate.UPDATE },
		corner: { invalidates: Invalidate.NONE },
		radius: { invalidates: Invalidate.UPDATE },
		offDiagonal: { invalidates: Invalidate.UPDATE },
		axis: { invalidates: Invalidate.UPDATE },
		grid: { invalidates: Invalidate.UPDATE },
		autosize: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		legend: { invalidates: Invalidate.UPDATE },
		legendTitle: { invalidates: Invalidate.UPDATE },
		legendFontSize: { invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		titleFontSize: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: PairState = {
			group: createChartGroup(),
			guides: createGroupGuides(),
			corner: ctx.props.corner === true,
			phantoms: new Map(),
			panels: new Map(),
			ratios: {},
		};
		pairStates.set(ctx.node, state);
		watchGroup(ctx, state.group, GROUP_LAYOUT);
		ctx.onDispose(() => state.guides.dispose());
		return drawPairPlot(ctx, state);
	},
	update: (_changed, ctx) =>
		drawPairPlot(ctx, pairStates.get(ctx.node) as PairState),
});
