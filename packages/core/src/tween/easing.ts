/**
 * Easing curves — Manim's `rate_func`, backed by d3-ease.
 *
 * Animations accept either a function or one of the names below, so scene code
 * can stay terse: `play(fadeIn(box, { easing: "outBack" }))`. `resolveEasing`
 * is the first of six resolvers in this package built the same way — see
 * `geometry/resolver.ts`'s module doc for the shared shape and the
 * unknown-name policy (a bad name now throws, listing the valid ones,
 * instead of quietly resolving to `undefined`).
 */

import {
	easeBackIn,
	easeBackInOut,
	easeBackOut,
	easeBounceOut,
	easeCircleInOut,
	easeCubicIn,
	easeCubicInOut,
	easeCubicOut,
	easeElasticOut,
	easeExpIn,
	easeExpInOut,
	easeExpOut,
	easeLinear,
	easeQuadInOut,
	easeSinIn,
	easeSinInOut,
	easeSinOut,
} from "d3-ease";
import { progressIn } from "../geometry/lerp.js";
import { createResolver } from "../geometry/resolver.js";

/**
 * Maps linear progress `t` in 0..1 to eased progress (0 at 0, 1 at 1 for most curves).
 *
 * @category Easing
 */
export type EasingFunction = (t: number) => number;

/**
 * Manim's `there_and_back`: runs a curve forward then backwards, so progress
 * rises 0 to 1 over the first half and falls back to 0.
 *
 * Useful for emphasis where the value must end where it started.
 *
 * @param curve - Easing used for each half. Defaults to sine in-out.
 * @returns An {@link EasingFunction}.
 *
 * @category Easing
 */
export function thereAndBack(
	curve: EasingFunction = easeSinInOut,
): EasingFunction {
	return (t) => curve(1 - Math.abs(2 * t - 1));
}

/**
 * Like {@link thereAndBack}, but holds at 1 for `hold` of the duration before
 * returning.
 *
 * @param hold - Fraction of the duration (0..1) spent holding. Defaults to 0.3.
 * @returns An {@link EasingFunction}.
 *
 * @category Easing
 */
export function thereAndBackWithPause(hold = 0.3): EasingFunction {
	const h = Number.isFinite(hold) ? Math.min(1, Math.max(0, hold)) : 0.3;
	return (t) => {
		const ramp = (1 - h) / 2;
		// Full hold: no ramps (avoids 0/0); jump to 1 and back to 0 at the ends.
		if (ramp === 0) return t <= 0 || t >= 1 ? 0 : 1;
		if (t < ramp) return easeSinInOut(t / ramp);
		if (t < ramp + h) return 1;
		return easeSinInOut(1 - (t - ramp - h) / ramp);
	};
}

/**
 * Manim's `squish_rate_func`: runs `curve` over the window `[start, end]` of
 * an animation and holds it before and after, so one leaf of a longer
 * animation can move only during its own slice. `curve(0)` before the
 * window, `curve(1)` after it. A window with no width is a step at `start`
 * (Manim answers `start` itself there, which is not a progress).
 *
 * The same windowing, as plain arithmetic on a number rather than an easing,
 * is `progressIn` (`@sophistry/core/geometry`).
 *
 * @param curve - The easing to squish. Defaults to `"smooth"`.
 * @param start - Where the curve starts, 0..1. Defaults to 0.4, as Manim's.
 * @param end - Where it ends, 0..1. Defaults to 0.6, as Manim's.
 * @returns An {@link EasingFunction}.
 *
 * @category Easing
 */
export function squish(
	curve: Easing = easeCubicInOut,
	start = 0.4,
	end = 0.6,
): EasingFunction {
	const f = resolveEasing(curve);
	return (t) => f(progressIn(t, start, end));
}

/**
 * Manim's `running_start`: backs up first, by `pull` of the distance, then
 * runs forward to the end, as if winding up. A degree-6 Bézier through the
 * control values `[0, 0, pull, pull, 1, 1, 1]`, exactly Manim's.
 *
 * @param pull - How far back it pulls; negative pulls back. Defaults to -0.5.
 * @returns An {@link EasingFunction}, 0 at 0 and 1 at 1.
 *
 * @category Easing
 */
export function runningStart(pull = -0.5): EasingFunction {
	const controls = [0, 0, pull, pull, 1, 1, 1];
	const binomial = [1, 6, 15, 20, 15, 6, 1];
	return (t) => {
		const u = 1 - t;
		let sum = 0;
		for (let i = 0; i < controls.length; i++)
			sum += binomial[i] * t ** i * u ** (6 - i) * controls[i];
		return sum;
	};
}

/**
 * Manim's `not_quite_there`: `curve` scaled to stop at `proportion` of the
 * way, for a move that falls short on purpose (the second half of a "nearly
 * there" gag, or a drift that a later animation finishes).
 *
 * @param curve - The easing to scale. Defaults to `"smooth"`.
 * @param proportion - Where it ends, as a share of the full distance. Defaults to 0.7.
 * @returns An {@link EasingFunction} ending at `proportion`, not 1.
 *
 * @category Easing
 */
export function notQuiteThere(
	curve: Easing = easeCubicInOut,
	proportion = 0.7,
): EasingFunction {
	const f = resolveEasing(curve);
	return (t) => proportion * f(t);
}

/**
 * Manim's `exponential_decay`: leaves fast and settles, like a value
 * relaxing toward a target. `1 − e^(−t/τ)`, rescaled so it lands on exactly 1
 * at the end; Manim's stops a hair short (0.99995 at its default), which
 * would leave a seekable animation's end value not quite at its target.
 *
 * @param timeConstant - τ, as a share of the duration: the time to cover
 *   1 − 1/e (about 63%) of the way. Smaller settles sooner. Manim calls this
 *   `half_life`, though it is the time constant. Defaults to 0.1.
 * @returns An {@link EasingFunction}, 0 at 0 and 1 at 1.
 *
 * @category Easing
 */
export function exponentialDecay(timeConstant = 0.1): EasingFunction {
	const tau = timeConstant > 0 ? timeConstant : 0.1;
	const end = 1 - Math.exp(-1 / tau);
	return (t) => (1 - Math.exp(-t / tau)) / end;
}

/** Manim's `slow_into`: a quarter circle, fast out of the start and easing into the end. */
const slowInto: EasingFunction = (t) => Math.sqrt(1 - (1 - t) * (1 - t));

/** Manim's `double_smooth`: two `smooth` halves, pausing briefly at the midpoint. */
const doubleSmooth: EasingFunction = (t) =>
	t < 0.5 ? 0.5 * easeCubicInOut(2 * t) : 0.5 * (1 + easeCubicInOut(2 * t - 1));

/** Manim's `lingering`: linear over the first 80%, then holds at the end. */
const lingering: EasingFunction = (t) => progressIn(t, 0, 0.8);

/**
 * The named easing curves, usable anywhere an {@link Easing} is accepted.
 *
 * Includes `linear`, `in`/`out`/`inOut` (cubic), `smooth` (cubic in-out, the
 * default for most animations), quad/sine/exp/circ variants, `back*`,
 * `elasticOut`, `bounceOut`, `thereAndBack`, and Manim's `rushInto`/`rushFrom`,
 * `slowInto`, `doubleSmooth`, `lingering`, `runningStart` and
 * `exponentialDecay` (the last two at their default settings; call
 * {@link runningStart} or {@link exponentialDecay} to tune them).
 * @category Easing
 */
export const easings = Object.freeze({
	linear: easeLinear,
	in: easeCubicIn,
	out: easeCubicOut,
	inOut: easeCubicInOut,
	smooth: easeCubicInOut,
	quadInOut: easeQuadInOut,
	sinIn: easeSinIn,
	sinOut: easeSinOut,
	sinInOut: easeSinInOut,
	expIn: easeExpIn,
	expOut: easeExpOut,
	expInOut: easeExpInOut,
	circInOut: easeCircleInOut,
	backIn: easeBackIn,
	backOut: easeBackOut,
	backInOut: easeBackInOut,
	elasticOut: easeElasticOut,
	bounceOut: easeBounceOut,
	thereAndBack: thereAndBack(),
	// With a cubic `smooth`, Manim's 2*smooth(t/2) is exactly t^3 and
	// 2*smooth((t+1)/2)-1 is exactly 1-(1-t)^3, so these aliases are exact.
	rushInto: easeCubicIn,
	rushFrom: easeCubicOut,
	slowInto,
	doubleSmooth,
	lingering,
	runningStart: runningStart(),
	exponentialDecay: exponentialDecay(),
} satisfies Record<string, EasingFunction>);

/**
 * Name of a built-in curve in {@link easings}.
 *
 * @category Easing
 */
export type EasingName = keyof typeof easings;
/**
 * An easing given as a function or as a curve name.
 *
 * @category Easing
 */
export type Easing = EasingFunction | EasingName;

const easingResolver = createResolver<EasingFunction>("easing", easings);

/**
 * A name is sugar for a function. `easing` falsy (`undefined`, or the empty
 * string, which is never a valid name anyway) returns `fallback` rather than
 * resolving — the one piece of this that stays bespoke per call site, since
 * "no easing given" and "an unrecognised easing name" are different problems
 * only the second one should throw.
 *
 * @param easing - A curve name or function; falsy means "use the fallback".
 * @param fallback - Curve used when `easing` is falsy. Defaults to `easings.smooth`.
 * @returns The easing function.
 * @throws If `easing` is a string that is not a built-in name.
 *
 * @category Easing
 */
export function resolveEasing(
	easing: Easing | undefined,
	fallback: EasingFunction = easings.smooth,
): EasingFunction {
	if (!easing) return fallback;
	return easingResolver.resolve(easing);
}
