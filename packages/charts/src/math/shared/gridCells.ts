/**
 * Grid-cell assembly shared by `imshow` and `pcolormesh`: a value grid laid
 * onto data-space rectangles from a caller-supplied `rectFor`, ragged rows
 * tolerated, `min`/`max` over finite values (`[0, 1]` when none).
 */

/**
 * One grid cell: its `(row, column)` and its data-space rectangle.
 *
 * @category Math & helpers
 */
export interface GridCell {
	row: number;
	column: number;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	value: number;
}

/**
 * The full gridded result.
 *
 * @category Math & helpers
 */
export interface GridResult {
	cells: GridCell[];
	/** Smallest finite value in the grid, or 0 if there were none. */
	min: number;
	/** Largest finite value in the grid, or 1 if there were none. */
	max: number;
	nrows: number;
	ncols: number;
}

/** Longest row length across `Z` (ragged rows have fewer cells). */
export function gridNcols(Z: readonly (readonly number[])[]): number {
	let ncols = 0;
	for (const row of Z) ncols = Math.max(ncols, row.length);
	return ncols;
}

/** One `GridCell` per entry of `Z`, positioned by `rectFor(row, col)`, and the finite `min`/`max` (`[0, 1]` when none). */
export function buildGridCells(
	Z: readonly (readonly number[])[],
	rectFor: (
		row: number,
		col: number,
	) => Pick<GridCell, "x0" | "x1" | "y0" | "y1">,
): { cells: GridCell[]; min: number; max: number } {
	const cells: GridCell[] = [];
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;

	for (let row = 0; row < Z.length; row++) {
		const rowValues = Z[row];
		for (let col = 0; col < rowValues.length; col++) {
			const value = rowValues[col];
			cells.push({ row, column: col, ...rectFor(row, col), value });
			if (Number.isFinite(value)) {
				if (value < min) min = value;
				if (value > max) max = value;
			}
		}
	}

	if (min > max) {
		min = 0;
		max = 1;
	}

	return { cells, min, max };
}
