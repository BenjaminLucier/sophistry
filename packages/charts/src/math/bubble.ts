/**
 * Bubble sizing: values to marker radii with area, not radius, proportional
 * to value (a viewer reads area).
 */

import { tickValues } from "@sophistry/core/geometry";
import { clampNonNegative, maxOf } from "@sophistry/core/internal";

/**
 * One radius per input value, parallel to `values`.
 *
 * @category Math & helpers
 */
export type BubbleRadii = number[];

/** @category Math */
export interface BubbleRadiusOptions {
	/** Radius for a value of 0. @default 0 */
	minRadius?: number;
	/** Radius for `maxValue`. @default 1 */
	maxRadius?: number;
	/** The value that maps to `maxRadius`. Defaults to the greatest finite value in `values`. */
	maxValue?: number;
}

const DEFAULT_MIN_RADIUS = 0;
const DEFAULT_MAX_RADIUS = 1;

/**
 * Values to marker radii with area proportional to value:
 * `minRadius + (maxRadius - minRadius) * sqrt(value / maxValue)`. When every
 * value is 0, every radius is `minRadius`.
 *
 * @param values - One per marker; non-finite or negative entries clamp to 0.
 * @returns One radius per value, in `minRadius`/`maxRadius`'s units.
 * @category Math & helpers
 */
export function bubbleRadiusScale(
	values: readonly number[],
	options: BubbleRadiusOptions = {},
): BubbleRadii {
	const clamped = values.map(clampNonNegative);
	const minRadius = options.minRadius ?? DEFAULT_MIN_RADIUS;
	const maxRadius = options.maxRadius ?? DEFAULT_MAX_RADIUS;
	const maxValue = options.maxValue ?? maxOf(clamped, 0);

	if (!(maxValue > 0)) return clamped.map(() => minRadius);

	return clamped.map(
		(value) =>
			minRadius + (maxRadius - minRadius) * Math.sqrt(value / maxValue),
	);
}

/**
 * Reference values for a size key over `[0, maxValue]`: at most `count`
 * round numbers above zero, the largest kept.
 *
 * @param count - Defaults to 3.
 * @returns Ascending values in `(0, maxValue]`; empty when `maxValue` is not positive.
 * @category Math & helpers
 */
export function bubbleLegendValues(maxValue: number, count = 3): number[] {
	if (!(maxValue > 0) || !Number.isFinite(maxValue)) return [];
	const most = Math.max(1, Math.floor(count));
	const enough = Math.min(2, most);
	// The coarsest round step that leaves at least two values (one, when
	// one is asked for): [0, 16] asked for 3 steps by 10 and leaves only 10,
	// so it steps by 5.
	for (let ask = most; ask <= most * 4; ask++) {
		const ticks = tickValues([0, maxValue], { count: ask }).filter(
			(value) => value > 0,
		);
		if (ticks.length >= enough) return ticks.slice(-most);
	}
	return [maxValue];
}
