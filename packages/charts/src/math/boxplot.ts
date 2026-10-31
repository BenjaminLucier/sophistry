/** Box-and-whisker statistics: quartiles, median, whiskers clipped to Tukey's fences, and outliers beyond them. */

import { finiteValues } from "@sophistry/core/internal";
import { quantile } from "d3-array";

/** @category Math */
export interface BoxplotStats {
	min: number;
	q1: number;
	median: number;
	q3: number;
	max: number;
	/** Lower whisker end — the smallest finite value still inside the fence. */
	low: number;
	/** Upper whisker end — the largest finite value still inside the fence. */
	high: number;
	/** Finite values outside `[q1 - whiskerScale * iqr, q3 + whiskerScale * iqr]`. */
	outliers: number[];
}

/** @category Math */
export interface BoxplotOptions {
	/** How many IQRs past q1/q3 the whiskers may reach before a point is an outlier. @default 1.5 */
	whiskerScale?: number;
}

/**
 * `BoxplotOptions.whiskerScale`'s default.
 *
 * @category Math & helpers
 */
export const DEFAULT_WHISKER_SCALE = 1.5;

/**
 * Five-number summary of `values` by Tukey's rule: whiskers reach the most
 * extreme value within `whiskerScale * iqr` of the box; anything further is
 * an outlier.
 *
 * @param values - Raw samples; non-finite entries are dropped.
 * @returns The summary, or `null` when no finite value remains.
 * @category Math & helpers
 */
export function boxplotStats(
	values: readonly number[],
	options: BoxplotOptions = {},
): BoxplotStats | null {
	const finite = finiteValues(values);
	if (finite.length === 0) return null;

	const whiskerScale = options.whiskerScale ?? DEFAULT_WHISKER_SCALE;

	const sorted = [...finite].sort((a, b) => a - b);
	const q1 = quantile(sorted, 0.25) ?? sorted[0];
	const median = quantile(sorted, 0.5) ?? sorted[0];
	const q3 = quantile(sorted, 0.75) ?? sorted[0];
	const iqr = q3 - q1;
	const fenceLow = q1 - whiskerScale * iqr;
	const fenceHigh = q3 + whiskerScale * iqr;

	const inFence = sorted.filter((v) => v >= fenceLow && v <= fenceHigh);
	const outliers = sorted.filter((v) => v < fenceLow || v > fenceHigh);

	return {
		min: sorted[0],
		q1,
		median,
		q3,
		max: sorted[sorted.length - 1],
		low: inFence.length > 0 ? inFence[0] : q1,
		high: inFence.length > 0 ? inFence[inFence.length - 1] : q3,
		outliers,
	};
}
