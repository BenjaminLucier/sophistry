/**
 * Contour lines, filled bands and flat pseudocolour over an unstructured
 * triangulation (values at scattered points rather than on a grid). The
 * mesh is the Delaunay triangulation or the caller's own triangles; over
 * each triangle the field is linear. Level conventions match the grid
 * versions: a count of line levels sits strictly inside the data's range, a
 * count of band boundaries spans it inclusively.
 */

import type { Point } from "@sophistry/core/geometry";
import { delaunayTriangleIndices } from "@sophistry/core/internal";
import type { ContourLine, KeyedSegment } from "./contour.js";
import { evenLevels, stitch } from "./contour.js";
import type { ContourBand, Vtx } from "./contourf.js";
import { clipByThreshold, evenBoundaries } from "./contourf.js";
import { resolveLevels } from "./shared/gridExtent.js";
import { pairCount } from "./shared/pairs.js";

/**
 * Three indices into the point arrays, one triangle.
 *
 * @category Math & helpers
 */
export type TriangleIndices = readonly [number, number, number];

/** @category Math */
export interface TriangulationOptions {
	/** The triangles, as index triples into the point arrays, either winding. Omitted, the points are Delaunay-triangulated. */
	triangles?: readonly TriangleIndices[];
}

/**
 * One face of a pseudocolour mesh.
 *
 * @category Math & helpers
 */
export interface TripcolorFace {
	/** The triangle's corners, as indices into the point arrays, counter-clockwise. */
	indices: [number, number, number];
	/** The corners in data units, counter-clockwise. */
	points: Point[];
	/** The mean of the corners' values: the face's colour value. */
	value: number;
}

const isFiniteAt = (values: readonly number[], i: number) =>
	Number.isFinite(values[i]);

/**
 * The triangles a tri-chart draws: the caller's own, checked and turned
 * counter-clockwise, or the Delaunay triangulation of the points. Triangles
 * with a non-finite corner or no area are dropped.
 *
 * @returns Counter-clockwise index triples into `xs`/`ys`.
 * @throws {RangeError} If an explicit triangle names a point that does not exist.
 * @category Math & helpers
 */
export function triangulate(
	xs: readonly number[],
	ys: readonly number[],
	options: TriangulationOptions = {},
): [number, number, number][] {
	const n = pairCount(xs, ys);
	const explicit = options.triangles;
	const source = explicit ?? delaunayTriangleIndices(xs, ys);
	const out: [number, number, number][] = [];
	for (const triangle of source) {
		const [a, b, c] = triangle;
		if (explicit) {
			for (const index of [a, b, c]) {
				if (!Number.isInteger(index) || index < 0 || index >= n) {
					throw new RangeError(
						`triangulate: triangle [${a}, ${b}, ${c}] names point ${index}, but there are ${n} points.`,
					);
				}
			}
		}
		if (![a, b, c].every((i) => isFiniteAt(xs, i) && isFiniteAt(ys, i)))
			continue;
		const area =
			(xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);
		if (!(Math.abs(area) > 0)) continue;
		out.push(area > 0 ? [a, b, c] : [a, c, b]);
	}
	return out;
}

/** Where `level` crosses the edge `i`–`j`, computed in index order so both triangles sharing the edge get the identical point. */
function crossing(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
	i: number,
	j: number,
	level: number,
): Point {
	const [p, q] = i < j ? [i, j] : [j, i];
	const t = (level - zs[p]) / (zs[q] - zs[p]);
	return { x: xs[p] + (xs[q] - xs[p]) * t, y: ys[p] + (ys[q] - ys[p]) * t };
}

/** A crossing's stitching key: the point itself when exactly on the level, else its mesh edge (shared by both triangles). */
function crossingKey(
	zs: readonly number[],
	i: number,
	j: number,
	level: number,
): number {
	if (zs[i] === level) return -1 - i;
	if (zs[j] === level) return -1 - j;
	const [p, q] = i < j ? [i, j] : [j, i];
	return p * zs.length + q;
}

/**
 * Iso-lines of a field sampled at scattered points, by marching triangles.
 *
 * @param zs - The value at each point; triangles touching a non-finite value are skipped.
 * @param levels - Explicit levels, or a count of evenly spaced ones strictly inside the data's range.
 * @returns Polylines tagged with their level, in level order.
 * @throws {RangeError} If an explicit triangle names a point that does not exist.
 * @category Math & helpers
 */
export function tricontourLines(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
	levels: readonly number[] | number,
	options: TriangulationOptions = {},
): ContourLine[] {
	const triangles = triangulate(xs, ys, options);
	const resolved = resolveLevels(levels, [zs], evenLevels);
	const result: ContourLine[] = [];
	for (const level of resolved) {
		if (!Number.isFinite(level)) continue;
		const segments: KeyedSegment[] = [];
		for (const [a, b, c] of triangles) {
			if (!isFiniteAt(zs, a) || !isFiniteAt(zs, b) || !isFiniteAt(zs, c))
				continue;
			const above = [zs[a] >= level, zs[b] >= level, zs[c] >= level];
			if (above[0] === above[1] && above[1] === above[2]) continue;
			const corners = [a, b, c];
			const points: Point[] = [];
			const keys: number[] = [];
			for (let e = 0; e < 3; e++) {
				const f = (e + 1) % 3;
				if (above[e] !== above[f]) {
					points.push(crossing(xs, ys, zs, corners[e], corners[f], level));
					keys.push(crossingKey(zs, corners[e], corners[f], level));
				}
			}
			if (points.length === 2) {
				segments.push({
					keys: [keys[0], keys[1]],
					points: [points[0], points[1]],
				});
			}
		}
		for (const points of stitch(segments)) result.push({ level, points });
	}
	return result;
}

/**
 * Filled bands of a field sampled at scattered points: each triangle clipped
 * to every band between consecutive boundaries.
 *
 * @param zs - The value at each point; triangles touching a non-finite value are skipped.
 * @param levels - Explicit boundaries, or a count spanning the data (`N` make `N - 1` bands).
 * @returns One {@link ContourBand} per band, its polygons counter-clockwise, one per contributing triangle.
 * @throws {RangeError} If an explicit triangle names a point that does not exist.
 * @category Math & helpers
 */
export function tricontourBands(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
	levels: readonly number[] | number,
	options: TriangulationOptions = {},
): ContourBand[] {
	const triangles = triangulate(xs, ys, options);
	const resolved = resolveLevels(levels, [zs], evenBoundaries);
	if (resolved.length < 2) return [];
	const bands: ContourBand[] = resolved.slice(1).map((hiLevel, i) => ({
		loLevel: resolved[i],
		hiLevel,
		polygons: [],
	}));
	for (const [a, b, c] of triangles) {
		if (!isFiniteAt(zs, a) || !isFiniteAt(zs, b) || !isFiniteAt(zs, c))
			continue;
		const triangle: Vtx[] = [a, b, c].map((i) => ({
			x: xs[i],
			y: ys[i],
			z: zs[i],
		}));
		for (const band of bands) {
			const lower = clipByThreshold(triangle, band.loLevel, true);
			const clipped = clipByThreshold(lower, band.hiLevel, false);
			if (clipped.length >= 3) {
				band.polygons.push(clipped.map((v) => ({ x: v.x, y: v.y })));
			}
		}
	}
	return bands;
}

/**
 * Flat-shaded pseudocolour faces over scattered points: one per triangle,
 * valued at the mean of its corners.
 *
 * @param zs - The value at each point; triangles touching a non-finite value are skipped.
 * @returns One face per drawable triangle, in triangulation order.
 * @throws {RangeError} If an explicit triangle names a point that does not exist.
 * @category Math & helpers
 */
export function tripcolorFaces(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
	options: TriangulationOptions = {},
): TripcolorFace[] {
	const faces: TripcolorFace[] = [];
	for (const indices of triangulate(xs, ys, options)) {
		const [a, b, c] = indices;
		if (!isFiniteAt(zs, a) || !isFiniteAt(zs, b) || !isFiniteAt(zs, c))
			continue;
		faces.push({
			indices,
			points: indices.map((i) => ({ x: xs[i], y: ys[i] })),
			value: (zs[a] + zs[b] + zs[c]) / 3,
		});
	}
	return faces;
}
