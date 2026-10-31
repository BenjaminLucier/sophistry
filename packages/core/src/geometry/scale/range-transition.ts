/**
 * Animated axis ranges: a `RangeTransition` between two ranges, its
 * interpolation and current value, and the weighted (fading) ticks drawn
 * while it runs.
 */

import { type Range, resolveScale, type ScaleSpec } from "./scales";

/**
 * A range on its way from one value to another: what an axis shows at blend
 * `t` (0 = `from`, 1 = `to`). Passing one where a `Range` would go animates
 * the domain from a single track, seekably — see {@link interpolateRange}
 * for the domain and {@link transitionTicks} for the ticks.
 *
 * @category Scales & ticks
 */
export interface RangeTransition {
	/** The range at `t = 0`. */
	from: Range;
	/** The range at `t = 1`. */
	to: Range;
	/** Blend, 0..1 (clamped). Drive it with a track; ease it with the track's animation. */
	t: number;
}

/**
 * Whether `range` is a {@link RangeTransition} rather than a plain `Range`.
 *
 * @category Scales & ticks
 */
export function isRangeTransition(
	range: Range | RangeTransition | undefined,
): range is RangeTransition {
	return range !== undefined && !Array.isArray(range);
}

/**
 * The range a domain passes through at blend `t` between `from` and `to`.
 *
 * Blended in the scale's own space, so a log axis zooms at a steady rate per
 * decade; falls back to a lerp of the ends where the scale cannot place them.
 * The result keeps a step only when both ranges name the same one.
 *
 * @param from - The range at `t = 0`.
 * @param to - The range at `t = 1`.
 * @param t - Blend, clamped to 0..1.
 * @param scale - The axis's scale. Defaults to linear.
 * @param base - Log base, for `"log"`.
 * @returns `from` at 0, `to` at 1, the blended range between.
 *
 * @example
 * ```ts
 * import { interpolateRange } from "@sophistry/core/geometry";
 *
 * interpolateRange([0, 10], [0, 100], 0.5); // [0, 55]
 * interpolateRange([1, 10], [1, 1000], 0.5, "log"); // [1, 100]
 * ```
 *
 * @category Scales & ticks
 */
export function interpolateRange(
	from: Range,
	to: Range,
	t: number,
	scale?: ScaleSpec,
	base?: number,
): Range {
	const blend = t > 0 ? (t < 1 ? t : 1) : 0;
	if (blend === 0) return from;
	if (blend === 1) return to;
	const step = from[2] !== undefined && from[2] === to[2] ? from[2] : undefined;
	const lerp = (a: number, b: number) => a + (b - a) * blend;
	let min = lerp(from[0], to[0]);
	let max = lerp(from[1], to[1]);
	const axis = resolveScale(scale, from, base);
	const start = axis.toUnit(to[0]);
	const end = axis.toUnit(to[1]);
	if (Number.isFinite(start) && Number.isFinite(end)) {
		const a = axis.fromUnit(start * blend);
		const b = axis.fromUnit(1 + (end - 1) * blend);
		if (Number.isFinite(a) && Number.isFinite(b)) {
			min = a;
			max = b;
		}
	}
	return step === undefined ? [min, max] : [min, max, step];
}

/**
 * The range shown for `range` — itself, or a transition's blended range.
 *
 * @param range - A range or a transition.
 * @param scale - The axis's scale, for {@link interpolateRange}.
 * @param base - Log base.
 *
 * @category Scales & ticks
 */
export function currentRange(
	range: Range | RangeTransition,
	scale?: ScaleSpec,
	base?: number,
): Range {
	return isRangeTransition(range)
		? interpolateRange(range.from, range.to, range.t, scale, base)
		: range;
}

/**
 * One tick of an animated axis, with how strongly it shows.
 *
 * @category Scales & ticks
 */
export interface WeightedTick {
	/** Data value. */
	value: number;
	/** Opacity multiplier, 0..1. */
	weight: number;
}

/**
 * The ticks to draw partway through a domain transition, each with a weight
 * to fade it by — Heer & Robertson's axis rescale, as a pure function of `t`.
 *
 * Ticks match by value: shared ticks stay at full weight, old-only ticks fade
 * out (`1 - t`), new-only ones fade in (`t`). Ticks outside `current` or at
 * weight 0 are dropped, so both ends are the plain axes, and it scrubs.
 *
 * @param from - Tick values of the axis at `t = 0`.
 * @param to - Tick values of the axis at `t = 1`.
 * @param t - Blend, clamped to 0..1.
 * @param current - The range being shown now (`interpolateRange`), to drop ticks outside it.
 * @returns The ticks to draw, ascending, each with its weight.
 *
 * @example
 * ```ts
 * import { transitionTicks } from "@sophistry/core/geometry";
 *
 * // 0 and 10 are on both axes; 5 fades out, 20 is not in view yet.
 * transitionTicks([0, 5, 10], [0, 10, 20], 0.25, [0, 12.5]);
 * // [{ value: 0, weight: 1 }, { value: 5, weight: 0.75 }, { value: 10, weight: 1 }]
 * ```
 *
 * @category Scales & ticks
 */
export function transitionTicks(
	from: readonly number[],
	to: readonly number[],
	t: number,
	current: Range,
): WeightedTick[] {
	const blend = t > 0 ? (t < 1 ? t : 1) : 0;
	const min = Math.min(current[0], current[1]);
	const max = Math.max(current[0], current[1]);
	const span = max - min;
	const slack = (Number.isFinite(span) && span > 0 ? span : 1) * 1e-9;
	const inView = (value: number) =>
		value >= min - slack && value <= max + slack;
	const a = [...from].sort((x, y) => x - y);
	const b = [...to].sort((x, y) => x - y);
	const out: WeightedTick[] = [];
	const push = (value: number, weight: number) => {
		if (weight > 0 && inView(value)) out.push({ value, weight });
	};
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (j >= b.length || (i < a.length && a[i] < b[j] - slack)) {
			push(a[i++], 1 - blend);
		} else if (i >= a.length || b[j] < a[i] - slack) {
			push(b[j++], blend);
		} else {
			push(b[j], 1);
			i++;
			j++;
		}
	}
	return out;
}

/**
 * Transition ticks (see {@link transitionTicks}) with the fading ones faded further by the
 * room they have on this frame: mid-rescale, the end being squeezed packs its ticks or grid
 * lines into a sliver of the axis. A tick partway in or out (weight under 1) fades as it
 * closes on a neighbour, wholly gone once they are `minGap` apart; ticks on both ends are kept.
 *
 * @param ticks - Ascending, as {@link transitionTicks} returns them.
 * @param place - A value's position along the axis, in scene units.
 * @param minGap - The spacing, in scene units, at which a fading tick is gone; it is whole at twice that.
 * @returns The ticks, re-weighted, without those faded to nothing.
 *
 * @category Scales & ticks
 */
export function spacedTicks(
	ticks: readonly WeightedTick[],
	place: (value: number) => number,
	minGap: number,
): WeightedTick[] {
	if (!(minGap > 0) || ticks.every((tick) => tick.weight >= 1))
		return ticks as WeightedTick[];
	const at = ticks.map((tick) => place(tick.value));
	const out: WeightedTick[] = [];
	ticks.forEach((tick, i) => {
		if (tick.weight >= 1) {
			out.push(tick);
			return;
		}
		const before =
			i > 0 ? Math.abs(at[i] - at[i - 1]) : Number.POSITIVE_INFINITY;
		const after =
			i < at.length - 1
				? Math.abs(at[i + 1] - at[i])
				: Number.POSITIVE_INFINITY;
		const fit = Math.min(1, Math.max(0, Math.min(before, after) / minGap - 1));
		if (fit >= 1) out.push(tick);
		else if (fit > 0)
			out.push({ value: tick.value, weight: tick.weight * fit });
	});
	return out;
}
