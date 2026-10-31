/**
 * Structured-grid surfaces: `X`, `Y`, `Z` are three `nrows x ncols` arrays of
 * world coordinates for one grid of points, computed by the caller. Quads
 * are wound so `MeshFaces` sees them facing outward. Mismatched grid
 * shapes throw.
 */

import type { Point3 } from "@sophistry/core/internal";

/** @category Math */
export interface SurfaceGridFace {
	points: Point3[];
}

/**
 * A rectangular grid of numbers (rows of columns).
 *
 * @category Math & helpers
 */
export type SurfaceGrid = readonly (readonly number[])[];

/** Checks `X`/`Y`/`Z` share one `nrows x ncols` shape and returns it; throws on any mismatch. */
function validateGrid(
	X: SurfaceGrid,
	Y: SurfaceGrid,
	Z: SurfaceGrid,
): { nrows: number; ncols: number } {
	const nrows = Z.length;
	if (X.length !== nrows || Y.length !== nrows) {
		throw new Error(
			`surfaceGrid: X/Y/Z must have the same row count (X=${X.length}, Y=${Y.length}, Z=${nrows}).`,
		);
	}
	const ncols = nrows > 0 ? Z[0].length : 0;
	for (let row = 0; row < nrows; row++) {
		if (
			X[row].length !== ncols ||
			Y[row].length !== ncols ||
			Z[row].length !== ncols
		) {
			throw new Error(
				`surfaceGrid: row ${row} of X/Y/Z must all have length ${ncols} (the grid's column count).`,
			);
		}
	}
	return { nrows, ncols };
}

function pointAt(
	X: SurfaceGrid,
	Y: SurfaceGrid,
	Z: SurfaceGrid,
	row: number,
	col: number,
): Point3 {
	return { x: X[row][col], y: Y[row][col], z: Z[row][col] };
}

/**
 * One outward-wound quad per grid cell, `(nrows - 1) * (ncols - 1)` total.
 *
 * @param X - World x of each grid point, `X[row][col]`.
 * @throws If the three grids differ in row count or any row's length.
 * @category Math & helpers
 */
export function surfaceGridFaces(
	X: SurfaceGrid,
	Y: SurfaceGrid,
	Z: SurfaceGrid,
): SurfaceGridFace[] {
	const { nrows, ncols } = validateGrid(X, Y, Z);
	const faces: SurfaceGridFace[] = [];
	for (let row = 0; row < nrows - 1; row++) {
		for (let col = 0; col < ncols - 1; col++) {
			const p0 = pointAt(X, Y, Z, row, col);
			const p1 = pointAt(X, Y, Z, row, col + 1);
			const p2 = pointAt(X, Y, Z, row + 1, col + 1);
			const p3 = pointAt(X, Y, Z, row + 1, col);
			// Reversed traversal order — see module doc.
			faces.push({ points: [p0, p3, p2, p1] });
		}
	}
	return faces;
}

/**
 * One polyline per grid row plus one per column: the wireframe.
 *
 * @param X - World x of each grid point, `X[row][col]`.
 * @throws If the three grids differ in row count or any row's length.
 * @category Math & helpers
 */
export function surfaceGridWireframe(
	X: SurfaceGrid,
	Y: SurfaceGrid,
	Z: SurfaceGrid,
): Point3[][] {
	const { nrows, ncols } = validateGrid(X, Y, Z);
	const lines: Point3[][] = [];
	for (let row = 0; row < nrows; row++) {
		const line: Point3[] = new Array(ncols);
		for (let col = 0; col < ncols; col++)
			line[col] = pointAt(X, Y, Z, row, col);
		lines.push(line);
	}
	for (let col = 0; col < ncols; col++) {
		const line: Point3[] = new Array(nrows);
		for (let row = 0; row < nrows; row++)
			line[row] = pointAt(X, Y, Z, row, col);
		lines.push(line);
	}
	return lines;
}
