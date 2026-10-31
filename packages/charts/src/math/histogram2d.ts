/** 2D histogram: finite `(x, y)` pairs counted into a grid of equal-width cells. */

import type { Range } from "@sophistry/core/geometry";
import { extent } from "d3-array";
import { DEFAULT_BIN_COUNT } from "./histogram";
import {
	binEdges,
	binIndex,
	resolveBinning,
	widenDegenerate,
} from "./shared/binning";
import { pairCount } from "./shared/pairs";

/** @category Math */
export interface Histogram2D {
	/** `xBins + 1` x bin boundaries, ascending. */
	xEdges: number[];
	/** `yBins + 1` y bin boundaries, ascending. */
	yEdges: number[];
	/** `counts[row = yBin][col = xBin]`. */
	counts: number[][];
	/** Largest cell value, or 0 if there were no finite pairs. */
	maxCount: number;
}

/** @category Math */
export interface Histogram2DOptions {
	/**
	 * How many equal-width columns to split `xRange` into; wins over an `xRange` step. Defaults to
	 * the step's count, else 10.
	 */
	xBins?: number;
	/**
	 * How many equal-width rows to split `yRange` into; wins over a `yRange` step. Defaults to the
	 * step's count, else 10.
	 */
	yBins?: number;
	/**
	 * `[min, max, step?]`; `step` is the bin width unless `xBins` is given. Defaults to the finite
	 * extent of `xs`.
	 */
	xRange?: Range;
	/**
	 * `[min, max, step?]`; `step` is the bin height unless `yBins` is given. Defaults to the finite
	 * extent of `ys`.
	 */
	yRange?: Range;
}

/**
 * Bins `(x, y)` pairs (paired by index; dropped unless both are finite)
 * into an `xBins × yBins` grid over `xRange` and `yRange`.
 *
 * @returns Both axes' edges, the `counts[row][col]` grid and the largest count.
 * @category Math & helpers
 */
export function histogram2d(
	xs: readonly number[],
	ys: readonly number[],
	options: Histogram2DOptions = {},
): Histogram2D {
	const n = pairCount(xs, ys);
	const finiteXs: number[] = [];
	const finiteYs: number[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		if (Number.isFinite(x) && Number.isFinite(y)) {
			finiteXs.push(x);
			finiteYs.push(y);
		}
	}

	let [xMin, xMax] = options.xRange ?? extent(finiteXs);
	let [yMin, yMax] = options.yRange ?? extent(finiteYs);
	if (xMin === undefined || xMax === undefined) {
		xMin = 0;
		xMax = 1;
	}
	if (yMin === undefined || yMax === undefined) {
		yMin = 0;
		yMax = 1;
	}
	[xMin, xMax] = widenDegenerate(xMin, xMax);
	[yMin, yMax] = widenDegenerate(yMin, yMax);

	const xBinning = resolveBinning(
		xMin,
		xMax,
		options.xBins,
		options.xRange?.[2],
		DEFAULT_BIN_COUNT,
	);
	const yBinning = resolveBinning(
		yMin,
		yMax,
		options.yBins,
		options.yRange?.[2],
		DEFAULT_BIN_COUNT,
	);
	const cols = xBinning.n;
	const rows = yBinning.n;
	xMax = xBinning.max;
	yMax = yBinning.max;

	const xEdges = binEdges(xMin, xMax, cols);
	const yEdges = binEdges(yMin, yMax, rows);

	const counts: number[][] = Array.from({ length: rows }, () =>
		new Array(cols).fill(0),
	);

	let maxCount = 0;
	for (let i = 0; i < finiteXs.length; i++) {
		const x = finiteXs[i];
		const y = finiteYs[i];
		if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
		const xi = binIndex(x, xMin, xMax, cols);
		const yi = binIndex(y, yMin, yMax, rows);
		const value = ++counts[yi][xi];
		if (value > maxCount) maxCount = value;
	}

	return { xEdges, yEdges, counts, maxCount };
}
