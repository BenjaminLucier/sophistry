/** `errorbar(x, y, yerr, xerr)` — a marker plus optional error bars for each finite `(x, y)` pair. */

import type { Point } from "@sophistry/core/geometry";
import { pairCount } from "./shared/pairs";

/**
 * Symmetric errors as one magnitude per index, or asymmetric ones as a
 * `[lower[], upper[]]` tuple.
 *
 * @category Math & helpers
 */
export type ErrorSpec =
	| readonly number[]
	| readonly [readonly number[], readonly number[]];

/** @category Math */
export interface ErrorBarPoint {
	/** Index into the input `xs`/`ys`, matching a point to its row after non-finite pairs are dropped. */
	index: number;
	point: Point;
	/** `[point - lower, point + upper]` along y; omitted where `yerr` has no finite magnitude here. */
	yBar?: [Point, Point];
	/** `[point - lower, point + upper]` along x; omitted where `xerr` has no finite magnitude here. */
	xBar?: [Point, Point];
}

/** Resolves one `ErrorSpec` at `i` to a finite `{ lower, upper }` magnitude pair, or `undefined` if unavailable. */
function resolveError(
	spec: ErrorSpec | undefined,
	i: number,
): { lower: number; upper: number } | undefined {
	if (!spec) return undefined;
	const isAsymmetric = spec.length === 2 && Array.isArray(spec[0]);
	const lower = isAsymmetric
		? (spec as readonly [readonly number[], readonly number[]])[0][i]
		: (spec as readonly number[])[i];
	const upper = isAsymmetric
		? (spec as readonly [readonly number[], readonly number[]])[1][i]
		: (spec as readonly number[])[i];
	if (!Number.isFinite(lower) || !Number.isFinite(upper)) return undefined;
	return { lower, upper };
}

/**
 * One marker plus optional error bars per finite `(x, y)` pair.
 *
 * @param yerr - Vertical error magnitudes. See {@link ErrorSpec}.
 * @param xerr - Horizontal error magnitudes. See {@link ErrorSpec}.
 * @category Math & helpers
 */
export function errorBarPoints(
	xs: readonly number[],
	ys: readonly number[],
	yerr?: ErrorSpec,
	xerr?: ErrorSpec,
): ErrorBarPoint[] {
	const n = pairCount(xs, ys);
	const points: ErrorBarPoint[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

		const result: ErrorBarPoint = { index: i, point: { x, y } };

		const yMag = resolveError(yerr, i);
		if (yMag) {
			result.yBar = [
				{ x, y: y - yMag.lower },
				{ x, y: y + yMag.upper },
			];
		}

		const xMag = resolveError(xerr, i);
		if (xMag) {
			result.xBar = [
				{ x: x - xMag.lower, y },
				{ x: x + xMag.upper, y },
			];
		}

		points.push(result);
	}
	return points;
}
