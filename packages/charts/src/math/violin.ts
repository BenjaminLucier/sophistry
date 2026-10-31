/** Violin geometry: a mirrored Gaussian kernel-density silhouette per group. */

import type { Point } from "@sophistry/core/geometry";
import { finiteValues, maxOf, minOf } from "@sophistry/core/internal";

/** @category Math */
export interface KdePoint {
	x: number;
	density: number;
}

/** @category Math */
export interface GaussianKdeOptions {
	/** Kernel bandwidth. Defaults to Silverman's rule of thumb. */
	bandwidth?: number;
	/** How many evenly spaced points to sample the density at. @default 80 */
	samples?: number;
	/**
	 * The span to sample over. Defaults to the finite extent of `values`, padded by `3 * bandwidth`
	 * each side.
	 */
	domain?: [number, number];
}

/** @category Math */
export interface ViolinRingOptions {
	/** Kernel bandwidth. Defaults to Silverman's rule of thumb. */
	bandwidth?: number;
	/** How many evenly spaced points to sample the density at. @default 80 */
	samples?: number;
	/** How far the silhouette reaches from `center` at its widest. @default 0.4 */
	scale?: number;
}

/** The bandwidth used when the data has zero spread. */
const FALLBACK_BANDWIDTH = 1e-6;
/**
 * `GaussianKdeOptions.samples`'s default.
 *
 * @category Math & helpers
 */
export const DEFAULT_SAMPLES = 80;
/**
 * `ViolinRingOptions.scale`'s default.
 *
 * @category Math & helpers
 */
export const DEFAULT_VIOLIN_SCALE = 0.4;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal density, the kernel. */
function gaussianPdf(u: number): number {
	return Math.exp(-(u * u) / 2) / SQRT_2PI;
}

/** Population standard deviation of `values` (divides by `n`, not `n - 1`). */
function stddev(values: readonly number[]): number {
	const n = values.length;
	const mean = values.reduce((sum, v) => sum + v, 0) / n;
	const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
	return Math.sqrt(variance);
}

/**
 * Silverman's rule-of-thumb bandwidth, `1.06 * stddev * n^(-1/5)` (population
 * standard deviation); `FALLBACK_BANDWIDTH` when every value is identical.
 */
function silvermanBandwidth(values: readonly number[]): number {
	const spread = stddev(values);
	if (spread === 0) return FALLBACK_BANDWIDTH;
	return 1.06 * spread * values.length ** (-1 / 5);
}

/**
 * Gaussian kernel density estimate of `values`, sampled at `samples` evenly
 * spaced points across `domain`.
 *
 * @param values - Raw samples; non-finite entries are dropped.
 * @returns `{ x, density }` points ascending in `x`; `[]` for empty input.
 * @category Math & helpers
 */
export function gaussianKde(
	values: readonly number[],
	options: GaussianKdeOptions = {},
): KdePoint[] {
	const finite = finiteValues(values);
	if (finite.length === 0) return [];

	const bandwidth = options.bandwidth ?? silvermanBandwidth(finite);
	const sampleCount = options.samples ?? DEFAULT_SAMPLES;

	const [domainMin, domainMax] =
		options.domain ??
		(() => {
			const dataMin = minOf(finite);
			const dataMax = maxOf(finite);
			const pad = 3 * bandwidth;
			return [dataMin - pad, dataMax + pad] as [number, number];
		})();

	const n = finite.length;
	const bins = linearBins(finite, bandwidth);
	const points: KdePoint[] = [];
	const step =
		sampleCount > 1 ? (domainMax - domainMin) / (sampleCount - 1) : 0;
	for (let i = 0; i < sampleCount; i++) {
		const x = sampleCount > 1 ? domainMin + i * step : domainMin;
		let sum = 0;
		if (bins) {
			const { centers, weights } = bins;
			for (let k = 0; k < centers.length; k++) {
				if (weights[k] > 0)
					sum += weights[k] * gaussianPdf((x - centers[k]) / bandwidth);
			}
		} else {
			for (const value of finite) {
				sum += gaussianPdf((x - value) / bandwidth);
			}
		}
		points.push({ x, density: sum / (n * bandwidth) });
	}
	return points;
}

/** Above this many values, {@link gaussianKde} sums over bins rather than values. */
const KDE_BINNING_THRESHOLD = 2000;
/** Grid nodes per bandwidth when binning: spacing `bandwidth / 8`. */
const KDE_BINS_PER_BANDWIDTH = 8;
/** Fewest and most grid nodes a binned estimate uses. */
const KDE_MIN_BINS = 1024;
const KDE_MAX_BINS = 8192;

/**
 * Linear binning, the standard fast KDE (Silverman 1982; Wand 1994): each
 * value's unit weight is split between the two grid nodes either side of it,
 * in proportion to nearness, and the kernel is then summed over the nodes —
 * samples × bins work rather than samples × values. The grid spans the data
 * at a spacing of at most an eighth of the bandwidth, which keeps the
 * estimate within a fraction of a percent of the exact sum.
 *
 * @returns The nodes and their weights, or undefined to sum exactly: few
 * enough values that binning wins nothing, a degenerate bandwidth, or a
 * bandwidth so narrow for the data's spread that the grid would need more
 * nodes than allowed.
 */
function linearBins(
	values: readonly number[],
	bandwidth: number,
): { centers: Float64Array; weights: Float64Array } | undefined {
	if (values.length <= KDE_BINNING_THRESHOLD) return undefined;
	if (!(bandwidth > 0) || !Number.isFinite(bandwidth)) return undefined;
	const min = minOf(values);
	const span = maxOf(values) - min;
	const count = Math.max(
		KDE_MIN_BINS,
		Math.ceil((span / bandwidth) * KDE_BINS_PER_BANDWIDTH) + 1,
	);
	if (count > Math.min(KDE_MAX_BINS, values.length / 2)) return undefined;
	const centers = new Float64Array(span > 0 ? count : 1);
	const weights = new Float64Array(centers.length);
	if (span === 0) {
		centers[0] = min;
		weights[0] = values.length;
		return { centers, weights };
	}
	const spacing = span / (count - 1);
	for (let k = 0; k < count; k++) centers[k] = min + k * spacing;
	for (const value of values) {
		const at = (value - min) / spacing;
		const below = Math.min(count - 2, Math.floor(at));
		const share = at - below;
		weights[below] += 1 - share;
		weights[below + 1] += share;
	}
	return { centers, weights };
}

/**
 * One violin's outline: a mirrored KDE silhouette as one open ring, upright
 * (y the data value, x around `center`). Each violin is normalized to its
 * own max density, so every one reaches `scale` at its widest: shapes
 * compare across groups, absolute densities don't.
 *
 * @param center - The slot centre the violin mirrors around, in x data units.
 * @returns The ring in data coordinates; `[]` with fewer than 2 finite values.
 * @category Math & helpers
 */
export function violinRing(
	values: readonly number[],
	center: number,
	options: ViolinRingOptions = {},
): Point[] {
	const finite = finiteValues(values);
	if (finite.length < 2) return [];

	const kde = gaussianKde(finite, options);
	if (kde.length === 0) return [];

	const maxDensity = maxOf(kde.map((point) => point.density));
	if (!Number.isFinite(maxDensity) || maxDensity === 0) return [];

	const scale = options.scale ?? DEFAULT_VIOLIN_SCALE;
	const right: Point[] = kde.map((point) => ({
		x: center + (point.density / maxDensity) * scale,
		y: point.x,
	}));
	const left: Point[] = [...kde].reverse().map((point) => ({
		x: center - (point.density / maxDensity) * scale,
		y: point.x,
	}));

	return [...right, ...left];
}

/**
 * One violin's half-silhouette before placement: the sampled heights
 * (ascending) and the width at each as a share of the widest. Keyed
 * transitions blend these ({@link blendViolinProfiles}) so every frame is a
 * valid violin.
 *
 * @category Math & helpers
 */
export interface ViolinProfile {
	/** Where the density was sampled, in data units, ascending. */
	readonly ys: readonly number[];
	/** The width at each of `ys`, as a share of the widest (0..1). */
	readonly widths: readonly number[];
}

/**
 * The profile {@link violinRing} mirrors: the KDE of `values` divided by its
 * largest density.
 *
 * @returns The profile, or null with fewer than 2 finite values or no usable density.
 * @category Math & helpers
 */
export function violinProfile(
	values: readonly number[],
	options: Pick<ViolinRingOptions, "bandwidth" | "samples"> = {},
): ViolinProfile | null {
	const finite = finiteValues(values);
	if (finite.length < 2) return null;
	const kde = gaussianKde(finite, options);
	if (kde.length === 0) return null;
	const maxDensity = maxOf(kde.map((point) => point.density));
	if (!Number.isFinite(maxDensity) || maxDensity === 0) return null;
	return {
		ys: kde.map((point) => point.x),
		widths: kde.map((point) => point.density / maxDensity),
	};
}

/**
 * A profile mirrored about `center` and scaled to reach `scale` at its
 * widest: {@link violinRing}'s ring, point for point.
 *
 * @category Math & helpers
 */
export function violinProfileRing(
	profile: ViolinProfile,
	center: number,
	scale: number,
): Point[] {
	const { ys, widths } = profile;
	const right: Point[] = ys.map((y, i) => ({
		x: center + widths[i] * scale,
		y,
	}));
	const left: Point[] = [];
	for (let i = ys.length - 1; i >= 0; i--)
		left.push({ x: center - widths[i] * scale, y: ys[i] });
	return [...right, ...left];
}

/** A profile's width at `y`: linear between its samples, 0 outside them. */
function widthAt(profile: ViolinProfile | null, y: number): number {
	if (!profile) return 0;
	const { ys, widths } = profile;
	const n = ys.length;
	if (n === 0 || y < ys[0] || y > ys[n - 1]) return 0;
	let hi = 1;
	while (hi < n - 1 && ys[hi] < y) hi++;
	const lo = hi - 1;
	if (n === 1 || ys[hi] === ys[lo]) return widths[lo];
	if (y >= ys[hi]) return widths[hi];
	const f = (y - ys[lo]) / (ys[hi] - ys[lo]);
	return widths[lo] + (widths[hi] - widths[lo]) * f;
}

/**
 * Two violin profiles blended at `t` on the union of their heights (each 0
 * beyond its own), so every frame is a valid outline. A missing (null) end
 * is a violin of zero width, so a violin grows out of or shrinks into its
 * centre line.
 *
 * @returns The blended profile; null only when both ends are.
 * @category Math & helpers
 */
export function blendViolinProfiles(
	a: ViolinProfile | null,
	b: ViolinProfile | null,
	t: number,
): ViolinProfile | null {
	if (t <= 0 && a) return a;
	if (t >= 1 && b) return b;
	if (!a && !b) return null;
	const ys = [...new Set([...(a?.ys ?? []), ...(b?.ys ?? [])])].sort(
		(p, q) => p - q,
	);
	const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
	return {
		ys,
		widths: ys.map((y) => {
			const from = widthAt(a, y);
			return from + (widthAt(b, y) - from) * u;
		}),
	};
}
