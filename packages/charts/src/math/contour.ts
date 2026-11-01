/**
 * Contour lines: iso-lines of a scalar field on a regular grid, by marching
 * squares. `x` has length `ncols`, `y` length `nrows`, and `z[row][col]` is
 * the sample at `(x[col], y[row])`.
 */

import type { Point } from "@sophistry/core/geometry";
import { stitchSegments } from "@sophistry/core/internal";
import { resolveLevels as resolveLevelsShared } from "./shared/gridExtent.js";

type Pt = Point;

/** @category Math */
export interface ContourLine {
	level: number;
	points: Point[];
}

/**
 * `count` evenly spaced levels strictly between `min` and `max`.
 *
 * @internal
 */
export function evenLevels(min: number, max: number, count: number): number[] {
	const n = Math.max(0, Math.floor(count));
	const levels: number[] = [];
	for (let i = 1; i <= n; i++) levels.push(min + ((max - min) * i) / (n + 1));
	return levels;
}

/** Level resolution with levels strictly inside the extent. */
function resolveLevels(
	levels: readonly number[] | number,
	z: readonly (readonly number[])[],
): number[] {
	return resolveLevelsShared(levels, z, evenLevels);
}

function lerp(
	x0: number,
	x1: number,
	z0: number,
	z1: number,
	level: number,
): number {
	const t = (level - z0) / (z1 - z0);
	return x0 + (x1 - x0) * t;
}

/**
 * A contour segment: its two crossing points, and the identity of each — the
 * grid or triangle edge it lies on, or the corner when the field is exactly at
 * the level there — so the two cells sharing an edge meet at the same key.
 *
 * @internal
 */
export interface KeyedSegment {
	keys: [number, number];
	points: [Pt, Pt];
}

interface Crossing {
	key: number;
	point: Pt;
}

/**
 * Stitches keyed segments into connected polylines, each running in its
 * lowest-index segment's direction; a loop repeats its first point at the end.
 *
 * @internal
 */
export function stitch(segments: readonly KeyedSegment[]): Point[][] {
	// The end of segment `index` at `key` (its second end, for a zero-length one).
	const endAt = (index: number, key: number) => {
		const { keys, points } = segments[index];
		return keys[1] === key ? points[1] : points[0];
	};
	return stitchSegments(
		segments.map((s) => s.keys),
		"in-order",
	).map(({ keys, segments: order, closed }) => {
		const ks = closed ? [...keys, keys[0]] : keys;
		// The run's own first segment, walked out from in both directions.
		let seed = 0;
		for (let i = 1; i < order.length; i++) if (order[i] < order[seed]) seed = i;
		return ks.map((key, j) => {
			if (j === seed || j === seed + 1) {
				return segments[order[seed]].points[j - seed];
			}
			return endAt(order[j < seed ? j : j - 1], key);
		});
	});
}

/**
 * Iso-lines of `z` at `levels` by marching squares, one {@link ContourLine}
 * per connected run. Cells touching a NaN corner are skipped; saddles are
 * resolved by the cell's mean value.
 *
 * @param z - Samples as `z[row][col]`, at `(x[col], y[row])`.
 * @param levels - Explicit levels, or a count strictly between the data's min and max.
 * @returns Polylines tagged with their level; `[]` for a grid under 2 x 2 or `x`/`y` shorter than `z`.
 * @category Math & helpers
 */
export function contourLines(
	x: readonly number[],
	y: readonly number[],
	z: readonly (readonly number[])[],
	levels: readonly number[] | number,
): ContourLine[] {
	const nrows = z.length;
	const ncols = nrows > 0 ? z[0].length : 0;
	if (nrows < 2 || ncols < 2 || x.length < ncols || y.length < nrows) return [];

	const resolved = resolveLevels(levels, z);
	const result: ContourLine[] = [];

	for (const level of resolved) {
		const segments: KeyedSegment[] = [];

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

				const a = zTL >= level; // top-left
				const b = zTR >= level; // top-right
				const c = zBR >= level; // bottom-right
				const d = zBL >= level; // bottom-left
				if (a === b && b === c && c === d) continue;

				// Corner indices and the edge keys of `stitch`: 2·corner for the
				// edge going right, 2·corner + 1 for the edge going down; a corner
				// exactly at the level is keyed as itself (negative), so every
				// cell touching it meets there.
				const iTL = row * ncols + col;
				const iTR = iTL + 1;
				const iBL = iTL + ncols;
				const iBR = iBL + 1;
				const cross = (
					point: Pt,
					edge: number,
					z0: number,
					i0: number,
					z1: number,
					i1: number,
				): Crossing => ({
					point,
					key: z0 === level ? -1 - i0 : z1 === level ? -1 - i1 : edge,
				});

				const top =
					a !== b
						? cross(
								{ x: lerp(xL, xR, zTL, zTR, level), y: yT },
								2 * iTL,
								zTL,
								iTL,
								zTR,
								iTR,
							)
						: null;
				const right =
					b !== c
						? cross(
								{ x: xR, y: lerp(yT, yB, zTR, zBR, level) },
								2 * iTR + 1,
								zTR,
								iTR,
								zBR,
								iBR,
							)
						: null;
				const bottom =
					c !== d
						? cross(
								{ x: lerp(xL, xR, zBL, zBR, level), y: yB },
								2 * iBL,
								zBL,
								iBL,
								zBR,
								iBR,
							)
						: null;
				const left =
					d !== a
						? cross(
								{ x: xL, y: lerp(yT, yB, zTL, zBL, level) },
								2 * iTL + 1,
								zTL,
								iTL,
								zBL,
								iBL,
							)
						: null;
				const join = (p: Crossing, q: Crossing) =>
					segments.push({ keys: [p.key, q.key], points: [p.point, q.point] });

				const crossings = [top, right, bottom, left].filter(
					(p): p is Crossing => p !== null,
				);

				if (crossings.length === 2) {
					join(crossings[0], crossings[1]);
				} else if (crossings.length === 4) {
					const mean = (zTL + zTR + zBR + zBL) / 4;
					const centerAbove = mean >= level;
					if (centerAbove === a) {
						// The connected "above" blob runs TL–center–BR: isolate TR, then BL.
						join(top as Crossing, right as Crossing);
						join(bottom as Crossing, left as Crossing);
					} else {
						// The connected "below" blob runs TR–center–BL: isolate TL, then BR.
						join(left as Crossing, top as Crossing);
						join(right as Crossing, bottom as Crossing);
					}
				}
			}
		}

		for (const points of stitch(segments)) result.push({ level, points });
	}

	return result;
}
