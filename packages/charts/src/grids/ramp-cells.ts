/**
 * The plumbing the gridded colour layers share (`imshow`, `pcolormesh`,
 * `hist2d`, `hexBin`): a colormap and norm over the cells' values, the
 * layer's report to its chart (with its colour-bar ramp), and the cells'
 * reading-order fade. Internal to the charts.
 *
 * Each piece is a factory called once in `setup` that returns a function to
 * call in every `update`. Each step sits
 * behind a last-input cache, so a frame of a reveal recomputes the fade and
 * nothing else, and the colormap and norm keep their identity (the chart
 * compares reports by value, colormaps and scales by identity).
 */

import type { ColorRampSpec, CoordinateSystem } from "@sophistry/core";
import { resolveColorRamp } from "@sophistry/core/internal";
import type { Colormap, Theme } from "@sophistry/core/themes";
import type { ColorNorm, RampScaleOptions } from "../color-norm.js";
import { colorNorm, rampOf } from "../color-norm.js";
import type { ChartLayer } from "../context.js";
import type { ChartLayerExtent, RampExtent } from "../frame/types.js";
import {
	gridStagger,
	readingRanks,
	reversedAxes,
	staggered,
} from "../stagger.js";
import { keyedMemo } from "../util.js";

/** What {@link createRampCells}'s function takes on each update. */
export interface RampCellsSpec<C> {
	layer: ChartLayer;
	coords: CoordinateSystem;
	theme: Theme;
	ramp: ColorRampSpec | undefined;
	/** Every cell, drawn or not; keep the same array while nothing changed. */
	cells: readonly C[];
	value: (cell: C) => number;
	/** A cell's place for reading order (any point its row shares). */
	at: (cell: C) => { x: number; y: number };
	norm: RampScaleOptions;
	/** The values the norm's automatic range reads (same array while unchanged); defaults to every cell's value. */
	domain?: readonly number[];
	/** The layer's report, less `covers` and `ramp`. */
	extent: Omit<ChartLayerExtent, "ramp" | "covers">;
	stagger: number | undefined;
	/** The layer's own `progress`, before the chart's data phase. */
	progress: number | undefined;
}

/** What {@link createRampCells}'s function hands back. */
export interface RampCells<C> {
	/** The cells to draw: those whose value has a place on the norm (finite; positive under `"log"`). */
	cells: readonly C[];
	/** A drawn cell's colour. */
	fill(cell: C): string;
	/** A value's place on the norm, 0..1 (non-finite when it has none). */
	unitOf(value: number): number;
	/** The ramp's colour at a place on the norm, 0..1. */
	colorAt(unit: number): string;
	/** The colormap, kept while the ramp and theme are. */
	colormap: Colormap;
	/** The norm, kept while the values and norm props are. */
	norm: ColorNorm;
	/** The layer's reveal, scaled by the chart's data phase (undefined outside a chart without `progress`). */
	progress: number | undefined;
	/** Whether the cells fade one after another (a stagger over more than one cell). */
	staggered: boolean;
	/** The `i`th drawn cell's reveal: its share of the reading-order fade when staggered. */
	revealOf(i: number): number | undefined;
}

/**
 * A gridded colour layer's cells, colours, report and fade. Call once, in
 * `setup`; call the result in each `update` (it reports to the chart).
 */
export function createRampCells<C>(): (spec: RampCellsSpec<C>) => RampCells<C> {
	const colormapOf = keyedMemo<Colormap>();
	const normOf = keyedMemo<ColorNorm>();
	const drawnOf = keyedMemo<readonly C[]>();
	const readingOf = keyedMemo<
		{ rank: number[]; count: number; spread: number } | undefined
	>();
	const rampExtentOf = keyedMemo<RampExtent>();
	return (spec) => {
		const fallback = spec.theme.palette.ramp;
		const colormap = colormapOf([spec.ramp, fallback], () =>
			resolveColorRamp(spec.ramp, () => fallback),
		);
		const options = spec.norm;
		const norm = normOf(
			[
				spec.domain ?? spec.cells,
				options.rampScale,
				options.rampMidpoint,
				options.rampMin,
				options.rampMax,
			],
			() =>
				colorNorm(spec.domain ?? spec.cells.map(spec.value), {
					...options,
					always: true,
				}),
		);
		spec.layer.report({
			covers: true,
			...spec.extent,
			ramp: rampExtentOf([norm, colormap], () =>
				rampOf(norm, norm.domain, colormap),
			),
		});
		const cells = drawnOf([spec.cells, norm], () =>
			spec.cells.filter((cell) => Number.isFinite(norm.unit(spec.value(cell)))),
		);
		// Axes running backwards on screen, so the fade reads the grid as drawn.
		const reversed = reversedAxes(spec.coords.xRange(), spec.coords.yRange());
		const spread = gridStagger(spec.stagger, cells.length);
		const reading = readingOf([cells, spread, reversed.x, reversed.y], () =>
			spread > 0
				? {
						rank: readingRanks(cells.map(spec.at), reversed),
						count: cells.length,
						spread,
					}
				: undefined,
		);
		const progress = spec.layer.progress(spec.progress);
		return {
			cells,
			fill: (cell) => colormap(norm.unit(spec.value(cell))),
			unitOf: (value) => norm.unit(value),
			colorAt: (unit) => colormap(unit),
			colormap,
			norm,
			progress,
			staggered: reading !== undefined && reading.count > 1,
			revealOf: (i) => {
				if (!reading || progress === undefined) return progress;
				return staggered(
					progress,
					reading.rank[i] ?? 0,
					reading.count,
					reading.spread,
				);
			},
		};
	};
}
