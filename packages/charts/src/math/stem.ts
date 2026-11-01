/** `stem(x, y)` — a drop line and a marker for each finite `(x, y)` pair. */

import type { Point } from "@sophistry/core/geometry";
import { pairCount } from "./shared/pairs.js";

/** @category Math */
export interface StemPoint {
	/** Index into the input `xs`/`ys`, matching a point to its row after non-finite pairs are dropped. */
	index: number;
	/** `baseline → (x, y)`, in data coordinates. */
	drop: [Point, Point];
	marker: Point;
}

/** @category Math */
export interface StemOptions {
	/** The y value each drop line starts from. @default 0 */
	baseline?: number;
}

const DEFAULT_BASELINE = 0;

/**
 * One drop line and marker per finite `(x, y)` pair, paired by index.
 *
 * @category Math & helpers
 */
export function stemPoints(
	xs: readonly number[],
	ys: readonly number[],
	options: StemOptions = {},
): StemPoint[] {
	const baseline = options.baseline ?? DEFAULT_BASELINE;
	const n = pairCount(xs, ys);
	const points: StemPoint[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		points.push({
			index: i,
			drop: [
				{ x, y: baseline },
				{ x, y },
			],
			marker: { x, y },
		});
	}
	return points;
}
