import { clampNonNegative } from "@sophistry/core/internal";
/**
 * Waffle chart math: share out a fixed number of unit cells between
 * categories so the counts sum exactly, and place each cell on the grid.
 * `<Waffle>` is the caller that draws them.
 */

/**
 * Rounds each value's share of `total` to whole numbers summing to exactly
 * `total` (largest remainder): shares round down, and leftover units go to
 * the largest fractional parts, ties to the earlier entry. Negative and
 * non-finite values count as 0.
 *
 * @param total - The whole to share out; rounded down to an integer.
 * @returns One non-negative integer count per value, summing to `total` (all 0 when nothing is positive).
 * @category Math & helpers
 */
export function largestRemainder(
	values: readonly number[],
	total: number,
): number[] {
	const clamped = values.map(clampNonNegative);
	const sum = clamped.reduce((acc, value) => acc + value, 0);
	const whole = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
	if (!(sum > 0) || !Number.isFinite(sum) || whole === 0)
		return clamped.map(() => 0);

	const quotas = clamped.map((value) => (value / sum) * whole);
	const counts = quotas.map(Math.floor);
	let left = whole - counts.reduce((acc, count) => acc + count, 0);
	const order = quotas
		.map((quota, index) => ({ index, rest: quota - Math.floor(quota) }))
		.filter((entry) => clamped[entry.index] > 0)
		.sort((a, b) => b.rest - a.rest || a.index - b.index);
	for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length) {
		counts[order[k].index]++;
		left--;
	}
	return counts;
}

/** @category Math */
export interface WaffleOptions {
	/** Rows of cells. @default 10 */
	rows?: number;
	/** Columns of cells. @default 10 */
	columns?: number;
}

/**
 * One unit cell of a waffle chart.
 *
 * @category Math & helpers
 */
export interface WaffleCell {
	/** Place in fill order, 0-based: the bottom-left cell is 0. */
	rank: number;
	/** Row, counted up from the bottom (0 is the bottom row). */
	row: number;
	/** Column, counted from the left. */
	column: number;
	/** Index of the value this cell counts towards, or -1 for an empty cell. */
	category: number;
}

/** A positive whole number of rows or columns, or the default. */
function gridCount(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: fallback;
}

/**
 * Every cell of a `rows × columns` waffle in fill order, assigned to
 * categories by {@link largestRemainder}. Cells fill row by row from the
 * bottom-left, each category one contiguous run in data order.
 *
 * @param values - One value per category; negative and non-finite count as 0.
 * @returns `rows × columns` cells by `rank`; all empty (`category: -1`) when no value is positive.
 * @category Math & helpers
 */
export function waffleCells(
	values: readonly number[],
	options: WaffleOptions = {},
): WaffleCell[] {
	const rows = gridCount(options.rows, 10);
	const columns = gridCount(options.columns, 10);
	const total = rows * columns;
	const counts = largestRemainder(values, total);

	const cells: WaffleCell[] = [];
	let category = 0;
	let usedInCategory = 0;
	for (let rank = 0; rank < total; rank++) {
		while (category < counts.length && usedInCategory >= counts[category]) {
			category++;
			usedInCategory = 0;
		}
		const filled = category < counts.length;
		cells.push({
			rank,
			row: Math.floor(rank / columns),
			column: rank % columns,
			category: filled ? category : -1,
		});
		if (filled) usedInCategory++;
	}
	return cells;
}
