/** Histogram binning: equal-width buckets over a value range, counted. */

import type { Range } from "@sophistry/core/geometry";
import { finiteValues } from "@sophistry/core/internal";
import { extent } from "d3-array";
import {
	binEdges,
	binIndex,
	resolveBinning,
	widenDegenerate,
} from "./shared/binning";

/** @category Math */
export interface HistogramBins {
	/** `binCount + 1` bin boundaries, ascending. Bin `i` covers `[edges[i], edges[i + 1])`. */
	edges: number[];
	/** One count per bin, parallel to the gaps between `edges`. */
	counts: number[];
}

/** @category Math */
export interface HistogramOptions {
	/**
	 * How many equal-width buckets to split `range` into; wins over a `range` step. Defaults to the
	 * count implied by the `range` step, else 10.
	 */
	binCount?: number;
	/**
	 * `[min, max, step?]`. Without `binCount`, `step` is the bin width (the last
	 * edge extends to a whole step). Defaults to the finite extent of `values`.
	 */
	range?: Range;
}

/**
 * `HistogramOptions.binCount`'s default.
 *
 * @category Math & helpers
 */
export const DEFAULT_BIN_COUNT = 10;

/**
 * Bins `values` into equal-width buckets across `range`. Non-finite values
 * are dropped; the last bin is right-inclusive so the maximum lands in it.
 *
 * @returns `edges` (`binCount + 1` boundaries) and `counts` (one per bin).
 * @category Math & helpers
 */
export function histogramBins(
	values: readonly number[],
	options: HistogramOptions = {},
): HistogramBins {
	const finite = finiteValues(values);

	let [min, max] = options.range ?? extent(finite);
	const step = options.range?.[2];
	if (min === undefined || max === undefined) {
		// No data and no explicit range — an arbitrary unit span so the edges
		// are still well-formed rather than NaN-laced.
		min = 0;
		max = 1;
	}
	// A degenerate range (all values identical, or an explicit point range)
	// would divide by zero when locating a bin. Widen symmetrically to a
	// small nonzero span, same spirit as `autoRange`'s `if (low === high)
	// return [0, 1, 1]` — an arbitrary but harmless width standing in for
	// "no spread to show".
	[min, max] = widenDegenerate(min, max);

	const bins = resolveBinning(
		min,
		max,
		options.binCount,
		step,
		DEFAULT_BIN_COUNT,
	);
	const n = bins.n;
	max = bins.max;
	const edges = binEdges(min, max, n);

	const counts = new Array(n).fill(0);
	for (const value of finite) {
		if (value < min || value > max) continue;
		counts[binIndex(value, min, max, n)]++;
	}

	return { edges, counts };
}
