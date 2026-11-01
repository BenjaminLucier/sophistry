/** `scatter(x, y)` — one marker per finite `(x, y)` pair. */

import { pairCount } from "./shared/pairs.js";

/** @category Math */
export interface ScatterPoint {
	/** Index into the input `xs`/`ys`, keeping `sizes`/`colors` aligned past dropped pairs. */
	index: number;
	x: number;
	y: number;
}

/**
 * The finite `(x, y)` pairs, paired by index, each keeping its index.
 *
 * @category Math & helpers
 */
export function scatterPoints(
	xs: readonly number[],
	ys: readonly number[],
): ScatterPoint[] {
	const n = pairCount(xs, ys);
	const points: ScatterPoint[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		if (Number.isFinite(x) && Number.isFinite(y))
			points.push({ index: i, x, y });
	}
	return points;
}
