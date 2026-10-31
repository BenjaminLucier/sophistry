/**
 * Regression and intervals: least-squares polynomial fits with a confidence
 * band for the fitted mean, LOESS smoothing (optionally robust, with a band),
 * and the t-based confidence interval of a sample mean.
 */

import { finiteValues, maxOf, minOf } from "@sophistry/core/internal";
import { mean } from "d3-array";

/** @category Math */
export interface RegressionPoint {
	x: number;
	/** The fitted value. */
	y: number;
	/** Lower end of the confidence band for the fitted mean (`y` when there is no band). */
	low: number;
	/** Upper end of the band. */
	high: number;
}

/** @category Math */
export interface RegressionOptions {
	/** Polynomial degree: 1 is a straight line, 2 a parabola, ... @default 1 */
	degree?: number;
	/** Confidence level of the band around the fitted mean, 0..1; 0 draws no band. @default 0.95 */
	level?: number;
	/** How many evenly spaced x positions to evaluate the fit at. @default 50 */
	samples?: number;
	/** The x span to evaluate over. Defaults to the data's x extent. */
	domain?: [number, number];
}

const DEFAULT_LEVEL = 0.95;
const SAMPLES = 50;

/**
 * A least-squares polynomial fit of `ys` on `xs`, with the confidence band
 * of the fitted mean `ŷ ± t(level, n − p) · s · √(x₀ᵀ (XᵀX)⁻¹ x₀)`. Pairs
 * with a non-finite member are dropped; with no more points than
 * coefficients the result is `[]`.
 *
 * @param ys - Responses, paired with `xs` by index.
 * @returns Points ascending in x.
 * @category Math & helpers
 */
export function regression(
	xs: readonly number[],
	ys: readonly number[],
	options: RegressionOptions = {},
): RegressionPoint[] {
	const degree = Math.max(0, Math.floor(options.degree ?? 1));
	const pairs = finitePairs(xs, ys);
	const n = pairs.length;
	const p = degree + 1;
	if (n <= p) return [];

	// Centre and scale x so the normal equations stay well conditioned.
	const px = pairs.map(([x]) => x);
	const lo = minOf(px);
	const hi = maxOf(px);
	const centre = (lo + hi) / 2;
	const half = hi > lo ? (hi - lo) / 2 : 1;
	const row = (x: number) => {
		const u = (x - centre) / half;
		return Array.from({ length: p }, (_, k) => u ** k);
	};

	const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0));
	const xty = new Array<number>(p).fill(0);
	for (const [x, y] of pairs) {
		const r = row(x);
		for (let a = 0; a < p; a++) {
			xty[a] += r[a] * y;
			for (let b = 0; b < p; b++) xtx[a][b] += r[a] * r[b];
		}
	}
	const inverse = invert(xtx);
	if (!inverse) return [];
	const beta = inverse.map((r) => r.reduce((s, v, b) => s + v * xty[b], 0));
	const predict = (r: readonly number[]) =>
		r.reduce((s, v, k) => s + v * beta[k], 0);

	const level = options.level ?? DEFAULT_LEVEL;
	const sse = pairs.reduce((s, [x, y]) => s + (y - predict(row(x))) ** 2, 0);
	const s = Math.sqrt(sse / (n - p));
	const t = level > 0 && level < 1 ? studentT((1 + level) / 2, n - p) : 0;

	const [from, to] = options.domain ?? [lo, hi];
	const count = Math.max(2, Math.floor(options.samples ?? SAMPLES));
	return Array.from({ length: count }, (_, i) => {
		const x = from + ((to - from) * i) / (count - 1);
		const r = row(x);
		const y = predict(r);
		let leverage = 0;
		for (let a = 0; a < p; a++)
			for (let b = 0; b < p; b++) leverage += r[a] * inverse[a][b] * r[b];
		const margin = t * s * Math.sqrt(Math.max(0, leverage));
		return { x, y, low: y - margin, high: y + margin };
	});
}

/** @category Math */
export interface LoessOptions {
	/** Fraction of the points each local fit uses, 0..1. @default 0.3 */
	bandwidth?: number;
	/** How many evenly spaced x positions to evaluate at. @default 50 */
	samples?: number;
	/**
	 * Robustness iterations: each re-weights points by their residual (bisquare)
	 * and refits, so outliers stop pulling the smooth; 2 is the usual choice.
	 * @default 0
	 */
	iterations?: number;
}

/** @category Math */
export interface LoessBandOptions extends LoessOptions {
	/** Confidence level of the band around the smooth, 0..1; 0 draws no band. @default 0.95 */
	level?: number;
}

/**
 * LOESS: a locally weighted linear fit at each sample over the nearest
 * `bandwidth` fraction of the points (tricube weights), optionally robust to
 * outliers. {@link loessBand} adds a confidence band.
 *
 * @param ys - Responses, paired with `xs` by index; non-finite pairs dropped.
 * @returns Points ascending in x across the data's extent; `[]` with fewer than 2 points.
 * @category Math & helpers
 */
export function loess(
	xs: readonly number[],
	ys: readonly number[],
	options: LoessOptions = {},
): { x: number; y: number }[] {
	return loessBand(xs, ys, { ...options, level: 0 }).map(({ x, y }) => ({
		x,
		y,
	}));
}

/**
 * {@link loess} with a confidence band for the smooth:
 * `ŷ ± t(level, δ₁) · σ̂ · ‖l(x₀)‖`, with `σ̂² = RSS / δ₁` and
 * `δ₁ = tr((I − L)ᵀ(I − L))` over the smoother matrix `L`. Robustness
 * weights are folded in, so ignored outliers don't widen the band.
 *
 * @param ys - Responses, paired with `xs` by index; non-finite pairs dropped.
 * @returns Points ascending in x across the data's extent; `[]` with fewer
 *   than 2 points. With 3 points or fewer, or an interpolating smoother, no
 *   band (`low === high === y`).
 * @category Math & helpers
 */
export function loessBand(
	xs: readonly number[],
	ys: readonly number[],
	options: LoessBandOptions = {},
): RegressionPoint[] {
	const pairs = finitePairs(xs, ys).sort((a, b) => a[0] - b[0]);
	const n = pairs.length;
	if (n < 2) return [];
	const bandwidth = Math.min(1, Math.max(0, options.bandwidth ?? 0.3));
	const q = Math.min(n, Math.max(2, Math.ceil(bandwidth * n)));
	const iterations = Math.max(0, Math.floor(options.iterations ?? 0) || 0);
	const px = pairs.map(([x]) => x);
	const py = pairs.map(([, y]) => y);

	/** Robustness weights, one per point (all 1 before any iteration). */
	let robust: number[] = new Array<number>(n).fill(1);
	for (let pass = 0; pass < iterations; pass++) {
		const residuals = px.map(
			(x, i) => py[i] - smoothAt(px, py, x, q, robust).y,
		);
		const sizes = residuals.map(Math.abs);
		const scale = 6 * median(sizes);
		// As R's `lowess`: a median residual of (effectively) zero means most
		// points are fitted exactly, and there is nothing to re-weight by.
		const typical = sizes.reduce((a, b) => a + b, 0) / n;
		if (!(scale > 1e-7 * typical) || !(typical > 0)) break;
		robust = residuals.map((r) => {
			const u = r / scale;
			return Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0;
		});
	}

	const level = options.level ?? DEFAULT_LEVEL;
	let sigma = 0;
	let t = 0;
	if (level > 0 && level < 1 && n > 3) {
		// δ₁ = Σᵢ ‖(I − L)ᵢ‖² from each data point's smoother row, and the
		// residual scale, each residual weighted by its robustness weight.
		let delta = 0;
		let rss = 0;
		let weight = 0;
		px.forEach((x, i) => {
			const fit = smoothAt(px, py, x, q, robust);
			let own = 0;
			let sumSq = 0;
			fit.indices.forEach((j, k) => {
				const l = fit.weights[k];
				sumSq += l * l;
				if (j === i) own = l;
			});
			delta += sumSq - 2 * own + 1;
			const r = py[i] - fit.y;
			if (Number.isFinite(r)) {
				rss += robust[i] * r * r;
				weight += robust[i];
			}
		});
		if (delta > 1e-9 && weight > 0) {
			sigma = Math.sqrt(((rss / weight) * n) / delta);
			t = studentT((1 + level) / 2, Math.max(1, delta));
		}
	}

	const lo = px[0];
	const hi = px[n - 1];
	const count = Math.max(2, Math.floor(options.samples ?? SAMPLES));
	return Array.from({ length: count }, (_, i) => {
		const x = lo + ((hi - lo) * i) / (count - 1);
		const fit = smoothAt(px, py, x, q, robust);
		if (!(t > 0 && sigma > 0) || !Number.isFinite(fit.y))
			return { x, y: fit.y, low: fit.y, high: fit.y };
		const norm = Math.sqrt(fit.weights.reduce((s, l) => s + l * l, 0));
		const margin = t * sigma * norm;
		return { x, y: fit.y, low: fit.y - margin, high: fit.y + margin };
	});
}

/** The local linear fit at `x0` over the `q` nearest points, as smoother coefficients: `y = Σ lⱼ · ys[indices[j]]`. */
function smoothAt(
	xs: readonly number[],
	ys: readonly number[],
	x0: number,
	q: number,
	robust: readonly number[],
): { y: number; indices: number[]; weights: number[] } {
	const nearest = xs
		.map((x, i) => ({ i, d: Math.abs(x - x0) }))
		.sort((a, b) => a.d - b.d || a.i - b.i)
		.slice(0, q);
	const reach = nearest[nearest.length - 1].d * 1.000001 || 1;
	const indices = nearest.map((p) => p.i);
	const w = nearest.map((p) => (1 - (p.d / reach) ** 3) ** 3 * robust[p.i]);
	const sw = w.reduce((a, b) => a + b, 0);
	if (!(sw > 0)) return { y: Number.NaN, indices, weights: w.map(() => 0) };
	let mx = 0;
	for (let k = 0; k < w.length; k++) mx += w[k] * xs[indices[k]];
	mx /= sw;
	let sxx = 0;
	for (let k = 0; k < w.length; k++) sxx += w[k] * (xs[indices[k]] - mx) ** 2;
	// Relative to the weighted spread: a neighbourhood at one x has no slope.
	const sloped = sxx / sw > 1e-12;
	const weights = w.map(
		(wk, k) =>
			wk / sw + (sloped ? ((x0 - mx) * wk * (xs[indices[k]] - mx)) / sxx : 0),
	);
	let y = 0;
	for (let k = 0; k < weights.length; k++) y += weights[k] * ys[indices[k]];
	return { y, indices, weights };
}

/** The median of a non-empty list (unsorted input). */
function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
}

/** @category Math */
export interface MeanInterval {
	mean: number;
	low: number;
	high: number;
	/** How many finite values the interval is over. */
	n: number;
}

/**
 * The mean of `values` with an interval: `"ci"` the t-based confidence
 * interval at `level`, `"se"` ± one standard error, `"sd"` ± one sample
 * standard deviation. Non-finite values are dropped; with none every field
 * is `NaN` and `n` is 0.
 *
 * @param interval - Defaults to `"ci"`.
 * @param level - Confidence level for `"ci"`, 0..1. Defaults to 0.95.
 * @category Math & helpers
 */
export function meanInterval(
	values: readonly number[],
	interval: "ci" | "se" | "sd" = "ci",
	level = DEFAULT_LEVEL,
): MeanInterval {
	const finite = finiteValues(values);
	const n = finite.length;
	if (n === 0)
		return { mean: Number.NaN, low: Number.NaN, high: Number.NaN, n: 0 };
	const m = mean(finite) ?? Number.NaN;
	if (n === 1) return { mean: m, low: m, high: m, n };
	const sd = Math.sqrt(finite.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
	const se = sd / Math.sqrt(n);
	const margin =
		interval === "sd"
			? sd
			: interval === "se"
				? se
				: se * studentT((1 + level) / 2, n - 1);
	return { mean: m, low: m - margin, high: m + margin, n };
}

/**
 * The `p` quantile of Student's t distribution with `df` degrees of
 * freedom: exact for 1 and 2, a Cornish–Fisher expansion (within ~0.1%)
 * above.
 *
 * @returns The quantile; `NaN` outside the domain.
 * @category Math & helpers
 */
export function studentT(p: number, df: number): number {
	if (!(p > 0 && p < 1) || !(df >= 1)) return Number.NaN;
	if (df === 1) return Math.tan(Math.PI * (p - 0.5));
	if (df === 2) return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
	const z = normalQuantile(p);
	const z2 = z * z;
	const g1 = (z2 + 1) * z * 0.25;
	const g2 = ((5 * z2 + 16) * z2 + 3) * z * (1 / 96);
	const g3 = (((3 * z2 + 19) * z2 + 17) * z2 - 15) * z * (1 / 384);
	const g4 = ((((79 * z2 + 776) * z2 + 1482) * z2 - 1920) * z2 - 945) * z;
	return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / (92160 * df ** 4);
}

/** The standard normal quantile (Acklam's rational approximation, relative error below 1.2e-9). */
function normalQuantile(p: number): number {
	const a = [
		-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
		-30.66479806614716, 2.506628277459239,
	];
	const b = [
		-54.47609879822406, 161.5858368580409, -155.6989798598866,
		66.80131188771972, -13.28068155288572,
	];
	const c = [
		-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
		-2.549732539343734, 4.374664141464968, 2.938163982698783,
	];
	const d = [
		0.007784695709041462, 0.3224671290700398, 2.445134137142996,
		3.754408661907416,
	];
	const low = 0.02425;
	if (p < low) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (
			(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
			((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
		);
	}
	if (p > 1 - low) return -normalQuantile(1 - p);
	const q = p - 0.5;
	const r = q * q;
	return (
		((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
			q) /
		(((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
	);
}

/** Finite `(x, y)` pairs, paired by index up to the shorter array. */
function finitePairs(
	xs: readonly number[],
	ys: readonly number[],
): [number, number][] {
	const pairs: [number, number][] = [];
	const n = Math.min(xs.length, ys.length);
	for (let i = 0; i < n; i++) {
		if (Number.isFinite(xs[i]) && Number.isFinite(ys[i]))
			pairs.push([xs[i], ys[i]]);
	}
	return pairs;
}

/** Gauss–Jordan inverse of a small square matrix, or null when singular. */
function invert(matrix: readonly (readonly number[])[]): number[][] | null {
	const n = matrix.length;
	const a = matrix.map((row, i) => [
		...row,
		...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
	]);
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let r = col + 1; r < n; r++)
			if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
		if (Math.abs(a[pivot][col]) < 1e-12) return null;
		[a[col], a[pivot]] = [a[pivot], a[col]];
		const scale = a[col][col];
		for (let k = 0; k < 2 * n; k++) a[col][k] /= scale;
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const factor = a[r][col];
			if (factor === 0) continue;
			for (let k = 0; k < 2 * n; k++) a[r][k] -= factor * a[col][k];
		}
	}
	return a.map((row) => row.slice(n));
}
