/**
 * `hexBin`: hexagonal binning, drawn as one path batch. The hexagons are
 * regular in data units, so under unequal axis scales (or a log axis) their
 * scene outlines differ in shape: a path batch (one outline per item) rather
 * than polygon instances, which only scale uniformly.
 */

import type {
	ColorRampSpec,
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	pathBatch,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { RampScaleProps } from "../color-norm";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel } from "../data/channels";
import { dateSinkContext, numberValues } from "../data/channels";
import type { HexBinCell } from "../math/hexbin";
import { hexbin } from "../math/hexbin";
import type { AnyDatum } from "../props";
import { keyedMemo } from "../util";
import { createRampCells } from "./ramp-cells";

/**
 * Props of {@link hexBin}.
 *
 * @category Charts
 */
export interface HexBinProps<T = unknown> {
	/** One observation per datum; data with a non-finite `x` or `y` are dropped. */
	data: readonly T[];
	/** X position, in data units. */
	x: Channel<T, number>;
	/** Y position, in data units. */
	y: Channel<T, number>;
	/**
	 * Hex centre-to-corner distance in data units, on both axes (see {@link hexbin}). Required: no
	 * default fits every axis scale.
	 */
	radius: number;
	/**
	 * Low-to-high count ramp: a colormap name, CSS stops or function. Defaults to the theme's ramp.
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
	/** Hexagon outline. @default "none" */
	stroke?: string;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Fill opacity 0..1, on top of `opacity`. @default 1 */
	fillOpacity?: number;
	/** Reveal 0..1: hexagons fade in in reading order, top row first. @default 1 */
	progress?: number;
	/** Paint order. Defaults to `UNDER_AXES_Z_INDEX` (above the grid, under the axes). */
	zIndex?: number;
	/** Set to false to hide the hexagons. */
	visible?: boolean;
}

/**
 * The six corners of a pointy-top hexagon in data space, matching the `hexbin()` grid.
 *
 * @internal
 */
export function hexCorners(cx: number, cy: number, radius: number): Point[] {
	return Array.from({ length: 6 }, (_, k) => {
		const angle = Math.PI / 2 + (k * Math.PI) / 3;
		return {
			x: cx + radius * Math.cos(angle),
			y: cy + radius * Math.sin(angle),
		};
	});
}

/** What a hexBin keeps between updates. */
interface HexBinState {
	layer: ChartLayer;
	binned: (
		deps: readonly unknown[],
		make: () => {
			xs: number[];
			ys: number[];
			cells: HexBinCell[];
			domain: number[];
		},
	) => { xs: number[]; ys: number[]; cells: HexBinCell[]; domain: number[] };
	ramp: ReturnType<typeof createRampCells<HexBinCell>>;
	placed: (
		deps: readonly unknown[],
		make: () => PathBatchItem[],
	) => PathBatchItem[];
	batch: PathBatchNode<PathBatchItemsProps>;
}

const states = new WeakMap<object, HexBinState>();

const countOf = (cell: HexBinCell) => cell.count;
const readingAt = (cell: HexBinCell) => cell.center;

function draw(ctx: CompositeContext<HexBinProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as HexBinState;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords) throw new Error("HexBin must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const binned = state.binned(
		[props.data, props.x, props.y, props.radius],
		() => {
			const xs = numberValues(props.data, props.x, undefined, "x", dates);
			const ys = numberValues(props.data, props.y, undefined, "y", dates);
			const cells = hexbin(xs, ys, props.radius);
			// Counts map from 0 to the fullest cell (0..1 with none).
			const domain = cells.length ? [0, ...cells.map((c) => c.count)] : [];
			return { xs, ys, cells, domain };
		},
	);
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
		extent: { x: { values: binned.xs }, y: { values: binned.ys } },
		stagger: props.stagger,
		progress: props.progress,
	});
	const placed = state.placed(
		[grid.cells, coords, grid.colormap, grid.norm, props.radius],
		() =>
			grid.cells.map((cell) => {
				const corners = hexCorners(
					cell.center.x,
					cell.center.y,
					props.radius,
				).map((at) => coords.coordsToPoint(at.x, at.y));
				// Closed on its first corner, so a reveal traces the closing edge.
				const first = corners[0];
				if (first) corners.push(first);
				return { closed: true, polylines: [corners], fill: grid.fill(cell) };
			}),
	);
	// Each hexagon has its share of the reveal as its `progress`:
	// the fill comes up, a stroke traces. The placed outlines
	// are kept, so their arc lengths are measured once.
	const revealing = (grid.progress ?? 1) < 1;
	const items = revealing
		? placed.map((item, i) => ({ ...item, progress: grid.revealOf(i) ?? 1 }))
		: placed;
	state.batch.update({
		items,
		stroke: props.stroke ?? "none",
		strokeWidth: props.strokeWidth,
		opacity: props.opacity,
		fillOpacity: props.fillOpacity,
		zIndex: props.zIndex ?? UNDER_AXES_Z_INDEX,
		visible: props.visible,
	});
	return [state.batch];
}

/**
 * A hexagonal binning heatmap: points binned into a hex grid in data space, one filled hexagon
 * per occupied cell coloured by its count. With unequal axis scales the hexagons stretch. Paints
 * under the axes by default (`zIndex` `UNDER_AXES_Z_INDEX`). Inside a `chart` or `axes`; drawn
 * as one path batch. See {@link hexbin} for the binning alone.
 *
 * @example
 * ```ts
 * import { chart, hexBin } from "@sophistry/charts";
 *
 * const points = Array.from({ length: 200 }, (_, i) => ({ x: Math.sin(i) * 3, y: Math.cos(i * 0.7) * 2 }));
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	children: [hexBin.create({ data: points, x: "x", y: "y", radius: 0.4, ramp: "magma" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const hexBin = defineComposite<HexBinProps<AnyDatum>>({
	name: "HexBin",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		radius: { default: 1, invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMin: { invalidates: Invalidate.UPDATE },
		rampMax: { invalidates: Invalidate.UPDATE },
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
			ramp: createRampCells<HexBinCell>(),
			placed: keyedMemo<PathBatchItem[]>(),
			batch: pathBatch.create({ items: [] }),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
