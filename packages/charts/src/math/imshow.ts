/** Image-from-array cells: `Z` (rows × cols) laid onto equal-sized cells spanning a rectangular `extent`. */

import {
	buildGridCells,
	type GridCell,
	type GridResult,
	gridNcols,
} from "./shared/gridCells.js";

/** @category Math */
export type ImshowCell = GridCell;
/** @category Math */
export type ImshowResult = GridResult;

/** @category Math */
export interface ImshowOptions {
	/** `[xMin, xMax, yMin, yMax]`. Defaults to `[0, ncols, 0, nrows]`. */
	extent?: [number, number, number, number];
	/**
	 * `"upper"` puts row 0 at the top of `extent`; `"lower"` at the bottom, like
	 * ordinary cartesian data.
	 * @default "upper"
	 */
	origin?: "upper" | "lower";
}

/**
 * Lays `Z` onto `ncols × nrows` equal cells spanning `extent` (`ncols` the
 * longest row; ragged rows tolerated). Non-finite values pass through;
 * `min`/`max` cover finite values only (`[0, 1]` when none).
 *
 * @param Z - Samples as `Z[row][col]`.
 * @category Math & helpers
 */
export function imshowCells(
	Z: readonly (readonly number[])[],
	options: ImshowOptions = {},
): ImshowResult {
	const nrows = Z.length;
	const ncols = gridNcols(Z);

	if (nrows === 0 || ncols === 0) {
		return { cells: [], min: 0, max: 1, nrows, ncols };
	}

	const [xMin, xMax, yMin, yMax] = options.extent ?? [0, ncols, 0, nrows];
	const origin = options.origin ?? "upper";
	const dx = (xMax - xMin) / ncols;
	const dy = (yMax - yMin) / nrows;

	const { cells, min, max } = buildGridCells(Z, (row, col) => {
		const x0 = xMin + col * dx;
		const x1 = xMin + (col + 1) * dx;
		if (origin === "upper") {
			return { x0, x1, y1: yMax - row * dy, y0: yMax - (row + 1) * dy };
		}
		return { x0, x1, y0: yMin + row * dy, y1: yMin + (row + 1) * dy };
	});

	return { cells, min, max, nrows, ncols };
}
