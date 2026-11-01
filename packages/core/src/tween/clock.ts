/**
 * The playback clock every tween runs on.
 *
 * This is what makes the framework "controllable": tweens never read
 * `performance.now()` themselves, they advance by whatever delta the clock
 * hands them. Pausing the clock pauses every animation in flight; changing its
 * speed re-times them; `advance()` steps time forward by hand, which is how
 * scrubbing and deterministic testing work.
 */

import type { Readable } from "../reactive/index.js";
import { derive, track } from "../reactive/index.js";
import { onFrame } from "./frame-loop.js";
import type { ReducedMotion } from "./reduced-motion.js";
import { prefersReducedMotion } from "./reduced-motion.js";

/**
 * Callback receiving the step `dt` and the new total `time`, both in seconds.
 *
 * @category Tracks & clocks
 */
export type ClockListener = (dt: number, time: number) => void;

/**
 * A controllable playback clock that every tween subscribes to.
 *
 * `time`, `paused`, `speed` and `reducedMotion` are {@link Readable}s: `peek()`
 * them for the current value, or bind them (a playback UI, a node prop) to
 * follow changes.
 *
 * @category Tracks & clocks
 */
export interface Clock {
	/** Scaled elapsed time in seconds. */
	readonly time: Readable<number>;
	/** Whether the clock is paused. */
	readonly paused: Readable<boolean>;
	/** Playback speed multiplier (1 is real time). */
	readonly speed: Readable<number>;
	/** Stops time advancing; tweens in flight hold their value. */
	pause(): void;
	/** Resumes after {@link Clock.pause}. */
	resume(): void;
	/** Flips between paused and playing. */
	toggle(): void;
	/** Sets the speed multiplier; negative values are clamped to 0. */
	setSpeed(speed: number): void;
	/**
	 * Whether runs on this clock should reduce motion. Follows the
	 * user's `prefers-reduced-motion` setting unless the clock's mode was
	 * forced (see {@link ClockOptions.reducedMotion}). Under reduced motion,
	 * `play()` and `timeline().play()` jump to the end state instead of
	 * animating; `advance()`/`onTick()` themselves are unaffected.
	 */
	readonly reducedMotion: Readable<boolean>;
	/** Sets how {@link Clock.reducedMotion} is decided: follow the system (`"auto"`), or force it either way. */
	setReducedMotion(mode: ReducedMotion): void;
	/** Advances time by `dt` seconds by hand, ignoring speed — works whether or not the clock is paused. Non-positive values are ignored. */
	advance(dt: number): void;
	/** Calls `listener` every step until the returned function is called. Frames come from the shared frame loop's `"tick"` phase while anyone is subscribed; each frame's delta is capped at 1/15 s of real time (so a stalled tab resumes smoothly) and scaled by `speed`. */
	onTick(listener: ClockListener): () => void;
}

/**
 * How a reduced-motion run's jump to its end state is shown: `"fade"`, a
 * short cross-fade of the whole scene from the old picture to the new (at
 * most 150 ms), or `"cut"`, straight to it. Either way the tracks land on
 * their end state at once, so seeking, `await play(...)` and export behave
 * identically; only the pixels differ, for a moment. The scene implements
 * the fade; runs only call their `onReducedJump` hook.
 *
 * @category Tracks & clocks
 */
export type ReducedMotionTransition = "fade" | "cut";

/**
 * Options for {@link createClock}.
 *
 * @category Tracks & clocks
 */
export interface ClockOptions {
	/**
	 * How runs on this clock decide to reduce motion: `"auto"` follows the
	 * user's `prefers-reduced-motion` setting live, `"reduce"` and
	 * `"no-preference"` force it. See {@link Clock.reducedMotion}.
	 *
	 * @default "auto"
	 */
	reducedMotion?: ReducedMotion;
}

/**
 * Longest delta a single frame may report, in seconds.
 *
 * The cap is intentional: after a long stall (a backgrounded tab, a debugger
 * pause, a slow first paint) the next frame would otherwise report seconds of
 * elapsed time and every animation in flight would teleport to its end. With
 * the cap a stall costs at most 1/15 s of animation time, so playback resumes
 * where it left off. A consequence worth knowing: on a machine slower than 15
 * fps the clock runs slower than wall time. `advance()` is not capped.
 */
const MAX_FRAME = 1 / 15;

/** Per-clock hooks for {@link watchClockVisibility}, kept off the public interface. */
const gates = new WeakMap<Clock, ClockGate>();

interface ClockGate {
	register(): VisibilityHandle;
}

/** One scene's say in whether a shared clock is suspended. */
export interface VisibilityHandle {
	/** Reports whether the scene is currently on screen. */
	setVisible(visible: boolean): void;
	/** Withdraws this scene's vote. */
	dispose(): void;
}

/**
 * Lets a scene suspend the clock it runs while the scene is off-screen.
 *
 * Suspension is an internal flag, separate from the user-facing `paused()`:
 * user `pause()`/`resume()` are never touched and `paused()` does not flicker.
 * A suspended clock does not tick (and drops out of the frame loop, so a page
 * of off-screen scenes costs no frames); `advance()` still works by hand.
 * The clock is suspended only while it has at least one registered scene and
 * every one of them is hidden, so a clock shared by several scenes keeps
 * running while any of them is visible.
 *
 * `defaultClock` is never suspended — it is shared by unrelated scenes and
 * by playback UI that has no scene at all. Returns `null` for it.
 *
 * @param clock - The clock a scene runs on.
 * @returns A handle, or `null` when this clock cannot be suspended.
 */
export function watchClockVisibility(clock: Clock): VisibilityHandle | null {
	if (clock === defaultClock) return null;
	return gates.get(clock)?.register() ?? null;
}

/**
 * Creates an independent playback clock.
 *
 * Use one per scene that needs its own pause/speed controls, and pass it to
 * the scene and to `play(..., { clock })`. The clock only ticks while it has
 * subscribers, and all clocks share one frame loop with the scenes' commits
 * and painting (see `frame-loop.ts`), so a tick and the paint it causes land
 * in the same frame.
 *
 * Each frame advances the clock by the real elapsed time times `speed`, **capped
 * at 1/15 s of real time per frame** so a stalled or backgrounded tab resumes
 * smoothly instead of jumping ahead. Time only moves forward. A scene that is
 * given its own clock may suspend it while it is scrolled out of view (see
 * {@link watchClockVisibility}); that does not change `paused`.
 *
 * @example
 * ```ts
 * import { createClock, play, valueTo, track } from "@sophistry/core";
 *
 * const clock = createClock();
 * const opacity = track(0);
 * void play(valueTo(opacity, 1), { clock });
 * clock.setSpeed(0.5); // slow motion
 * clock.advance(1); // or step by hand: deterministic, ignores speed
 * ```
 *
 * @param options - See {@link ClockOptions}.
 * @returns A new, unpaused clock at time 0 and speed 1.
 * @category Tracks & clocks
 */
export function createClock(options: ClockOptions = {}): Clock {
	const reducedMode = track<ReducedMotion>(options.reducedMotion ?? "auto");
	const time = track(0);
	const paused = track(false);
	const speed = track(1);
	const reducedMotion = derive(
		[reducedMode, prefersReducedMotion],
		(mode, system) => mode === "reduce" || (mode === "auto" && system),
	);

	const listeners = new Set<ClockListener>();
	const handles = new Map<object, boolean>();
	let last: number | null = null;
	let suspended = false;
	let userPaused = false;
	let detach: (() => void) | null = null;

	const emit = (dt: number) => {
		const next = time.peek() + dt;
		time.set(next);
		// Copy first: a listener may unsubscribe itself as it completes.
		for (const listener of [...listeners]) listener(dt, next);
	};

	const tick = (now: number) => {
		const raw = last === null ? 0 : Math.max(0, (now - last) / 1000);
		last = now;
		const dt = userPaused ? 0 : Math.min(raw, MAX_FRAME) * speed.peek();
		if (dt > 0) emit(dt);
	};
	const reset = () => {
		last = null;
	};

	/**
	 * Joins or leaves the shared loop: active iff subscribed, not suspended and
	 * not paused by the user. A paused clock's tick would only compute `dt = 0`
	 * every frame, so it leaves the loop (letting the page go idle) and rejoins
	 * with a reset timestamp on resume, so the paused interval never shows up as
	 * a big `dt`.
	 */
	const sync = () => {
		const active = listeners.size > 0 && !suspended && !userPaused;
		if (active && !detach) {
			last = null;
			detach = onFrame("tick", tick, { reset });
		} else if (!active && detach) {
			detach();
			detach = null;
			last = null;
		}
	};

	const resuspend = () => {
		suspended = handles.size > 0 && [...handles.values()].every((v) => !v);
		sync();
	};

	const setPaused = (value: boolean) => {
		userPaused = value;
		paused.set(value);
		sync();
	};

	const clock: Clock = {
		time: readOnly(time),
		paused: readOnly(paused),
		speed: readOnly(speed),
		pause: () => setPaused(true),
		resume: () => setPaused(false),
		toggle: () => setPaused(!userPaused),
		setSpeed: (value) => speed.set(Math.max(0, value)),
		reducedMotion,
		setReducedMotion: (mode) => reducedMode.set(mode),
		advance: (dt) => {
			if (dt > 0) emit(dt);
		},
		onTick(listener) {
			listeners.add(listener);
			sync();
			return () => {
				listeners.delete(listener);
				sync();
			};
		},
	};

	gates.set(clock, {
		register() {
			const token = {};
			handles.set(token, true);
			resuspend();
			return {
				setVisible(visible) {
					if (!handles.has(token)) return;
					handles.set(token, visible);
					resuspend();
				},
				dispose() {
					handles.delete(token);
					resuspend();
				},
			};
		},
	});

	return clock;
}

/** A view of a track that cannot be written through. */
function readOnly<T>(source: Readable<T>): Readable<T> {
	return { peek: source.peek, subscribe: source.subscribe };
}

/**
 * The clock used when a tween isn't given one. Playback controls in the UI
 * drive this; scenes that need independent timelines make their own.
 *
 * @category Tracks & clocks
 */
export const defaultClock: Clock = createClock();
