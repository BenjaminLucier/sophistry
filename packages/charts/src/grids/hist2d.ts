/**
 * `hist2d`: a 2D histogram, drawn as one instances node of `rect`s (see
 * `cell-rects.ts`). Nonempty cells fade in in reading order.
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
import type { Range } from "@sophistry/core/geometry";
import type { MarkTransition } from "../batch.js";
import type { RampScaleProps } from "../color-norm.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel } from "../data/channels.js";
import { dateSinkContext, numberValues } from "../data/channels.js";
import type { Histogram2D } from "../math/histogram2d.js";
import { histogram2d } from "../math/histogram2d.js";
import type { AnyDatum } from "../props.js";
import { keyedMemo } from "../util.js";
import type { CellItem, CellRects } from "./cell-rects.js";
import { boxPlacement, cellBox, createCellRects } from "./cell-rects.js";
import { revealCells } from "./pcolormesh.js";
import { createRampCells } from "./ramp-cells.js";

/**
 * Props of {@link hist2d}.
 *
 * @category Charts
 */
export interface Hist2DProps<T = unknown> {
	/** One observation per datum; data with a non-finite `x` or `y` are dropped. */
	data: readonly T[];
	/** X position, in data units. */
	x: Channel<T, number>;
	/** Y position, in data units. */
	y: Channel<T, number>;
	/**
	 * Number of equal-width bins along x. Wins over an `xRange` step. Defaults to the count the
	 * step implies, else 10.
	 */
	xBins?: number;
	/**
	 * Number of equal-width bins along y. Wins over a `yRange` step. Defaults to the count the step
	 * implies, else 10.
	 */
	yBins?: number;
	/**
	 * `[min, max, step?]` spanned by the x bins, in data units; `step` is the bin width when
	 * `xBins` is not given. Defaults to the finite extent of the x values.
	 */
	xRange?: Range;
	/**
	 * `[min, max, step?]` spanned by the y bins, in data units; `step` is the bin width when
	 * `yBins` is not given. Defaults to the finite extent of the y values.
	 */
	yRange?: Range;
	/**
	 * Colour ramp (colormap name, CSS stops or function) sampled by each cell's count relative to
	 * the largest. Defaults to the theme's ramp (background to first series colour).
	 */
	ramp?: ColorRampSpec;
	/**
	 * Fraction of the reveal spent staggering the cells in reading order, 0..0.95. Defaults to 0.5
	 * (0 above 2000 cells).
	 */
	stagger?: number;
	/**
	 * How counts spread over the ramp: `"log"` (from the emptiest drawn cell), `"sqrt"` or
	 * `"symlog"` (from 0).
	 * @default "linear"
	 */
	rampScale?: RampScaleProps["rampScale"];
	/**
	 * The count at the ramp's low end. Under `rampScale="log"`, give a value below the emptiest
	 * cell (say 0.5) to lift every drawn cell off the floor. Defaults to 0 (the emptiest drawn
	 * cell's count under `"log"`).
	 */
	rampMin?: number;
	/** The count at the ramp's high end. Defaults to the fullest cell's. */
	rampMax?: number;
	/**
	 * How cells change colour when `data` changes: a tween or a spring; new
	 * cells fade in, emptied ones fade out. Omitted, changes are instant.
	 */
	transition?: MarkTransition;
	/** Cell outline. @default "none" */
	stroke?: string;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Fill opacity 0..1, on top of `opacity`. @default 1 */
	fillOpacity?: number;
	/** Reveal 0..1: cells fade in in reading order, top row first. @default 1 */
	progress?: number;
	/** Paint order. Defaults to `UNDER_AXES_Z_INDEX` (above the grid, under the axes). */
	zIndex?: number;
	/** Set to false to hide the cells. */
	visible?: boolean;
}

/** One nonempty bin. */
interface HistCell {
	xi: number;
	yi: number;
	count: number;
}

/** What a hist2d keeps between updates. */
interface Hist2DState {
	layer: ChartLayer;
	binned: (
		deps: readonly unknown[],
		make: () => { hist: Histogram2D; cells: HistCell[]; domain: number[] },
	) => { hist: Histogram2D; cells: HistCell[]; domain: number[] };
	ramp: ReturnType<typeof createRampCells<HistCell>>;
	placed: (deps: readonly unknown[], make: () => CellItem[]) => CellItem[];
	rects: CellRects;
}

const states = new WeakMap<object, Hist2DState>();

const countOf = (cell: HistCell) => cell.count;
const readingAt = (cell: HistCell) => ({ x: cell.xi, y: cell.yi });

function draw(ctx: CompositeContext<Hist2DProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as Hist2DState;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords) throw new Error("Hist2D must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const binned = state.binned(
		[
			props.data,
			props.x,
			props.y,
			props.xBins,
			props.yBins,
			props.xRange,
			props.yRange,
		],
		() => {
			const hist = histogram2d(
				numberValues(props.data, props.x, undefined, "x", dates),
				numberValues(props.data, props.y, undefined, "y", dates),
				{
					xBins: props.xBins,
					yBins: props.yBins,
					xRange: props.xRange,
					yRange: props.yRange,
				},
			);
			const cells: HistCell[] = [];
			hist.counts.forEach((row, yi) => {
				row.forEach((count, xi) => {
					if (count > 0) cells.push({ xi, yi, count });
				});
			});
			// Counts map from 0 to the fullest bin (0..1 with none).
			const domain = cells.length ? [0, ...cells.map((c) => c.count)] : [];
			return { hist, cells, domain };
		},
	);
	const { hist } = binned;
	const grid = state.ramp({
		layer: state.layer,
		coords,
		theme: ctx.theme,
		ramp: props.ramp,
		cells: binned.cells,
		value: countOf,
		at: readingAt,
		norm: {
			rampScale: props.rampScale,
			rampMin: props.rampMin,
			rampMax: props.rampMax,
		},
		domain: binned.domain,
		extent: { x: { values: hist.xEdges }, y: { values: hist.yEdges } },
		stagger: props.stagger,
		progress: props.progress,
	});
	const placed = state.placed(
		[grid.cells, coords, grid.colormap, grid.norm],
		() =>
			grid.cells.map((cell) => ({
				key: `${cell.xi}:${cell.yi}`,
				...boxPlacement(
					cellBox(
						coords,
						hist.xEdges[cell.xi] as number,
						hist.yEdges[cell.yi] as number,
						hist.xEdges[cell.xi + 1] as number,
						hist.yEdges[cell.yi + 1] as number,
					),
				),
				fill: grid.fill(cell),
				opacity: 1,
			})),
	);
	state.rects.update(
		revealCells(placed, grid, props.opacity),
		{
			stroke: props.stroke ?? "none",
			strokeWidth: props.strokeWidth,
			fillOpacity: props.fillOpacity,
			zIndex: props.zIndex ?? UNDER_AXES_Z_INDEX,
			visible: props.visible,
		},
		{ transition: props.transition, animate: (grid.progress ?? 1) >= 1 },
	);
	return [state.rects.node];
}

/**
 * A 2D histogram: points bucketed into a grid of equal-width cells, each nonempty cell coloured
 * by its count. Empty cells are not drawn. Paints under the axes by default (`zIndex`
 * `UNDER_AXES_Z_INDEX`). Inside a `chart` or `axes`; drawn as one instances node of
 * rectangles. See {@link histogram2d} for the binning alone.
 *
 * @example
 * ```ts
 * import { chart, hist2d } from "@sophistry/charts";
 *
 * const points = Array.from({ length: 200 }, (_, i) => ({ x: Math.sin(i) * 3, y: Math.cos(i * 0.7) * 2 }));
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	children: [hist2d.create({ data: points, x: "x", y: "y", xBins: 20, yBins: 12 })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const hist2d = defineComposite<Hist2DProps<AnyDatum>>({
	name: "Hist2D",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		xBins: { invalidates: Invalidate.UPDATE },
		yBins: { invalidates: Invalidate.UPDATE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMin: { invalidates: Invalidate.UPDATE },
		rampMax: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			binned: keyedMemo(),
			ramp: createRampCells<HistCell>(),
			placed: keyedMemo<CellItem[]>(),
			rects: createCellRects(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
