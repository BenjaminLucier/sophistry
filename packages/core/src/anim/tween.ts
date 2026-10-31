/**
 * `tween()` and `wait()`: the standalone, promise-returning escape hatch for
 * animating something that is not a track from an async script. It is one leaf
 * run through `play`, so it behaves the same, but does not compose; build an
 * `Animation` with `driveTrack`/`driveProgress` to compose or scrub.
 */

import type { Clock } from "../tween/clock";
import type { Easing } from "../tween/easing";
import { auto } from "../tween/interpolators";
import { easedLeaf } from "./animation";
import { hold } from "./sequence";
import type { PlayResult } from "./timeline";
import { play } from "./timeline";

/**
 * Options for {@link tween}.
 *
 * @typeParam T - The type of the value being animated.
 *
 * @category Tracks & clocks
 */
export interface TweenOptions<T> {
	/** Start value. */
	from: T;
	/** End value. */
	to: T;
	/**
	 * Length in seconds of clock time; 0 lands immediately.
	 * @default 1
	 */
	duration?: number;
	/**
	 * Seconds of clock time to wait before the first update.
	 * @default 0
	 */
	delay?: number;
	/**
	 * Easing curve name or function. The default is cubic in-out.
	 * @default `"smooth"`
	 */
	easing?: Easing;
	/**
	 * Builds a sampler between two values. Defaults to `auto`, which picks a
	 * registered interpolator by value shape (points, matrices, ...) and falls
	 * back to d3's structural interpolator.
	 */
	interpolate?: (a: T, b: T) => (t: number) => T;
	/**
	 * Called once per clock step with the interpolated value and the raw
	 * (uneased) progress, 0..1.
	 */
	onUpdate: (value: T, progress: number) => void;
	/** Clock driving time. Defaults to `defaultClock`. */
	clock?: Clock;
	/**
	 * Aborting stops the tween where it stands and resolves the promise with
	 * `"aborted"` (it never rejects), so an interrupted script unwinds
	 * instead of throwing.
	 */
	signal?: AbortSignal;
}

/**
 * Runs a tween to completion. Resolves `"done"` when it finishes or
 * `"aborted"` if the signal fires first; never rejects.
 *
 * Time comes from the clock, so a paused clock pauses the tween mid-flight and
 * a clock at 0.25 speed plays it in slow motion — no rescheduling required.
 *
 * `onUpdate` is called exactly once per clock step once the delay has passed,
 * with that step's progress. Nothing is called during the delay — the value
 * simply stays where it was — and a zero-length tween reports only its final
 * value, never `from` first.
 *
 * Prefer the presets in `anim/` (`moveTo`, `fadeIn`, ...) for animating
 * tracks; reach for `tween` directly to animate something that is not a track
 * or to build a new preset.
 *
 * @param options - See {@link TweenOptions}.
 * @returns A promise of how the run ended (`"done"` or `"aborted"`).
 * @category Tracks & clocks
 */
export function tween<T>(options: TweenOptions<T>): Promise<PlayResult> {
	const sample = (options.interpolate ?? auto)(options.from, options.to);
	// The run samples its start state when it begins; for a standalone tween
	// that is a redundant progress-0 report of `from`, which was never part of
	// the contract, so the first one is swallowed.
	let reported = false;
	return play(
		easedLeaf(options, {
			apply: (eased, raw) => {
				if (!reported && raw === 0 && !options.delay) {
					reported = true;
					return;
				}
				reported = true;
				options.onUpdate(sample(eased), raw);
			},
		}),
		{ clock: options.clock, signal: options.signal },
	);
}

/**
 * Resolves after `seconds` of clock time. Pauses when the clock pauses.
 *
 * @param seconds - Delay in seconds.
 * @param options - `clock` to wait on (default `defaultClock`) and an
 *   optional `signal`; aborting resolves early.
 * @returns A promise that resolves `"done"` when the time has elapsed, or
 *   `"aborted"`.
 *
 * @category Tracks & clocks
 */
export function wait(
	seconds: number,
	options: { clock?: Clock; signal?: AbortSignal } = {},
): Promise<PlayResult> {
	// Waiting is not motion: a paced script keeps its rhythm under reduced motion.
	return play(hold(seconds), { ...options, motion: "essential" });
}
