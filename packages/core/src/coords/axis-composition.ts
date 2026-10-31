/**
 * How an x and a y `numberLine` compose, shared by `axes` and `chart`: which
 * ticks each draws during a range transition (`weightedTicks`, `axisTicksAt`),
 * and the shared origin, where y drops its "0" when x writes one, and
 * neither writes it where the other axis's line runs through it
 * (`originWeight`, `resolveOrigin`, `originFade`, `yieldOrigin`). Internal; `charts` builds on
 * it, never the reverse.
 */

import type {
	Range,
	RangeTransition,
	ScaleSpec,
	ScaleTicks,
	TimeZone,
	WeightedTick,
} from "../geometry";
import {
	axisTicks,
	isRangeTransition,
	resolveScale,
	transitionTicks,
} from "../geometry";
import { clamp01 } from "../geometry/num";
import type { AxisOptions } from "./axes";

/** The y axis's default exclusion, one array for good, so it never reads as a changed prop. */
export const ORIGIN_ONLY: number[] = [0];

/** Whether `value` lies within `range`, whichever way round its ends are. */
export function contains(range: Range, value: number): boolean {
	return (
		value >= Math.min(range[0], range[1]) &&
		value <= Math.max(range[0], range[1])
	);
}

/**
 * What decides where an axis's ticks fall: its scale (and the scale's base and
 * time zone) and an explicit major step.
 */
export interface AxisTickSource {
	scale?: ScaleSpec;
	base?: number;
	timeZone?: TimeZone;
	step?: number;
}

/**
 * The ticks an axis over `range` draws — `axisTicks` through the axis's own
 * resolved scale, exactly as `numberLine` asks for them, so a grid or an
 * origin rule built on this agrees with the axis on every scale type (a log
 * axis's decades, a time axis's calendar intervals).
 *
 * @param source - The axis's scale and step.
 * @param range - `[min, max, step?]`.
 * @param minorTickCount - Subdivisions between majors. Defaults to 0 (none).
 */
export function axisTicksAt(
	source: AxisTickSource,
	range: Range,
	minorTickCount = 0,
): ScaleTicks {
	return axisTicks(
		resolveScale(source.scale, range, source.base, source.timeZone),
		range,
		{ step: source.step, minorTickCount },
	);
}

/**
 * Ticks with their fades: every tick at weight 1 on a plain range; while a
 * range transition runs, both ends' ticks cross-faded by value
 * (`transitionTicks`) and clipped to `shown` — the axis's own rule.
 *
 * @param ticksAt - The tick values at a range.
 * @param given - The range as given: plain, a transition, or nothing (`shown` is used).
 * @param shown - The range shown now.
 */
export function weightedTicks(
	ticksAt: (range: Range) => readonly number[],
	given: Range | RangeTransition | undefined,
	shown: Range,
): WeightedTick[] {
	if (isRangeTransition(given)) {
		return transitionTicks(
			ticksAt(given.from),
			ticksAt(given.to),
			given.t,
			shown,
		);
	}
	return ticksAt(shown).map((value) => ({ value, weight: 1 }));
}

/** The options that decide whether an x axis writes a "0". */
export type OriginNumberOptions = Pick<
	AxisOptions,
	"numbers" | "numbersToInclude" | "numbersToExclude"
>;

/** Whether an axis with these options writes a "0" (when 0 is one of its ticks). */
export function writesOrigin(options: OriginNumberOptions): boolean {
	return !(
		options.numbers === false ||
		(options.numbersToInclude !== undefined &&
			!options.numbersToInclude.includes(0)) ||
		options.numbersToExclude?.includes(0)
	);
}

/**
 * How strongly the x axis writes a "0" where the y axis's "0" would be,
 * 0..1: 0 unless x writes its "0" and `crosses()` (both lines through the
 * origin, both ranges spanning it); then 1 on a plain range, or x's 0 tick's
 * weight while a transition carries 0 onto or off the axis.
 *
 * @param options - The x axis's number options.
 * @param crosses - Whether both axes stand at, and span, the origin. Called only when `options` allow a "0".
 * @param given - The x range as given.
 * @param majors - x's majors, cross-faded, for a transition.
 */
export function originWeight(
	options: OriginNumberOptions,
	crosses: () => boolean,
	given: Range | RangeTransition | undefined,
	majors: (given: RangeTransition) => readonly WeightedTick[],
): number {
	if (!writesOrigin(options) || !crosses()) return 0;
	if (!isRangeTransition(given)) return 1;
	return majors(given).find((tick) => tick.value === 0)?.weight ?? 0;
}

/** A direction, as an axis's `numberDirection` gives one. */
interface Direction {
	x: number;
	y: number;
}

/**
 * How far the other axis runs on past the origin, as a share of its span, before an axis's "0"
 * beside the origin counts as wholly sitting on that line: over this stretch it fades rather
 * than popping as a range transition carries the line across.
 */
const ORIGIN_BLOCK_SHARE = 0.05;

/**
 * How much each axis's "0", written beside the origin on its own side, would sit on the other
 * axis's line, 0..1: x's (below the origin by default) as the y axis runs on below 0, y's (left
 * of it by default) as the x axis runs on left of 0. Only meaningful while the axes cross at the
 * origin.
 *
 * @param xRange - The x axis's range now.
 * @param yRange - The y axis's range now.
 * @param xDirection - Where x writes its numbers. Defaults to down.
 * @param yDirection - Where y writes its numbers. Defaults to left.
 */
export function originBlocks(
	xRange: Range,
	yRange: Range,
	xDirection: Direction | undefined,
	yDirection: Direction | undefined,
): { x: number; y: number } {
	const runsOn = (range: Range, toward: number) => {
		const low = Math.min(range[0], range[1]);
		const high = Math.max(range[0], range[1]);
		const past = toward < 0 ? -low : toward > 0 ? high : 0;
		const span = high - low;
		return span > 0 ? clamp01(past / (span * ORIGIN_BLOCK_SHARE)) : 0;
	};
	return {
		x: runsOn(yRange, xDirection?.y ?? -1),
		y: runsOn(xRange, yDirection?.x ?? -1),
	};
}

/**
 * Who writes the origin's "0" where the axes cross (Manim's rule, refined): x, beside its own
 * line, unless the y axis's line runs through that spot; then y, unless the x axis's line runs
 * through its spot too; then neither. Fractional blocks fade the hand-over.
 *
 * @param crossing - Whether both axes stand at, and span, the origin.
 * @param weight - x's {@link originWeight}.
 * @param blocks - {@link originBlocks}.
 * @returns How much each axis yields its own "0", for {@link originFade} and {@link yieldOrigin}.
 */
export function resolveOrigin(
	crossing: boolean,
	weight: number,
	blocks: { x: number; y: number },
): { xYield: number; yYield: number } {
	if (!crossing) return { xYield: 0, yYield: weight };
	/** How much of x's "0" shows, and so how much y's makes way for it. */
	const xShows = weight * (1 - blocks.x);
	return {
		xYield: blocks.x,
		yYield: 1 - (1 - blocks.y) * (1 - xShows),
	};
}

/** What the y axis reads off {@link originWeight}. */
export interface OriginFade {
	/** Whether x owns the origin's "0" outright. */
	shared: boolean;
	/** y's "0" opacity while x's fades: the rest of the way; 1 otherwise. */
	zeroOpacity: number;
}

/** Splits an origin weight into the two values the y axis's options read. */
export function originFade(weight: number): OriginFade {
	return {
		shared: weight >= 1,
		zeroOpacity: weight > 0 && weight < 1 ? 1 - weight : 1,
	};
}

/**
 * An axis's options with the origin rule applied: unless the caller chose
 * its numbers itself, it drops its "0" while it yields it wholly (to the
 * other axis's "0", or to the other axis's line) and fades it while it
 * yields it in part.
 *
 * `numberOpacity` is replaced only when the fade does something (a "0"
 * fading, or the caller's own), so a plain axis keeps the same options from
 * one update to the next.
 */
export function yieldOrigin<T extends AxisOptions>(
	merged: T,
	fade: OriginFade,
): T {
	const owned =
		merged.numbersToInclude === undefined &&
		merged.numbersToExclude === undefined;
	const own = merged.numberOpacity;
	const zeroOpacity = fade.zeroOpacity;
	return {
		...merged,
		numbersToExclude:
			merged.numbersToExclude ??
			(owned && fade.shared ? ORIGIN_ONLY : undefined),
		numberOpacity:
			owned && (zeroOpacity !== 1 || own)
				? (value: number) =>
						(value === 0 ? zeroOpacity : 1) * (own?.(value) ?? 1)
				: own,
	};
}
