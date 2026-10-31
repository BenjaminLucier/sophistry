/**
 * `pcolormesh`: a coloured mesh over a rectilinear grid, drawn as one
 * instances node of `rect`s (see `cell-rects.ts`). Cells fade in in reading
 * order (`stagger`, dropped above 2,000 cells), through each item's opacity.
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
import type { MarkTransition } from "../batch";
import type { RampScaleProps } from "../color-norm";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { PcolormeshCell, PcolormeshResult } from "../math/pcolormesh";
import { pcolormeshCells } from "../math/pcolormesh";
import { keyedMemo } from "../util";
import type { CellItem, CellRects } from "./cell-rects";
import { boxPlacement, cellBox, createCellRects } from "./cell-rects";
import type { RampCells } from "./ramp-cells";
import { createRampCells } from "./ramp-cells";

/**
 * Props of {@link pcolormesh}.
 *
 * @category Charts
 */
export interface PcolormeshProps extends RampScaleProps {
	/** `ncols` centres or `ncols + 1` edges of the columns, in data units. */
	xs: readonly number[];
	/** `nrows` centres or `nrows + 1` edges of the rows, in data units. */
	ys: readonly number[];
	/** Rows × columns of values; ragged rows are tolerated. */
	values: readonly (readonly number[])[];
	/**
	 * Colour ramp sampled by each cell's value between `rampMin` and `rampMax`: CSS stops, a
	 * colormap name, or `(t) => colour`. Defaults to the theme's ramp (background to first series
	 * colour).
	 */
	ramp?: ColorRampSpec;
	/** Value at the bottom of the ramp. Defaults to the finite minimum of `values`. */
	rampMin?: number;
	/** Value at the top of the ramp. Defaults to the finite maximum of `values`. */
	rampMax?: number;
	/**
	 * Fraction of the reveal spent staggering the cells in reading order, 0..0.95. Defaults to 0.5
	 * (0 above 2000 cells).
	 */
	stagger?: number;
	/**
	 * How cells change colour when `values` changes: a tween or a spring in the
	 * node's tween bank; new cells fade in, removed ones fade out. Omitted,
	 * changes are instant.
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
	/** Set to false to hide the mesh. */
	visible?: boolean;
}

/** What a pcolormesh keeps between updates. */
interface PcolormeshState {
	layer: ChartLayer;
	mesh: (
		deps: readonly unknown[],
		make: () => PcolormeshResult,
	) => PcolormeshResult;
	ramp: ReturnType<typeof createRampCells<PcolormeshCell>>;
	placed: (deps: readonly unknown[], make: () => CellItem[]) => CellItem[];
	rects: CellRects;
}

const states = new WeakMap<object, PcolormeshState>();

const cellValue = (cell: PcolormeshCell) => cell.value;
const readingAt = (cell: PcolormeshCell) => ({
	x: cell.x0 + cell.x1,
	y: cell.y0 + cell.y1,
});

/** Each drawn cell's box and colour, for one fit of the axes. */
export function placeGridCells(
	grid: RampCells<PcolormeshCell>,
	coords: Parameters<typeof cellBox>[0],
	bleed = 0,
): CellItem[] {
	return grid.cells.map((cell) => ({
		key: `${cell.row}:${cell.column}`,
		...boxPlacement(cellBox(coords, cell.x0, cell.y0, cell.x1, cell.y1, bleed)),
		fill: grid.fill(cell),
		opacity: 1,
	}));
}

/**
 * The placed cells at this frame of the reveal: each with the layer's
 * `opacity` and its share of the reveal as its `progress`.
 */
export function revealCells(
	placed: readonly CellItem[],
	grid: Pick<RampCells<unknown>, "revealOf">,
	opacity: number | undefined,
): CellItem[] {
	const own = opacity ?? 1;
	return placed.map((cell, i) => {
		const reveal = grid.revealOf(i) ?? 1;
		if (reveal === 1 && own === 1) return cell;
		return {
			...cell,
			opacity: own,
			...(reveal !== 1 ? { progress: reveal } : {}),
		};
	});
}

function draw(ctx: CompositeContext<PcolormeshProps>): SceneNode[] {
	const state = states.get(ctx.node) as PcolormeshState;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords)
		throw new Error("Pcolormesh must be placed inside a chart or axes.");
	const mesh = state.mesh([props.xs, props.ys, props.values], () =>
		pcolormeshCells(props.xs, props.ys, props.values),
	);
	const grid = state.ramp({
		layer: state.layer,
		coords,
		theme: ctx.theme,
		ramp: props.ramp,
		cells: mesh.cells,
		value: cellValue,
		at: readingAt,
		norm: {
			rampScale: props.rampScale,
			rampMidpoint: props.rampMidpoint,
			rampMin: props.rampMin,
			rampMax: props.rampMax,
		},
		extent: { x: { values: props.xs }, y: { values: props.ys } },
		stagger: props.stagger,
		progress: props.progress,
	});
	const placed = state.placed(
		[grid.cells, coords, grid.colormap, grid.norm],
		() => placeGridCells(grid, coords),
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
		{
			transition: props.transition,
			animate: (grid.progress ?? 1) >= 1,
		},
	);
	return [state.rects.node];
}

/**
 * A coloured mesh over a rectilinear grid: `xs`/`ys` are per-axis centres or edges (uneven
 * spacing allowed), `values` the cell values, each finite cell coloured on a ramp. Throws if
 * `xs` or `ys` has the wrong length. Paints under the axes by default (`zIndex`
 * `UNDER_AXES_Z_INDEX`). Inside a `chart` or `axes`. Drawn as one instances node of
 * rectangles. See {@link pcolormeshCells}.
 *
 * @example
 * ```ts
 * import { chart, pcolormesh } from "@sophistry/charts";
 *
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	colorbar: true,
 * 	children: [pcolormesh.create({ xs: [0, 1, 3], ys: [0, 2], values: [[1, 2]], ramp: "viridis" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const pcolormesh = defineComposite<PcolormeshProps>({
	name: "Pcolormesh",
	props: {
		xs: { default: [], invalidates: Invalidate.UPDATE },
		ys: { default: [], invalidates: Invalidate.UPDATE },
		values: { default: [], invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		rampMin: { invalidates: Invalidate.UPDATE },
		rampMax: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMidpoint: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
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
			mesh: keyedMemo<PcolormeshResult>(),
			ramp: createRampCells<PcolormeshCell>(),
			placed: keyedMemo<CellItem[]>(),
			rects: createCellRects(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
