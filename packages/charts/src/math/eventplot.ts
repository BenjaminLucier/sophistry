/** Event plot: a raster of vertical tick marks, one row per sequence (e.g. spike trains). */

import type { Point } from "@sophistry/core/geometry";

/** @category Math */
export interface EventRow {
	/** Index into the original `rows` — which band this row's ticks belong to. */
	row: number;
	/** One `[from, to]` drop-line pair per finite event time in this row. */
	ticks: [Point, Point][];
}

/** @category Math */
export interface EventPlotOptions {
	/** Data-space spacing between successive rows' y. @default 1 */
	lineOffset?: number;
	/** Data-space height of each tick, centred on its row's y. @default 0.8 */
	lineLength?: number;
}

const DEFAULT_LINE_OFFSET = 1;
const DEFAULT_LINE_LENGTH = 0.8;

/**
 * One vertical tick per finite event time, grouped by row: row `i` sits at
 * `y = i * lineOffset`, each tick at `x = t`, `lineLength` tall. Empty rows
 * are kept.
 *
 * @param rows - One array of event positions (x) per row.
 * @returns One {@link EventRow} per input row, in order.
 * @category Math & helpers
 */
export function eventPlotRows(
	rows: readonly (readonly number[])[],
	options: EventPlotOptions = {},
): EventRow[] {
	const lineOffset = options.lineOffset ?? DEFAULT_LINE_OFFSET;
	const half = (options.lineLength ?? DEFAULT_LINE_LENGTH) / 2;
	return rows.map((times, i) => {
		const y = i * lineOffset;
		const ticks: [Point, Point][] = [];
		for (const t of times) {
			if (!Number.isFinite(t)) continue;
			ticks.push([
				{ x: t, y: y - half },
				{ x: t, y: y + half },
			]);
		}
		return { row: i, ticks };
	});
}
