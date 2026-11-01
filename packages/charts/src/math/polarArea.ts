/**
 * Polar area geometry: one wedge per value, the turn split evenly, each
 * wedge's radius linear in its value.
 */

import { clampNonNegative, maxOf } from "@sophistry/core/internal";
import type { PolarSweepOptions } from "./shared/polar.js";
import { resolvePolarSweep, TAU } from "./shared/polar.js";

/** @category Math */
export interface PolarAreaSlice {
	/** Position in the input `values` array. */
	index: number;
	/** The (clamped) value this wedge represents. */
	value: number;
	/** Radians from +x, as `Sector`'s `startAngle`. */
	startAngle: number;
	/** Radians from +x; `endAngle - startAngle` is the signed sweep for `Sector`'s `angle`. */
	endAngle: number;
	/** `value / maxValue`, 0..1: the fraction of the outer radius this wedge reaches. */
	radius: number;
	/** `value / total`: this wedge's share of all values. */
	fraction: number;
}

/** @category Math */
export interface PolarAreaOptions extends PolarSweepOptions {
	/** The value that reaches the outer radius. Defaults to the greatest finite value. */
	maxValue?: number;
}

/**
 * One wedge per value, each `2π / n` wide, its radius the value's share of
 * `maxValue`. A zero still gets a wedge, so parallel `colors`/`labels` stay
 * aligned.
 *
 * @param values - One value per wedge; negative and non-finite entries clamp to 0.
 * @category Math & helpers
 */
export function polarAreaSlices(
	values: readonly number[],
	options: PolarAreaOptions = {},
): PolarAreaSlice[] {
	const n = values.length;
	if (n === 0) return [];

	const clamped = values.map(clampNonNegative);
	const total = clamped.reduce((sum, value) => sum + value, 0);
	const maxValue = options.maxValue ?? maxOf(clamped, 0);

	const { startAngle, direction } = resolvePolarSweep(options);
	const sweep = (direction * TAU) / n;

	return clamped.map((value, index) => {
		const start = startAngle + index * sweep;
		return {
			index,
			value,
			startAngle: start,
			endAngle: start + sweep,
			radius: maxValue > 0 ? value / maxValue : 0,
			fraction: total > 0 ? value / total : 0,
		};
	});
}
