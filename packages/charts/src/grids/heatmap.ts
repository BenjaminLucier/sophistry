/**
 * `heatmap`: the annotated heatmap preset, a `chart` around a `cells` layer;
 * with `cluster`, a clustermap whose dendrograms stand in the chart's margin.
 * The nodes are made once and updated in place.
 */

import type {
	ColorRampSpec,
	CompositeContext,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { chart } from "../chart.js";
import type { RampScaleName } from "../color-norm.js";
import type { Channel } from "../data/channels.js";
import { numberValues, resolveChannel } from "../data/channels.js";
import type { ChartProps } from "../frame/types.js";
import type {
	ClusterLinkage,
	ClusterMetric,
	ClusterTree,
} from "../math/cluster.js";
import { clusterRows } from "../math/cluster.js";
import { uniqueKeys } from "../math/ordinal.js";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props.js";
import type { TooltipSpec } from "../tooltip.js";
import { keyedMemo } from "../util.js";
import type { CellsProps } from "./cells.js";
import { cells } from "./cells.js";
import type { DendrogramProps } from "./dendrogram.js";
import { dendrogram } from "./dendrogram.js";

/**
 * Props of {@link heatmap}.
 *
 * @category Charts
 */
export interface HeatmapProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One cell per datum. */
	data: readonly T[];
	/** The cell's column: a category. */
	x: Channel<T, BandKey>;
	/** The cell's row: a category. */
	y: Channel<T, BandKey>;
	/** The number the cell's colour encodes. */
	value: Channel<T, number>;
	/**
	 * Column order; clustered columns are reordered. Defaults to the order first seen in `data`.
	 */
	columns?: readonly BandKey[];
	/**
	 * Row order, top to bottom; clustered rows are reordered. Defaults to the order first seen in
	 * `data`.
	 */
	rows?: readonly BandKey[];
	/**
	 * Cluster the rows, the columns, or both (`true`) by their values ({@link clusterRows}), laid
	 * out in dendrogram order so similar ones sit together. Missing cells are skipped.
	 * @default false
	 */
	cluster?: boolean | "rows" | "columns";
	/**
	 * How clusters are compared; see {@link ClusterLinkage}.
	 * @default "average"
	 */
	linkage?: ClusterLinkage;
	/**
	 * How rows (columns) are compared; see {@link ClusterMetric}.
	 * @default "euclidean"
	 */
	metric?: ClusterMetric;
	/**
	 * Draw each clustering's {@link dendrogram} in the margin: the rows' on the left (row names
	 * move right), the columns' above the grid. Defaults to true when clustering.
	 */
	dendrogram?: boolean;
	/**
	 * How far a dendrogram's root stands from its leaves.
	 * @default 0.8
	 */
	dendrogramSize?: number;
	/** Width of the plotting area. */
	width: number;
	/** Height of the plotting area. */
	height: number;
	/** Centre of the plotting area. Defaults to the origin. */
	center?: Point;
	/** Colormap name, CSS stops, or `(t) => colour`. Defaults to the theme's ramp. */
	ramp?: ColorRampSpec;
	/** Value at the bottom of the ramp. Defaults to the smallest value. */
	rampMin?: number;
	/** Value at the top of the ramp. Defaults to the largest value. */
	rampMax?: number;
	/**
	 * How values spread over the ramp (`"log"`, `"symlog"`, `"sqrt"`).
	 * @default "linear"
	 */
	rampScale?: RampScaleName;
	/** A diverging centre: this value takes the ramp's middle. */
	rampMidpoint?: number;
	/**
	 * Write each value in its cell: `true`, `false`, or a channel for your own text.
	 * @default true
	 */
	labels?: boolean | Channel<T, string>;
	/** Font size of the cell text. */
	labelFontSize?: number;
	/** Title above the chart. */
	title?: string;
	/**
	 * A colour bar beside the grid.
	 * @default false
	 */
	colorbar?: boolean;
	/** A title above the colour bar. */
	colorbarLabel?: string;
	/** Title for the columns, placed past the right end of the x axis. */
	xLabel?: string;
	/** Title for the rows, placed above the y axis. */
	yLabel?: string;
	/**
	 * Reveal, 0..1: names first, then the cells in reading order.
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the cells' reveal spent staggering, 0..0.95.
	 * @default 0.5
	 */
	stagger?: number;
	/** Hover tooltip: `true` for "column · row: value", or `(d, i) => string`. */
	tooltip?: TooltipSpec<T>;
	/** Paint order of the chart; the cells paint under its guides. */
	zIndex?: number;
	/** Set to false to hide the heatmap. */
	visible?: boolean;
	/** Placed inside the chart's coordinate context, after the cells. */
	children?: readonly SceneNode[];
	/**
	 * Each cell's identity across transitions. See {@link KeyedTransitionProps}. Defaults to its
	 * (column, row) pair.
	 */
	key?: Channel<T, BandKey>;
	/**
	 * The data to transition to, cells matched by `key`: colours blend, unmatched cells fade,
	 * fitted columns and rows blend. Throws together with `cluster`. See {@link
	 * KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
}

/** Row and column keys in their given (or first-seen) order, and the value matrix over them. */
interface Grid {
	rows: BandKey[];
	columns: BandKey[];
	matrix: number[][];
}

/** What a heatmap keeps between updates. */
interface HeatmapState {
	frame: SceneNode<ChartProps>;
	cells: SceneNode<CellsProps<AnyDatum>>;
	rowTree: SceneNode<DendrogramProps>;
	columnTree: SceneNode<DendrogramProps>;
	grid: (
		deps: readonly unknown[],
		make: () => Grid | undefined,
	) => Grid | undefined;
	trees: (
		deps: readonly unknown[],
		make: () => { rows?: ClusterTree; columns?: ClusterTree },
	) => { rows?: ClusterTree; columns?: ClusterTree };
}

const states = new WeakMap<object, HeatmapState>();

/** A clustering's dendrogram node, filled in by `draw`. */
function makeTree(
	axis: "x" | "y",
	side: "left" | "top",
): SceneNode<DendrogramProps> {
	return dendrogram.create({
		tree: null,
		categories: [],
		axis,
		side,
	}) as SceneNode<DendrogramProps>;
}

function draw(ctx: CompositeContext<HeatmapProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as HeatmapState;
	const props = ctx.props;
	if (props.cluster && props.to !== undefined)
		throw new Error(
			"Heatmap: `to` cannot be combined with `cluster` (each end's clustering would order the grid its own way).",
		);
	const grid = state.grid(
		[
			props.cluster,
			props.data,
			props.x,
			props.y,
			props.value,
			props.columns,
			props.rows,
		],
		() => {
			if (!props.cluster) return undefined;
			const x = resolveChannel<unknown, BandKey>(
				props.x as Channel<unknown, BandKey>,
				undefined,
				"x",
			);
			const y = resolveChannel<unknown, BandKey>(
				props.y as Channel<unknown, BandKey>,
				undefined,
				"y",
			);
			const values = numberValues(props.data, props.value, undefined, "value");
			const xs = props.data.map((d, i) => x(d, i) as BandKey);
			const ys = props.data.map((d, i) => y(d, i) as BandKey);
			const columns = props.columns ? [...props.columns] : uniqueKeys(xs);
			const rows = props.rows ? [...props.rows] : uniqueKeys(ys);
			const column = new Map<BandKey, number>(columns.map((k, i) => [k, i]));
			const row = new Map<BandKey, number>(rows.map((k, i) => [k, i]));
			// The mean of the cells at each (row, column); NaN where there are none.
			const sums = rows.map(() => columns.map(() => 0));
			const counts = rows.map(() => columns.map(() => 0));
			values.forEach((v, i) => {
				const r = row.get(ys[i] as BandKey);
				const c = column.get(xs[i] as BandKey);
				if (r === undefined || c === undefined || !Number.isFinite(v)) return;
				(sums[r] as number[])[c] = ((sums[r] as number[])[c] as number) + v;
				(counts[r] as number[])[c] = ((counts[r] as number[])[c] as number) + 1;
			});
			const matrix = sums.map((line, r) =>
				line.map((sum, c) => {
					const n = (counts[r] as number[])[c] as number;
					return n > 0 ? sum / n : Number.NaN;
				}),
			);
			return { rows, columns, matrix };
		},
	);
	const trees = state.trees(
		[grid, props.cluster, props.linkage, props.metric],
		() => {
			if (!grid) return {};
			const options = { linkage: props.linkage, metric: props.metric };
			return {
				rows:
					props.cluster === "columns"
						? undefined
						: clusterRows(grid.matrix, options),
				columns:
					props.cluster === "rows"
						? undefined
						: clusterRows(
								grid.columns.map((_, c) =>
									grid.matrix.map((line) => line[c] as number),
								),
								options,
							),
			};
		},
	);
	const rowOrder =
		grid && trees.rows
			? trees.rows.order.map((i) => grid.rows[i] as BandKey)
			: props.rows;
	const columnOrder =
		grid && trees.columns
			? trees.columns.order.map((i) => grid.columns[i] as BandKey)
			: props.columns;
	const drawRows = props.dendrogram !== false && trees.rows !== undefined;
	const drawColumns = props.dendrogram !== false && trees.columns !== undefined;

	state.cells.update({
		data: props.data,
		x: props.x,
		y: props.y,
		value: props.value,
		ramp: props.ramp,
		rampMin: props.rampMin,
		rampMax: props.rampMax,
		rampScale: props.rampScale,
		rampMidpoint: props.rampMidpoint,
		labels: props.labels ?? true,
		labelFontSize: props.labelFontSize,
		stagger: props.stagger,
		tooltip: props.tooltip,
		// Under the chart's own names at any `zIndex`, as `cells` is by default.
		zIndex:
			props.zIndex === undefined
				? undefined
				: props.zIndex + UNDER_AXES_Z_INDEX,
		visible: props.visible,
		key: props.key,
		to: props.to,
		blend: props.blend,
		staging: props.staging,
		enterStagger: props.enterStagger,
	});
	const tree = (
		node: SceneNode<DendrogramProps>,
		own: ClusterTree | undefined,
		categories: readonly BandKey[],
	) =>
		node.update({
			tree: own?.root,
			categories,
			size: props.dendrogramSize,
			zIndex: props.zIndex,
			visible: props.visible,
		});
	// A tree dropped from the chart's children was disposed: make a new one.
	if (drawRows) {
		if (state.rowTree.disposed) state.rowTree = makeTree("y", "left");
		tree(state.rowTree, trees.rows, grid?.rows ?? []);
	}
	if (drawColumns) {
		if (state.columnTree.disposed) state.columnTree = makeTree("x", "top");
		tree(state.columnTree, trees.columns, grid?.columns ?? []);
	}

	state.frame.update({
		width: props.width,
		height: props.height,
		center: props.center,
		xAxis: { scale: "band", categories: columnOrder, line: false },
		yAxis: {
			scale: "band",
			categories: rowOrder,
			line: false,
			// The rows' dendrogram takes the left margin.
			position: drawRows ? "right" : undefined,
		},
		title: props.title,
		colorbar: props.colorbar,
		colorbarLabel: props.colorbarLabel,
		xLabel: props.xLabel,
		yLabel: props.yLabel,
		progress: props.progress,
		zIndex: props.zIndex,
		visible: props.visible,
		children: [
			state.cells,
			...(drawRows ? [state.rowTree] : []),
			...(drawColumns ? [state.columnTree] : []),
			...ctx.children,
		],
	});
	return [state.frame];
}

/**
 * An annotated heatmap: a value per (column, row) pair, coloured through a ramp and written in
 * its cell in a colour that reads on it. With `cluster`, a clustermap with dendrograms in the
 * margin. A preset over `chart` and {@link cells}; use those to add other marks.
 *
 * @example
 * ```ts
 * import { heatmap } from "@sophistry/charts";
 *
 * const correlations = [
 * 	{ a: "x", b: "x", r: 1 },
 * 	{ a: "x", b: "y", r: -0.4 },
 * 	{ a: "y", b: "x", r: -0.4 },
 * 	{ a: "y", b: "y", r: 1 },
 * ];
 * heatmap.create({
 * 	width: 6,
 * 	height: 4,
 * 	data: correlations,
 * 	x: "a",
 * 	y: "b",
 * 	value: "r",
 * 	ramp: "rdbu",
 * 	rampMidpoint: 0,
 * 	cluster: true,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const heatmap = defineComposite<HeatmapProps<AnyDatum>>({
	name: "Heatmap",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		columns: { invalidates: Invalidate.UPDATE },
		rows: { invalidates: Invalidate.UPDATE },
		cluster: { invalidates: Invalidate.UPDATE },
		linkage: { invalidates: Invalidate.UPDATE },
		metric: { invalidates: Invalidate.UPDATE },
		dendrogram: { invalidates: Invalidate.UPDATE },
		dendrogramSize: { invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		rampMin: { invalidates: Invalidate.UPDATE },
		rampMax: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMidpoint: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		colorbar: { invalidates: Invalidate.UPDATE },
		colorbarLabel: { invalidates: Invalidate.UPDATE },
		xLabel: { invalidates: Invalidate.UPDATE },
		yLabel: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.NONE },
		key: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			frame: chart.create({ width: 8, height: 4 }) as SceneNode<ChartProps>,
			cells: cells.create({ data: [], x: "x", y: "y" }) as SceneNode<
				CellsProps<AnyDatum>
			>,
			rowTree: makeTree("y", "left"),
			columnTree: makeTree("x", "top"),
			grid: keyedMemo(),
			trees: keyedMemo(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
