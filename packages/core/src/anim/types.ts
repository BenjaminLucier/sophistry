/**
 * The animation vocabulary.
 *
 * An {@link Animation} is a *seekable description* with a known duration, not
 * a running promise: nothing starts until a runner (`play`, `timeline`) samples
 * it. That is what lets `sequence()` and `lagged()` place their children
 * exactly and lets a script be fast-forwarded or scrubbed. The model itself
 * lives in `animation.ts`; this file holds the options shared by presets and
 * the two leaf builders every preset is made from.
 *
 * Nothing in `anim/` imports `render/` or touches a canvas. These functions
 * only ever read and write tracks over time.
 */

import type { Animatable, Easing } from "../tween";
import { auto } from "../tween";
import type { Animation } from "./animation";
import { easedLeaf } from "./animation";

export type { Animation } from "./animation";

/**
 * Options shared by every animation preset.
 *
 * The clock and abort signal belong to the runner (`play(..., { clock, signal })`
 * or a scene's `play`), not to presets. Some presets change the defaults (`fadeIn`
 * eases `"out"`; emphasis presets pick their own `duration`).
 *
 * @category Extending
 */
export interface AnimOptions {
	/**
	 * Length in seconds of timeline time.
	 * @default 1
	 */
	duration?: number;
	/**
	 * Seconds of leading hold before the first update. Defaults to 0. The
	 * animation's total {@link Animation.duration} is `delay + duration`, so a
	 * delayed child still sequences exactly.
	 */
	delay?: number;
	/**
	 * Easing curve: a name from {@link easings} or a function mapping progress
	 * 0..1 to eased progress. Defaults to `"smooth"` (cubic in-out) unless the
	 * preset picks another. Easing applies inside each leaf, not to a
	 * composite as a whole.
	 */
	easing?: Easing;
}

/**
 * Options for {@link driveTrack}.
 *
 * @category Extending
 */
export interface DriveTrackOptions<T> extends AnimOptions {
	/**
	 * Builds a sampler between two values. Defaults to `auto`, which picks a
	 * registered interpolator by value shape (points, matrices, ...) and falls
	 * back to d3's structural interpolator.
	 */
	interpolate?: (a: T, b: T) => (t: number) => T;
	/**
	 * Explicit start value, or a function from the target's value at entry to
	 * the start value. Defaults to the target's value at entry. When given, the
	 * start is also held for the whole `delay`, so a delayed animation shows
	 * its start state instead of the previous value.
	 */
	from?: T | ((current: T) => T);
}

/**
 * Tweens a target from wherever it is when the animation is entered to `to`;
 * the workhorse behind nearly every preset.
 *
 * The target is anything {@link Animatable}: a `track()`, or a getter/setter
 * pair, object path or property wrapped with {@link lensTarget},
 * {@link storeTarget} or {@link propTarget}. The start value is captured with
 * `target.peek()` the first time the animation is entered (not when it is
 * constructed), so chained animations compose correctly. Use it to animate a track with a custom shape or
 * interpolator when no named preset fits.
 *
 * @param target - The target to drive; written whenever the animation is sampled.
 * @param to - The end value, or a function from the value at entry to the end
 *   value (e.g. `(current) => current + 1`).
 * @param options - Timing options plus `interpolate` and `from`.
 * @returns An {@link Animation} of duration `delay + duration`.
 * @category Extending
 */
export function driveTrack<T>(
	target: Animatable<T>,
	to: T | ((current: T) => T),
	options: DriveTrackOptions<T> = {},
): Animation {
	let sample: (t: number) => T = () => target.peek();
	return easedLeaf(options, {
		holdStart: options.from !== undefined,
		begin() {
			const current = target.peek();
			const start =
				options.from === undefined
					? current
					: typeof options.from === "function"
						? (options.from as (current: T) => T)(current)
						: options.from;
			const end =
				typeof to === "function" ? (to as (current: T) => T)(current) : to;
			sample = (options.interpolate ?? auto)(start, end);
		},
		apply: (eased) => target.set(sample(eased)),
	});
}

/**
 * Options for {@link driveProgress}.
 *
 * @category Extending
 */
export interface DriveProgressOptions extends AnimOptions {
	/**
	 * Called the first time the animation is entered. Capture start values
	 * here with `Track.peek`, for the `onUpdate` closure to use.
	 */
	begin?: () => void;
	/** Called if the run is aborted while this animation is active. */
	abort?: () => void;
}

/**
 * Calls `onUpdate` with eased progress from 0 to 1 over the duration; the
 * escape hatch for animating anything that is not a single track.
 *
 * Several presets (`morph`, `moveAlong`, `indicate`) are built on this. Seeking
 * calls `onUpdate` with the progress for that time, in either direction, so it
 * must be a pure function of its argument plus values captured in `begin`.
 *
 * @param onUpdate - Receives eased progress, normally 0..1 (curves such as
 *   `"backOut"` can overshoot), and the raw uneased progress.
 * @param options - Timing options plus the `begin`/`abort` hooks.
 * @returns An {@link Animation} of duration `delay + duration`.
 * @category Extending
 */
export function driveProgress(
	onUpdate: (t: number, raw: number) => void,
	options: DriveProgressOptions = {},
): Animation {
	return easedLeaf(options, {
		begin: options.begin,
		abort: options.abort,
		apply: onUpdate,
	});
}
