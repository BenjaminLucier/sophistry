/**
 * Band scales (d3's `scaleBand`): category `i` owns the numeric slot
 * `[i, i + 1]`, and its band is that slot minus `padding`, aligned by `align`. The
 * axis stays numeric, so `coordsToPoint` and annotations work unchanged.
 */

import { clamp01, mix } from "./num.js";
import type { Range } from "./scale/scales.js";

/**
 * A category on a band axis: a string, or a number used as a name (a year,
 * an index). Compared by value, so `1` and `"1"` are different categories.
 *
 * @category Scales & ticks
 */
export type BandKey = string | number;

/**
 * Options for {@link bandScale}.
 *
 * @category Scales & ticks
 */
export interface BandScaleOptions {
	/**
	 * Fraction of each slot left empty between neighbouring bands, 0..1. The
	 * default leaves a band 0.6 of its slot, Manim's `BarChart` proportion.
	 *
	 * @default 0.4
	 */
	padding?: number;
	/**
	 * Extra room before the first slot and after the last, in slots.
	 *
	 * @default 0
	 */
	paddingOuter?: number;
	/**
	 * Where a band sits inside its slot: 0 flush left, 0.5 centred, 1 flush right.
	 *
	 * @default 0.5
	 */
	align?: number;
	/**
	 * Lay the categories out from the far end: the first category takes the
	 * last slot. A vertical axis wants this, so the list reads top-down.
	 *
	 * @default false
	 */
	reverse?: boolean;
}

/**
 * Categories laid out in slots along a numeric axis. See {@link bandScale}.
 *
 * @category Scales & ticks
 */
export interface BandScale<K extends BandKey = BandKey> {
	/** The categories in axis order, each once. */
	readonly domain: readonly K[];
	/** The numeric range a coordinate system should span: `[-paddingOuter, n + paddingOuter, 1]`. */
	readonly range: Range;
	/** Width of one band in slot units (a slot is 1). */
	readonly bandwidth: number;
	/** A category's slot index (its position along the axis), or -1 when it is not in the domain. */
	index(key: K): number;
	/** Left (lower) edge of a category's band, or undefined when it is not in the domain. */
	start(key: K): number | undefined;
	/** Centre of a category's band, or undefined when it is not in the domain. */
	center(key: K): number | undefined;
}

const clamp01Or = (value: number, fallback: number) =>
	Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

/**
 * Lays `domain` out one slot per category, in order, duplicates dropped (the
 * first occurrence keeps its place).
 *
 * @param domain - The categories, in the order they should appear.
 * @param options - See {@link BandScaleOptions}.
 * @returns A {@link BandScale}.
 *
 * @example
 * ```ts
 * import { bandScale } from "@sophistry/core/geometry";
 *
 * const x = bandScale(["Q1", "Q2", "Q3"]);
 * x.center("Q2"); // 1.5
 * x.bandwidth; // 0.6
 * x.range; // [0, 3, 1]
 * ```
 *
 * @category Scales & ticks
 */
export function bandScale<K extends BandKey>(
	domain: readonly K[],
	options: BandScaleOptions = {},
): BandScale<K> {
	const slots = new Map<K, number>();
	for (const key of domain) if (!slots.has(key)) slots.set(key, slots.size);
	const keys = [...slots.keys()];

	const padding = clamp01Or(options.padding ?? 0.4, 0.4);
	const align = clamp01Or(options.align ?? 0.5, 0.5);
	const outer = Math.max(0, options.paddingOuter ?? 0) || 0;
	const bandwidth = 1 - padding;
	const offset = padding * align;

	const last = Math.max(1, keys.length) - 1;
	const slot = (key: K) => {
		const i = slots.get(key);
		if (i === undefined) return undefined;
		return options.reverse ? last - i : i;
	};
	const index = (key: K) => slot(key) ?? -1;
	const start = (key: K) => {
		const i = slot(key);
		return i === undefined ? undefined : i + offset;
	};

	return {
		domain: keys,
		// `0 - outer`, not `-outer`: with no outer padding that is +0, not -0.
		range: [0 - outer, Math.max(1, keys.length) + outer, 1],
		bandwidth,
		index,
		start,
		center: (key) => {
			const left = start(key);
			return left === undefined ? undefined : left + bandwidth / 2;
		},
	};
}

/**
 * A band scale partway between two others — a categorical axis rescaling as
 * its categories change, as a pure function of the blend.
 *
 * The domain is `from`'s categories, then those only `to` has. The numeric
 * range and the bandwidth blend at `rangeT` (the axis growing or shrinking
 * as categories come and go), and a category both ends have slides from its
 * old band to its new one at `slotT` (a sort, or a gap closing). A category
 * only one end has stays in that end's band: it is entering or leaving, and
 * the marks drawing it fade or shrink there. At `rangeT = slotT = 0` it
 * places everything as `from` does, at 1 as `to` does.
 *
 * @param from - The scale at the start.
 * @param to - The scale at the end.
 * @param rangeT - Blend of the range and bandwidth, 0..1.
 * @param slotT - Blend of the shared categories' positions, 0..1. Defaults to `rangeT`.
 * @returns The blended scale.
 *
 * @example
 * ```ts
 * import { bandScale, interpolateBandScale } from "@sophistry/core/geometry";
 *
 * const sorted = interpolateBandScale(
 *   bandScale(["b", "a", "c"]),
 *   bandScale(["a", "b", "c"]),
 *   0.5,
 * );
 * sorted.center("a"); // 1: halfway from slot 1 to slot 0
 * ```
 *
 * @category Scales & ticks
 */
export function interpolateBandScale<K extends BandKey>(
	from: BandScale<K>,
	to: BandScale<K>,
	rangeT: number,
	slotT: number = rangeT,
): BandScale<K> {
	const r = clamp01(rangeT);
	const s = clamp01(slotT);
	// `mix` is exact at the ends, so a finished transition places bands as `to` does.
	const domain = [...from.domain];
	const known = new Set<K>(domain);
	for (const key of to.domain) if (!known.has(key)) domain.push(key);
	const bandwidth = mix(from.bandwidth, to.bandwidth, r);
	const range: Range = [
		mix(from.range[0], to.range[0], r),
		mix(from.range[1], to.range[1], r),
		1,
	];
	const startOf = (key: K): number | undefined => {
		const a = from.start(key);
		const b = to.start(key);
		if (a === undefined) return b;
		if (b === undefined) return a;
		return mix(a, b, s);
	};
	const indexOf = (key: K): number => {
		const a = from.index(key);
		const b = to.index(key);
		if (a < 0) return b;
		if (b < 0) return a;
		return Math.round(mix(a, b, s));
	};
	return {
		domain,
		range,
		bandwidth,
		index: indexOf,
		start: startOf,
		center: (key) => {
			const left = startOf(key);
			return left === undefined ? undefined : left + bandwidth / 2;
		},
	};
}

/**
 * A band scale whose categories stand where `slot` says instead of in
 * domain order: the categorical half of a sort or rank animation. A slot is
 * an index into the axis in reading order (0 the first band, at the far end
 * when the scale is `reverse`d, as a y axis is) and may be fractional, so a
 * category sliding from slot 2 to slot 0 is drawn between bands on the way.
 * Categories `slot` returns undefined (or a non-finite number) for keep
 * their own place. The range and bandwidth are `band`'s.
 *
 * @param band - The scale to rearrange.
 * @param slot - Each category's slot, in reading order.
 * @param reverse - Whether `band` was built with `reverse` (slot 0 at the far end).
 * @returns The rearranged scale.
 *
 * @category Scales & ticks
 */
export function slotBandScale<K extends BandKey>(
	band: BandScale<K>,
	slot: (key: K) => number | undefined,
	reverse = false,
): BandScale<K> {
	const first = band.domain[0];
	const offset =
		first === undefined ? 0 : (band.start(first) ?? 0) - band.index(first);
	const last = Math.max(1, band.domain.length) - 1;
	const placed = (key: K): number | undefined => {
		const own = slot(key);
		if (own !== undefined && Number.isFinite(own))
			return reverse ? last - own : own;
		const index = band.index(key);
		return index < 0 ? undefined : index;
	};
	const startOf = (key: K) => {
		const at = placed(key);
		return at === undefined ? undefined : at + offset;
	};
	return {
		domain: band.domain,
		range: band.range,
		bandwidth: band.bandwidth,
		index: (key) => {
			const at = placed(key);
			return at === undefined ? -1 : Math.round(at);
		},
		start: startOf,
		center: (key) => {
			const left = startOf(key);
			return left === undefined ? undefined : left + band.bandwidth / 2;
		},
	};
}
