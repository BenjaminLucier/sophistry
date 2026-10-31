/** The region between two series over shared `x` values: a confidence band or min/max envelope. */

import type { CurveKind, CurvePath, Point } from "@sophistry/core/geometry";
import { areaCurvePath, closedCurvePath } from "@sophistry/core/geometry";
import { pairCount } from "./shared/pairs";

/**
 * One ring per continuous run, returned closed (first point repeated), as
 * the reveal walks it back to its start.
 *
 * @category Math & helpers
 */
export type FillBetweenRings = Point[][];

/** A ring closed with its first point repeated. */
function ring(points: Point[]): Point[] {
	if (points.length === 0) return points;
	return [...points, { ...points[0] }];
}

/**
 * One closed ring per continuous run of `(x, y1, y2)`, split wherever a value
 * is non-finite, so a gap shades as two regions.
 *
 * @param y1 - One boundary, parallel to `xs`.
 * @param y2 - The other boundary, parallel to `xs`.
 * @returns Closed rings, one per run of at least 2 finite points.
 * @category Math & helpers
 */
export function fillBetweenRings(
	xs: readonly number[],
	y1: readonly number[],
	y2: readonly number[],
): FillBetweenRings {
	const n = Math.min(pairCount(xs, y1), y2.length);
	const rings: Point[][] = [];
	let upper: Point[] = [];
	let lower: Point[] = [];
	const flush = () => {
		if (upper.length > 1) rings.push(ring([...upper, ...lower.reverse()]));
		upper = [];
		lower = [];
	};
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const a = y1[i];
		const b = y2[i];
		if (Number.isFinite(x) && Number.isFinite(a) && Number.isFinite(b)) {
			upper.push({ x, y: a });
			lower.push({ x, y: b });
		} else {
			flush();
		}
	}
	flush();
	return rings;
}

/**
 * One of {@link fillBetweenRings}' rings (in any units) as a closed curve,
 * each boundary curved on its own so a boundary shared by adjacent bands is
 * the same curve in both. A ring of another shape is closed straight.
 *
 * @param ring - `n` upper points, `n` lower points reversed, the first repeated.
 * @category Math & helpers
 */
export function fillBetweenCurve(
	ring: readonly Point[],
	curve: CurveKind,
): CurvePath {
	const n = (ring.length - 1) / 2;
	if (!Number.isInteger(n) || n < 1) return closedCurvePath(ring, "linear");
	const upper = ring.slice(0, n);
	const lower = ring.slice(n, 2 * n).reverse();
	return areaCurvePath(upper, lower, curve);
}
