/**
 * Pseudocolour mesh on a regular grid: `X`/`Y` are 1D per-axis coordinates,
 * either cell edges (`ncols + 1` / `nrows + 1`) or centres (`ncols` /
 * `nrows`), and `Z` the `nrows x ncols` cell values.
 */

import {
	buildGridCells,
	type GridCell,
	type GridResult,
	gridNcols,
} from "./shared/gridCells.js";

/** @category Math */
export type PcolormeshCell = GridCell;
/** @category Math */
export type PcolormeshResult = GridResult;

/** `n` centres to `n + 1` edges: midpoints between centres, the ends extrapolated by their nearest gap (±0.5 for one centre). */
function edgesFromCenters(centers: readonly number[]): number[] {
	const n = centers.length;
	if (n === 0) return [];
	if (n === 1) return [centers[0] - 0.5, centers[0] + 0.5];

	const edges: number[] = new Array(n + 1);
	edges[0] = centers[0] - (centers[1] - centers[0]) / 2;
	for (let i = 1; i < n; i++) edges[i] = (centers[i - 1] + centers[i]) / 2;
	edges[n] = centers[n - 1] + (centers[n - 1] - centers[n - 2]) / 2;
	return edges;
}

/** An axis's coordinates as `n + 1` edges: given edges as is, centres converted; throws for any other length. */
function resolveEdges(
	coords: readonly number[],
	n: number,
	axis: string,
): number[] {
	if (coords.length === n + 1) return [...coords];
	if (coords.length === n) return edgesFromCenters(coords);
	throw new Error(
		`pcolormeshCells: ${axis} length (${coords.length}) must equal ncols/nrows (${n}) or ncols/nrows + 1 (${n + 1}).`,
	);
}

/**
 * Cells for the grid `Z`, positioned by `X`/`Y` edges or centres. Ragged
 * rows are tolerated; `min`/`max` cover finite values only (`[0, 1]` when
 * none).
 *
 * @param X - Column coordinates: `ncols` centres or `ncols + 1` edges.
 * @param Y - Row coordinates: `nrows` centres or `nrows + 1` edges.
 * @param Z - Samples as `Z[row][col]`.
 * @throws If `X` or `Y` has neither the grid size nor the grid size plus one entries (and `Z` is non-empty).
 * @category Math & helpers
 */
export function pcolormeshCells(
	X: readonly number[],
	Y: readonly number[],
	Z: readonly (readonly number[])[],
): PcolormeshResult {
	const nrows = Z.length;
	const ncols = gridNcols(Z);

	if (nrows === 0 || ncols === 0) {
		return { cells: [], min: 0, max: 1, nrows, ncols };
	}

	const xEdges = resolveEdges(X, ncols, "X");
	const yEdges = resolveEdges(Y, nrows, "Y");

	const { cells, min, max } = buildGridCells(Z, (row, col) => ({
		x0: xEdges[col],
		x1: xEdges[col + 1],
		y0: yEdges[row],
		y1: yEdges[row + 1],
	}));

	return { cells, min, max, nrows, ncols };
}
