/**
 * The runner: samples an `Animation` against a clock. `timeline()` is the
 * seekable controller and `play()` is `timeline(parallel(...)).play()`. The
 * clock is passed explicitly (a scene's `play` passes its own) and defaults
 * to `defaultClock`; disposal is explicit too (`timeline.dispose()` or an
 * `AbortSignal`), since there is no owner tree to hang cleanup on.
 *
 * A running timeline holds one clock subscription and seeks the whole composite
 * to its absolute elapsed time each step, so composition is frame-exact and
 * `clock.advance(10)` fast-forwards a nested script.
 */

import type { Readable } from "../reactive/index.js";
import { isReadable, track } from "../reactive/index.js";
import type { Clock } from "../tween/clock.js";
import { defaultClock } from "../tween/clock.js";
import type { ReducedMotion } from "../tween/reduced-motion.js";
import { resolveReducedMotion } from "../tween/reduced-motion.js";
import type { Animation } from "./animation.js";
import { compose, EPSILON, restTime, sampleTime } from "./animation.js";

/**
 * Runs `fn` on a later macrotask without `setTimeout`: timers are clamped to
 * about 1 s in background tabs and frozen by fake-timer test setups, while a
 * `MessageChannel` message is neither. Falls back to `setTimeout(0)` where
 * `MessageChannel` does not exist.
 */
function macrotask(fn: () => void): void {
	if (typeof MessageChannel === "undefined") {
		setTimeout(fn, 0);
		return;
	}
	const channel = new MessageChannel();
	channel.port1.onmessage = () => {
		// Closing both ends lets a Node process exit and frees the port.
		channel.port1.close();
		channel.port2.close();
		fn();
	};
	channel.port2.postMessage(null);
}

/**
 * How a run ended. `play()` and `timeline().play()` resolve with this and never
 * reject, so scripts unwind with `if (result === "aborted") return;`.
 *
 * @category Animation composition & timelines
 */
export type PlayResult = "done" | "aborted";

/**
 * The context a run needs: where time comes from and how to cancel it.
 *
 * @category Animation composition & timelines
 */
export interface PlayContext {
	/** Clock that drives time. Defaults to `defaultClock`. */
	clock?: Clock;
	/**
	 * Aborting stops everything inside the run, however deeply nested (every
	 * active leaf gets its `abort()` hook, so the grow presets snap back to
	 * rest), and resolves the run with `"aborted"`.
	 */
	signal?: AbortSignal;
	/**
	 * Whether this run reduces motion: `"auto"` defers to the clock's
	 * `reducedMotion`, `"reduce"` and `"no-preference"` force it, a Readable
	 * answers live (a scene passes its own setting this way). A reduced run
	 * jumps to its end state and resolves `"done"`.
	 * @default "auto"
	 * @see {@link https://sophistry.dev/guides/timelines/#reduced-motion}
	 */
	reducedMotion?: ReducedMotion | Readable<boolean>;
	/**
	 * `"essential"` marks motion that carries information the user needs (a
	 * progress indicator, the one thing a demo exists to show): it plays even
	 * under reduced motion. `"decorative"` (the default) is reduced. WCAG
	 * allows essential motion, but keep it small and gentle.
	 */
	motion?: "decorative" | "essential";
	/**
	 * Called just before a reduced-motion run jumps to its end state: how a
	 * scene shows the jump (its `reducedMotionTransition`; a scene's `play`
	 * passes its own). Not called for runs that animate, nor for `seek()`.
	 */
	onReducedJump?: () => void;
}

/**
 * A seekable controller over one animation.
 *
 * `time` and `playing` are {@link Readable}s, so a scrubber can bind them.
 * Seeking works whether or not the timeline is playing and in both directions.
 *
 * @category Animation composition & timelines
 */
export interface Timeline {
	/** Length of the animation in seconds (`Infinity` for `forever`). */
	readonly duration: number;
	/** Current position in seconds, `0..duration`. */
	readonly time: Readable<number>;
	/** Whether the timeline is currently subscribed to its clock. */
	readonly playing: Readable<boolean>;
	/**
	 * Jumps to `t` seconds (clamped to `0..duration`) and writes that state to
	 * every track. Seeking backwards restores start values. If the timeline is
	 * playing and `t` is at the end, the run resolves `"done"`. `NaN` and
	 * `-Infinity` seek to 0; `Infinity` seeks to the end, or, on an endless
	 * timeline, to its rest state (see {@link Animation.restAt}).
	 */
	seek(t: number): void;
	/**
	 * Starts, or resumes after {@link Timeline.pause}, from the current position.
	 * From the end it replays: every step is restored and re-armed, so a replay
	 * matches the first run. Resolves `"done"` or `"aborted"`; calling it while
	 * running returns the same promise. Under reduced motion it jumps to the rest
	 * position.
	 */
	play(): Promise<PlayResult>;
	/** Stops advancing without ending the run; `play()` resumes it. */
	pause(): void;
	/**
	 * Ends the run: active leaves get `abort()` and the pending `play()`
	 * promise resolves `"aborted"`. A no-op when nothing is running.
	 */
	abort(): void;
	/**
	 * Aborts any run (as {@link Timeline.abort}) and retires the timeline:
	 * later `play()` calls resolve `"aborted"` at once. Seeking still writes
	 * state, so a disposed timeline can be scrubbed by hand. Aborting the
	 * context's `signal` disposes it too.
	 */
	dispose(): void;
}

/**
 * Creates a seekable {@link Timeline} over `animation`. Nothing runs until
 * `play()` or `seek()`; scrubbing restores earlier states, and a replay from the
 * end matches the first run. Don't run one animation value in two timelines at
 * once.
 *
 * @param animation - What to run; use `parallel(...)` for several.
 * @param context - `clock` (default `defaultClock`) and `signal` (aborting it
 *   disposes the timeline).
 * @returns The controller.
 * @see {@link https://sophistry.dev/guides/timelines/#timeline-and-scrubbing}
 * @example
 * ```ts
 * import {
 *   createClock,
 *   fadeIn,
 *   moveTo,
 *   sequence,
 *   timeline,
 *   track,
 *   trackPoint,
 * } from "@sophistry/core";
 *
 * const opacity = track(0);
 * const position = trackPoint(0, 0);
 * const tl = timeline(sequence(fadeIn(opacity), moveTo(position, { x: 3, y: 0 })), {
 *   clock: createClock(),
 * });
 *
 * tl.seek(1.5); // scrub: fade done, move half way
 * tl.seek(0.2); // and back: the move is restored to its start
 * void tl.play(); // resume from 0.2
 * ```
 *
 * @category Animation composition & timelines
 */
export function timeline(
	animation: Animation,
	context: PlayContext = {},
): Timeline {
	const clock = context.clock ?? defaultClock;
	const root = compose([{ animation, start: 0 }]);
	const duration = root.duration;
	const time = track(0);
	const playing = track(false);
	let disposed = false;

	let current = 0;
	let run: {
		promise: Promise<PlayResult>;
		resolve: (result: PlayResult) => void;
	} | null = null;
	let unsubscribe: (() => void) | null = null;

	const stopClock = () => {
		unsubscribe?.();
		unsubscribe = null;
		playing.set(false);
	};

	/**
	 * Ends the run. `defer` resolves the promise on a later macrotask instead of
	 * right away: a reduced-motion run completes instantly, and a script that
	 * loops `while (alive) await play(...)` must not turn that into a
	 * microtask-only spin that starves the page.
	 */
	const settle = (result: PlayResult, defer = false) => {
		const finished = run;
		run = null;
		stopClock();
		context.signal?.removeEventListener("abort", dispose);
		if (defer && finished) macrotask(() => finished.resolve(result));
		else finished?.resolve(result);
	};

	/** Whether this run should jump to its rest state; read live, each step. */
	const reduced = (): boolean => {
		if (context.motion === "essential") return false;
		const mode = context.reducedMotion;
		if (isReadable(mode)) return mode.peek();
		if (mode === "reduce" || mode === "no-preference") {
			return resolveReducedMotion(mode);
		}
		return clock.reducedMotion.peek();
	};

	/** Jumps to the animation's rest state and ends the run. */
	const settleReduced = () => {
		if (restTime(root) !== current) context.onReducedJump?.();
		write(restTime(root));
		settle("done", true);
	};

	// Whether anything has been written since creation (or the last reset).
	let touched = false;

	const write = (t: number) => {
		touched = true;
		current = sampleTime(t, duration, restTime(root));
		// Land exactly on the end: accumulated float steps can stop a hair short.
		if (current >= duration - EPSILON) current = duration;
		time.set(current);
		root.seek(current);
	};

	const reachedEnd = () => current >= duration;

	function abort() {
		if (!run) return;
		root.abort?.();
		settle("aborted");
	}

	// The signal is listened to only while a run is pending (a long-lived
	// signal shared by many `play()` calls must not collect a listener per
	// timeline); between runs, `play()` checks `signal.aborted` itself.
	function dispose() {
		disposed = true;
		abort();
	}

	const step = (dt: number) => {
		// A clock emit iterates a snapshot of its listeners, so a step can still
		// arrive after an earlier listener aborted or paused this run.
		if (!run || !unsubscribe) return;
		// The preference can change mid-run: finish at once, like a fresh run would.
		if (reduced()) return settleReduced();
		write(current + dt);
		if (reachedEnd()) settle("done");
	};

	const controller: Timeline = {
		duration,
		time: { peek: time.peek, subscribe: time.subscribe },
		playing: { peek: playing.peek, subscribe: playing.subscribe },
		seek(t) {
			write(t);
			if (run && reachedEnd()) settle("done");
		},
		play() {
			if (run) {
				if (!unsubscribe) {
					unsubscribe = clock.onTick(step);
					playing.set(true);
				}
				return run.promise;
			}
			if (disposed || context.signal?.aborted) {
				return Promise.resolve("aborted");
			}
			let resolve: (result: PlayResult) => void = () => {};
			const promise = new Promise<PlayResult>((r) => {
				resolve = r;
			});
			run = { promise, resolve };
			context.signal?.addEventListener("abort", dispose, { once: true });
			// Landing at the end means "play again from the start": restore every
			// step, then arm the animation afresh.
			if (reachedEnd()) {
				// Rewind first: pass 1 of a composite only rewinds children it has
				// entered, and `begin()` forgets that, so without this a later step's
				// final state would survive into t = 0 of the replay.
				root.restore?.();
				root.begin?.();
				if (duration > 0) current = 0;
			}
			if (reduced()) {
				settleReduced();
				return promise;
			}
			// Sample the current position right away, so t = 0 state (and a
			// zero-length animation's final state) lands without waiting a frame.
			write(current);
			if (reachedEnd()) {
				settle("done");
				return promise;
			}
			unsubscribe = clock.onTick(step);
			playing.set(true);
			return promise;
		},
		pause: stopClock,
		abort,
		dispose,
	};
	internals.set(controller, {
		clock,
		scrub: write,
		pristine: () => !touched,
		reset() {
			root.restore?.();
			root.begin?.();
			current = 0;
			touched = false;
			time.set(0);
		},
	});
	return controller;
}

/**
 * What the exporter needs from a {@link Timeline} beyond its public surface.
 * Kept off the interface so `seek` keeps its documented meaning.
 */
export interface TimelineInternals {
	/** The clock the timeline runs on. */
	readonly clock: Clock;
	/**
	 * Like `seek`, but never settles a pending run: the timeline can be scrubbed
	 * for rendering and returned to where it was, and the caller's `play()`
	 * promise keeps waiting.
	 */
	scrub(t: number): void;
	/** Whether nothing has been written since creation (or the last `reset`). */
	pristine(): boolean;
	/** Returns a never-run timeline's tracks to their start and forgets all captures. */
	reset(): void;
}

const internals = new WeakMap<Timeline, TimelineInternals>();

/** The {@link TimelineInternals} of a timeline made by {@link timeline}, if it is one. */
export function timelineInternals(tl: Timeline): TimelineInternals | undefined {
	return internals.get(tl);
}

/** Whether `value` quacks like an {@link Animation}. */
function isAnimation(value: unknown): value is Animation {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Animation).seek === "function" &&
		typeof (value as Animation).duration === "number"
	);
}

/** Whether `value` is a plain object (the only thing accepted as a context). */
function isPlainObject(value: unknown): value is PlayContext {
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Splits `play`'s variadic arguments into animations and a trailing context.
 * The context is a final argument that is a plain object and not an animation;
 * anything else that is not an animation is a `TypeError`. Exported for
 * bindings that wrap `play` (their `usePlayer`).
 *
 * @internal
 */
export function splitPlayArguments(args: unknown[]): {
	animations: Animation[];
	context: PlayContext;
} {
	const last = args[args.length - 1];
	const hasContext = !isAnimation(last) && isPlainObject(last);
	const animations = hasContext ? args.slice(0, -1) : args;
	animations.forEach((value, i) => {
		if (!isAnimation(value)) {
			throw new TypeError(
				`play(): argument ${i} is not an Animation (expected an object with a numeric duration and a seek method${i === args.length - 1 ? ", or a trailing { clock, signal } context" : ""})`,
			);
		}
	});
	return {
		animations: animations as Animation[],
		context: hasContext ? (last as PlayContext) : {},
	};
}

/**
 * One signal that aborts when any of `signals` does; `undefined` entries are
 * skipped. For bindings that merge a component's lifetime signal into a run's
 * (their `usePlayer`).
 *
 * @internal
 */
export function anySignal(
	...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
	const live = signals.filter((s): s is AbortSignal => s !== undefined);
	if (live.length < 2) return live[0];
	if (typeof AbortSignal.any === "function") return AbortSignal.any(live);
	const controller = new AbortController();
	for (const signal of live) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), {
			once: true,
		});
	}
	return controller.signal;
}

/**
 * Runs animations in parallel on one clock and resolves when the longest
 * finishes (Manim's `self.play(...)`). Pass a final `{ clock, signal }` to pick
 * the clock and cancel; a scene's `play` passes its own clock. Resolves
 * `"done"` or `"aborted"` and never rejects. Consecutive `await play()` calls
 * are not frame-exact; compose with `sequence` when timing matters.
 *
 * @param args - Animations to run together, optionally followed by a
 *   {@link PlayContext}.
 * @returns A promise of how the run ended.
 * @example
 * ```ts
 * import { createClock, fadeIn, moveTo, play, track, trackPoint } from "@sophistry/core";
 *
 * const clock = createClock();
 * const opacity = track(0);
 * const position = trackPoint(-2, 0);
 * const controller = new AbortController();
 * await play(fadeIn(opacity), { clock, signal: controller.signal }); // first
 * await play(moveTo(position, { x: 2, y: 0 }, { duration: 2 }), { clock }); // then
 * ```
 *
 * @see {@link https://sophistry.dev/guides/timelines/}
 *
 * @category Animation composition & timelines
 */
export function play(
	...args: Animation[] | [...Animation[], PlayContext]
): Promise<PlayResult> {
	const { animations, context } = splitPlayArguments(args);
	return timeline(
		compose(animations.map((animation) => ({ animation, start: 0 }))),
		context,
	).play();
}
