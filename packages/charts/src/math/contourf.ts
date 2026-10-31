/**
 * Filled contours: bands between consecutive level thresholds over a grid
 * (`x` length `ncols`, `y` length `nrows`, `z[row][col]` at `(x[col],
 * y[row])`). Each grid cell is clipped on its own, giving many small
 * polygons per band that meet edge to edge without gaps.
 */

import type { Point } from "@sophistry/core/geometry";
import { resolveLevels as resolveLevelsShared } from "./shared/gridExtent";

/**
 * A clip vertex: a point plus the field value at it.
 *
 * @internal
 */
export interface Vtx {
	x: number;
	y: number;
	z: number;
}

/** @category Math */
export interface ContourBand {
	loLevel: number;
	hiLevel: number;
	/** Closed polygon rings, in data space, one per contributing grid cell. */
	polygons: Point[][];
}

/**
 * `count` evenly spaced band boundaries spanning `[min, max]` inclusively,
 * so every sample falls in a band.
 *
 * @internal
 */
export function evenBoundaries(
	min: number,
	max: number,
	count: number,
): number[] {
	const n = Math.max(0, Math.floor(count));
	if (n < 2) return [];
	const levels: number[] = [];
	for (let i = 0; i < n; i++) levels.push(min + ((max - min) * i) / (n - 1));
	return levels;
}

/** Level resolution with boundaries covering the whole extent. */
function resolveLevels(
	levels: readonly number[] | number,
	z: readonly (readonly number[])[],
): number[] {
	return resolveLevelsShared(levels, z, evenBoundaries);
}

/**
 * Clips a convex polygon by a half-plane of `z` (`z >= threshold` with
 * `keepAbove`, else `z <= threshold`); new vertices sit exactly on the
 * threshold.
 *
 * @internal
 */
export function clipByThreshold(
	poly: Vtx[],
	threshold: number,
	keepAbove: boolean,
): Vtx[] {
	if (poly.length === 0) return [];
	const inside = (v: Vtx) => (keepAbove ? v.z >= threshold : v.z <= threshold);
	const intersect = (a: Vtx, b: Vtx): Vtx => {
		const t = (threshold - a.z) / (b.z - a.z);
		return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: threshold };
	};

	const out: Vtx[] = [];
	for (let i = 0; i < poly.length; i++) {
		const curr = poly[i];
		const prev = poly[(i - 1 + poly.length) % poly.length];
		const currIn = inside(curr);
		const prevIn = inside(prev);
		if (currIn) {
			if (!prevIn) out.push(intersect(prev, curr));
			out.push(curr);
		} else if (prevIn) {
			out.push(intersect(prev, curr));
		}
	}
	return out;
}

/**
 * Fills `z` into bands between consecutive `levels`: `N` levels make `N - 1`
 * closed bands `loLevel <= z <= hiLevel`. Cells touching a NaN corner, and
 * constant fields, contribute nothing.
 *
 * @param z - Samples as `z[row][col]`, at `(x[col], y[row])`.
 * @param levels - Explicit boundaries, or a count spanning the data.
 * @returns One {@link ContourBand} per pair of consecutive levels.
 * @category Math & helpers
 */
export function contourBands(
	x: readonly number[],
	y: readonly number[],
	z: readonly (readonly number[])[],
	levels: readonly number[] | number,
): ContourBand[] {
	const nrows = z.length;
	const ncols = nrows > 0 ? z[0].length : 0;
	if (nrows < 2 || ncols < 2 || x.length < ncols || y.length < nrows) return [];

	const resolved = resolveLevels(levels, z);
	if (resolved.length < 2) return [];

	const bands: ContourBand[] = resolved.slice(1).map((hiLevel, i) => ({
		loLevel: resolved[i],
		hiLevel,
		polygons: [],
	}));

	for (let row = 0; row < nrows - 1; row++) {
		for (let col = 0; col < ncols - 1; col++) {
			const zTL = z[row][col];
			const zTR = z[row][col + 1];
			const zBR = z[row + 1][col + 1];
			const zBL = z[row + 1][col];
			if (
				!Number.isFinite(zTL) ||
				!Number.isFinite(zTR) ||
				!Number.isFinite(zBR) ||
				!Number.isFinite(zBL)
			) {
				continue;
			}

			const xL = x[col];
			const xR = x[col + 1];
			const yT = y[row];
			const yB = y[row + 1];
			const quad: Vtx[] = [
				{ x: xL, y: yT, z: zTL },
				{ x: xR, y: yT, z: zTR },
				{ x: xR, y: yB, z: zBR },
				{ x: xL, y: yB, z: zBL },
			];

			for (const band of bands) {
				const lower = clipByThreshold(quad, band.loLevel, true);
				const clipped = clipByThreshold(lower, band.hiLevel, false);
				if (clipped.length >= 3) {
					band.polygons.push(clipped.map((v) => ({ x: v.x, y: v.y })));
				}
			}
		}
	}

	return bands;
}
