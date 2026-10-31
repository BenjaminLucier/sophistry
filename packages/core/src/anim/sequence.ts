/**
 * Composition. Manim needs `AnimationGroup`, `Succession`, and `LaggedStart`
 * classes for this; with seekable animations of known length it is three small
 * functions that differ only in where each child is placed on the timeline.
 *
 * Because every child's length is known, the offsets are computed up front and
 * exactly: a {@link sequence} is the sum of its children, a {@link lagged}
 * child `i` starts at `i * lag`, and none of it accumulates frame-rounding
 * drift. See {@link Animation} for how seeking a composite treats its children.
 */

import type { Animation, CycleStart } from "./animation";
import { animation, compose, cycles } from "./animation";

/**
 * `AnimationGroup`: runs every animation at once; lasts as long as the
 * longest.
 *
 * Use it to bundle parallel animations into one value that can itself be put
 * inside a {@link sequence}. (`play(a, b)` is the same thing at top level.) If
 * two children drive the same track, the later one in the list wins each frame.
 *
 * @param animations - Animations to run together.
 * @returns An {@link Animation} of duration `max(children)`.
 *
 * @category Animation composition & timelines
 */
export function parallel(...animations: Animation[]): Animation {
	return compose(animations.map((child) => ({ animation: child, start: 0 })));
}

/**
 * `Succession`: runs the animations one after another.
 *
 * Child `i` starts exactly when child `i - 1` ends, so the total is the plain
 * sum of the durations and the leftover fraction of a finishing frame carries
 * into the next step. Each relative animation (`moveBy`, `rotateBy`, ...)
 * captures its start when entered, i.e. the value the previous step left. Use
 * it to put a sequence inside a {@link parallel}, {@link lagged} or
 * {@link repeat}.
 *
 * @param animations - Animations to run in order.
 * @returns An {@link Animation} of duration `sum(children)`.
 * @category Animation composition & timelines
 */
export function sequence(...animations: Animation[]): Animation {
	let start = 0;
	return compose(
		animations.map((child) => {
			const placed = { animation: child, start };
			start += child.duration;
			return placed;
		}),
	);
}

/**
 * Options for {@link lagged}.
 *
 * @category Animation composition & timelines
 */
export interface LaggedOptions {
	/**
	 * Seconds between consecutive starts (child `i` starts at `i * lag`).
	 * Defaults to 0.15. Ignored when `lagRatio` is given: `lagRatio` wins, the
	 * two are never combined.
	 */
	lag?: number;
	/**
	 * Manim's `lag_ratio`: each child starts when the previous one is this
	 * fraction through (`0` is a plain {@link parallel}, `1` is a
	 * {@link sequence}). Takes precedence over `lag`.
	 */
	lagRatio?: number;
}

/**
 * `LaggedStart`: runs animations in parallel, each starting a fixed lag after
 * the previous one.
 *
 * Offsets are timeline time, so they pause and scale with the clock. The
 * duration is `max(offset_i + duration_i)`.
 *
 * @param animations - Animations to stagger.
 * @param options - See {@link LaggedOptions}.
 * @returns An {@link Animation}.
 * @category Animation composition & timelines
 */
export function lagged(
	animations: Animation[],
	options: LaggedOptions = {},
): Animation {
	const ratio =
		options.lagRatio === undefined
			? undefined
			: Number.isNaN(options.lagRatio)
				? 0
				: Math.max(0, options.lagRatio);
	const lag =
		options.lag === undefined || Number.isNaN(options.lag)
			? 0.15
			: Math.max(0, options.lag);
	let start = 0;
	return compose(
		animations.map((child) => {
			const placed = { animation: child, start };
			// `0 * Infinity` is NaN: a zero ratio never delays, whatever the child's length.
			start +=
				ratio === undefined ? lag : ratio === 0 ? 0 : ratio * child.duration;
			return placed;
		}),
	);
}

/**
 * A hold of `seconds` of timeline time; a spacer in a {@link sequence}.
 *
 * It only occupies time inside a composite and never touches playback state;
 * stopping and resuming time is `Clock.pause()` / `Timeline.pause()`. Obeys
 * clock pause and speed like any other animation. Manim's `Wait`; use
 * `await wait(seconds)` for the awaitable form.
 *
 * @param seconds - Length of the hold in seconds.
 * @returns An {@link Animation} that writes nothing.
 *
 * @category Animation composition & timelines
 */
export function hold(seconds: number): Animation {
	return animation({ duration: seconds, seek: () => {} });
}

/**
 * Options for {@link repeat} and {@link forever}.
 *
 * @category Animation composition & timelines
 */
export interface RepeatOptions {
	/**
	 * Where each cycle takes its start values from.
	 *
	 * - `"continue"` (default): each cycle re-enters the animation and captures
	 *   afresh from wherever the previous cycle left the tracks. A loop of
	 *   `sequence(valueTo(a, 2), valueTo(a, 0))` is seamless and a repeated
	 *   relative `moveBy` accumulates. Scrubbing *backwards* across a cycle
	 *   boundary is approximate for accumulating animations.
	 * - `"fixed"`: capture once, when the repeat is first entered, and restart
	 *   every cycle from that state. A relative `moveBy` repeats the same move
	 *   each cycle, and the timeline can be scrubbed to any time, in either
	 *   direction, with exact results (as in GSAP). Choose it when the cycles
	 *   should be identical.
	 */
	start?: CycleStart;
}

/**
 * Runs an animation `times` times in a row. By default each cycle starts from
 * where the last left the tracks (relative moves accumulate); `{ start: "fixed" }`
 * restarts every cycle from one capture, so cycles match and scrubbing is exact.
 *
 * @param animation - The animation to repeat.
 * @param times - Number of runs. Defaults to 2.
 * @param options - See {@link RepeatOptions}.
 * @returns An {@link Animation}.
 * @see {@link https://sophistry.dev/guides/timelines/#repeating-and-scrubbing-across-cycles}
 * @category Animation composition & timelines
 */
export function repeat(
	animation: Animation,
	times = 2,
	options: RepeatOptions = {},
): Animation {
	return cycles(animation, times, options.start);
}

/**
 * Loops an animation without end; for ambient motion.
 *
 * Its duration is `Infinity`, so the run only ends when its signal aborts
 * (resolving `"aborted"`), at which point the active cycle's `abort()` hooks
 * fire. See {@link repeat} for per-cycle start-value semantics and the
 * `start` option.
 *
 * @param animation - The animation to loop.
 * @param options - See {@link RepeatOptions}.
 * @returns An {@link Animation} of infinite duration.
 * @category Animation composition & timelines
 */
export function forever(
	animation: Animation,
	options: RepeatOptions = {},
): Animation {
	return cycles(animation, Number.POSITIVE_INFINITY, options.start);
}
