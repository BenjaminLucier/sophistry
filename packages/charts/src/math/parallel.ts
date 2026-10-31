/**
 * Parallel coordinates: each row of numbers becomes a polyline across a row
 * of vertical axes, one axis per column.
 */

import type { Point, Range } from "@sophistry/core/geometry";

/**
 * Horizontal position of axis `index` of `count`, 0..1: evenly spaced, the
 * first at 0 and the last at 1. A lone axis sits at 0.5.
 *
 * @category Math & helpers
 */
export function parallelAxisX(index: number, count: number): number {
	return count <= 1 ? 0.5 : index / (count - 1);
}

/**
 * One row's polyline in normalized coordinates.
 *
 * @category Math & helpers
 */
export interface ParallelLine {
	/** Position of the row in the input. */
	index: number;
	/**
	 * Runs of consecutive usable values, each a polyline in the unit square
	 * (`y` 0 at the axis's `min`, 1 at `max`). Non-finite values break the
	 * line; a one-point run is kept.
	 */
	segments: Point[][];
}

/**
 * Maps rows of values onto parallel axes in normalized `[0, 1] × [0, 1]`
 * coordinates (y up): axis `j` stands at `parallelAxisX(j, ranges.length)`
 * and a value sits at `(v − min) / (max − min)` along it. Short rows miss
 * their last axes; a degenerate range puts values at 0.5.
 *
 * @param rows - One array per datum, one value per axis.
 * @param ranges - One linear `[min, max, step?]` per axis.
 * @category Math & helpers
 */
export function parallelLines(
	rows: readonly (readonly number[])[],
	ranges: readonly Range[],
): ParallelLine[] {
	const count = ranges.length;
	return rows.map((row, index) => {
		const segments: Point[][] = [];
		let run: Point[] = [];
		for (let j = 0; j < count; j++) {
			const value = row[j];
			if (typeof value !== "number" || !Number.isFinite(value)) {
				if (run.length > 0) segments.push(run);
				run = [];
				continue;
			}
			const [min, max] = ranges[j];
			const span = max - min;
			run.push({
				x: parallelAxisX(j, count),
				y: span !== 0 && Number.isFinite(span) ? (value - min) / span : 0.5,
			});
		}
		if (run.length > 0) segments.push(run);
		return { index, segments };
	});
}
