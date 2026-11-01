/**
 * Spring verbs: {@link springTo}, a seekable leaf whose length is the spring's
 * settle time, and {@link follow}, a live follower that chases a reactive
 * source on a clock and keeps its velocity when the source moves.
 *
 * Both are built on the closed-form solver in `tween/spring.ts`, so neither
 * integrates: `springTo` samples the exact solution at whatever time it is
 * seeked to, and `follow` re-solves from its current position and velocity
 * each time its target changes, then samples that solution until the next
 * change. Springs feed the ordinary interpolators with progress that can
 * overshoot 0..1; the interpolators extrapolate (and clamp colour channels).
 */

import type { Readable } from "../reactive/track.js";
import type { Clock } from "../tween/clock.js";
import { defaultClock } from "../tween/clock.js";
import type { Interpolator } from "../tween/interpolate.js";
import { auto } from "../tween/interpolators.js";
import type { SpringOptions, SpringState } from "../tween/spring.js";
import {
	naturalFrequency,
	spring,
	springAt,
	springProgress,
	springRestDelta,
} from "../tween/spring.js";
import type { Animatable } from "../tween/target.js";
import type { Animation } from "./animation.js";
import { easedLeaf } from "./animation.js";

/**
 * Options for {@link springTo}.
 *
 * @category Springs
 */
export interface SpringToOptions<T> extends SpringOptions {
	/**
	 * Seconds of leading hold before the spring is released. The animation's
	 * {@link Animation.duration} is `delay` plus the settle time.
	 * @default 0
	 */
	delay?: number;
	/**
	 * Builds a sampler between the start and end values. Defaults to `auto`.
	 * It is sampled with progress that overshoots 0..1 for an under-damped
	 * spring, so it must extrapolate sensibly.
	 */
	interpolate?: Interpolator<T>;
}

/**
 * Springs a target from wherever it is when the animation is entered to `to`,
 * as a seekable {@link Animation} leaf.
 *
 * Progress runs from 0 to 1 along the exact solution of a spring released
 * with displacement 1 and `velocity` (progress units per second), and is
 * mapped through `interpolate(from, to)`; an under-damped spring overshoots.
 * The duration is the spring's settle time (see `springSettleTime`), which
 * depends only on the options, never on the values, so it is known when the
 * animation is built and the leaf sequences like any other. Seeking is O(1)
 * and order-independent; at the end the target is set to exactly `to`.
 *
 * The start value is captured with `target.peek()` the first time the
 * animation is entered, like `driveTrack`.
 *
 * @param target - The target to drive.
 * @param to - The end value, or a function from the value at entry to the end
 *   value (e.g. `(current) => current + 100`).
 * @param options - Spring parameters, `delay` and `interpolate`.
 * @returns An {@link Animation} of duration `delay` + settle time.
 * @throws `RangeError` for invalid spring options (see `spring`).
 *
 * @example
 * ```ts
 * import { createScene, springTo, track } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")! });
 * const x = track(0);
 * void scene.play(springTo(x, 200, { stiffness: 170, damping: 12 }));
 * ```
 *
 * @category Springs
 */
export function springTo<T>(
	target: Animatable<T>,
	to: T | ((current: T) => T),
	options: SpringToOptions<T> = {},
): Animation {
	const { duration, progress } = springProgress(options);
	const easing = (raw: number) => progress(raw * duration);
	let sample: (t: number) => T = () => target.peek();
	let end: T = target.peek();
	return easedLeaf(
		{ duration, delay: options.delay, easing },
		{
			begin() {
				const start = target.peek();
				end = typeof to === "function" ? (to as (current: T) => T)(start) : to;
				sample = (options.interpolate ?? auto)(start, end);
			},
			// Raw progress 1 writes the end value itself, not `lerp(from, to, 1)`,
			// which can miss it by an ulp.
			apply: (eased, raw) => target.set(raw >= 1 ? end : sample(eased)),
		},
	);
}

/**
 * Options for {@link follow}.
 *
 * @category Springs
 */
export interface FollowOptions<T> {
	/**
	 * The clock the follower runs on. Time comes only from its steps.
	 * @default defaultClock
	 */
	clock?: Clock;
	/**
	 * Builds a sampler between two values. When given, the follower always
	 * springs in progress space through it (see {@link follow}); when omitted,
	 * numbers, points and number arrays spring per component and everything
	 * else goes through `auto`.
	 */
	interpolate?: Interpolator<T>;
}

/** A value split into numbers, and how to put it back together. */
interface Components<T> {
	/** Discriminates value shapes that can be blended component-wise. */
	kind: "number" | "point" | "point3" | "array";
	values: number[];
	/** Rebuilds a value of this shape, taking non-numeric fields from `like`. */
	build(values: number[], like: T): T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Splits numbers, `{x, y}` points, `{x, y, z}` points and arrays of numbers
 * into components; `undefined` for anything else.
 */
function components<T>(value: T): Components<T> | undefined {
	if (typeof value === "number") {
		return {
			kind: "number",
			values: [value],
			build: (values) => values[0] as T,
		};
	}
	if (Array.isArray(value)) {
		if (!value.every((item) => typeof item === "number")) return undefined;
		return {
			kind: "array",
			values: [...value],
			build: (values) => [...values] as T,
		};
	}
	if (
		isRecord(value) &&
		typeof value.x === "number" &&
		typeof value.y === "number"
	) {
		if (typeof value.z === "number") {
			return {
				kind: "point3",
				values: [value.x, value.y, value.z],
				build: (values, like) =>
					({ ...like, x: values[0], y: values[1], z: values[2] }) as T,
			};
		}
		if ("z" in value) return undefined;
		return {
			kind: "point",
			values: [value.x, value.y],
			build: (values, like) => ({ ...like, x: values[0], y: values[1] }) as T,
		};
	}
	return undefined;
}

/**
 * Makes `target` follow `source` with a spring, live, on a clock.
 *
 * When `source` changes the spring is re-solved from the follower's
 * **current position and velocity** toward the new value, so a target that
 * moves mid-flight bends the motion instead of restarting it. Between changes
 * the follower samples the exact closed-form solution, so frame rate does not
 * affect the path.
 *
 * - **Numbers, `{x, y}` and `{x, y, z}` points, and arrays of numbers** (when
 *   no `interpolate` is given, and the new value has the same shape and
 *   length as the current one) spring **per component**: each component has
 *   its own position and velocity, and velocity is preserved exactly across a
 *   retarget. Non-numeric fields of a point are taken from the new source
 *   value. `restDelta` is in the value's own units.
 * - **Anything else** (colours, matrices, polylines, whatever `auto` or the
 *   given `interpolate` handles) springs in **progress space**: each retarget
 *   starts a new segment `interpolate(current, next)` and springs progress
 *   from 0 to 1. The progress velocity (fraction of the segment per second)
 *   is carried into the new segment unchanged. That is an approximation:
 *   it is exact when consecutive segments have the same length and
 *   direction, and otherwise keeps the motion continuous in position but
 *   rescales its speed by the ratio of the segment lengths. `restDelta` is in
 *   progress units.
 *
 * The follower starts at rest at `target.peek()`. It is subscribed to the
 * clock only while moving: once settled (energy norm within `restDelta` in
 * every component; see `springSettleTime`) it writes the exact source value
 * and unsubscribes, so an idle follower costs no frames. A source change
 * only marks the follower and resubscribes it; the new value is read with
 * `source.peek()` at the next clock step, after the current motion has been
 * advanced to that step, so several changes in one frame cost one retarget.
 * The follower owns the target while it runs; other writes to it are
 * overwritten on the next step.
 *
 * @param target - The target to drive.
 * @param source - The value to chase.
 * @param springOptions - Stiffness, damping, mass and `restDelta`
 *   (`velocity` is not used: the follower starts at rest).
 * @param options - The clock and an optional interpolator.
 * @returns A function that stops following, leaving the target where it is.
 * @throws `RangeError` for invalid spring options (see `spring`).
 *
 * @example
 * ```ts
 * import { follow, track } from "@sophistry/core";
 *
 * const pointer = track({ x: 0, y: 0 });
 * const marker = track({ x: 0, y: 0 });
 * const stop = follow(marker, pointer, { stiffness: 200, damping: 20 });
 * pointer.set({ x: 120, y: 40 }); // marker springs after it
 * ```
 *
 * @category Springs
 */
export function follow<T>(
	target: Animatable<T>,
	source: Readable<T>,
	springOptions: Omit<SpringOptions, "velocity"> = {},
	options: FollowOptions<T> = {},
): () => void {
	const spec = spring(springOptions);
	const restDelta = springRestDelta(springOptions);
	const omega = naturalFrequency(spec);
	const clock = options.clock ?? defaultClock;
	const state: SpringState = { displacement: 0, velocity: 0 };
	/** Whether `state`, as last sampled, is within `restDelta` of rest. */
	const atRest = () => {
		const scaled = state.velocity / omega;
		return (
			state.displacement * state.displacement + scaled * scaled <=
			restDelta * restDelta
		);
	};

	// The goal and the time since the current segment began.
	let goal = source.peek();
	let elapsed = 0;

	// Per-component mode: displacement and velocity of each component at the
	// start of the segment, measured from the goal's components.
	let shape: Components<T> | undefined;
	let goalValues: number[] = [];
	let startDisplacement: number[] = [];
	let startVelocity: number[] = [];
	let current: number[] = [];

	// Progress mode: the segment being sprung along, and the progress state at
	// its start (displacement from 1, and velocity).
	let segment: ((t: number) => T) | undefined;
	let progressDisplacement = -1;
	let progressVelocity = 0;

	let unsubscribeClock: (() => void) | undefined;
	let stale = false;
	let stopped = false;

	/** Starts a segment from `from` (with per-component velocity, if any) to `goal`. */
	const startSegment = (from: T, velocities: number[] | undefined) => {
		elapsed = 0;
		const fromShape = options.interpolate ? undefined : components(from);
		const toShape = fromShape ? components(goal) : undefined;
		if (
			fromShape &&
			toShape &&
			fromShape.kind === toShape.kind &&
			fromShape.values.length === toShape.values.length
		) {
			shape = toShape;
			segment = undefined;
			goalValues = toShape.values;
			startDisplacement = fromShape.values.map(
				(value, i) => value - (goalValues[i] ?? 0),
			);
			startVelocity = fromShape.values.map((_, i) => velocities?.[i] ?? 0);
			current = [...fromShape.values];
			return;
		}
		shape = undefined;
		segment = (options.interpolate ?? auto)(from, goal);
		progressDisplacement = -1;
	};

	/** Advances to `elapsed`, writes the target, and reports whether at rest. */
	const sampleAndWrite = (): boolean => {
		if (shape) {
			let resting = true;
			for (let i = 0; i < goalValues.length; i++) {
				springAt(
					spec,
					startDisplacement[i] ?? 0,
					startVelocity[i] ?? 0,
					elapsed,
					state,
				);
				current[i] = (goalValues[i] ?? 0) + state.displacement;
				if (!atRest()) resting = false;
			}
			target.set(resting ? goal : shape.build(current, goal));
			return resting;
		}
		springAt(spec, progressDisplacement, progressVelocity, elapsed, state);
		const resting = atRest();
		target.set(resting || !segment ? goal : segment(1 + state.displacement));
		return resting;
	};

	/** Re-solves from the current position and velocity toward `source.peek()`. */
	const retarget = () => {
		stale = false;
		const next = source.peek();
		if (Object.is(next, goal)) return;
		if (shape) {
			// Exact per-component velocities at this instant.
			const velocities = goalValues.map((value, i) => {
				springAt(
					spec,
					startDisplacement[i] ?? 0,
					startVelocity[i] ?? 0,
					elapsed,
					state,
				);
				current[i] = value + state.displacement;
				return state.velocity;
			});
			const from = shape.build(current, goal);
			goal = next;
			startSegment(from, velocities);
			if (!shape) {
				// The shape changed: fall back to progress space, from rest.
				progressVelocity = 0;
			}
			return;
		}
		springAt(spec, progressDisplacement, progressVelocity, elapsed, state);
		const from = segment ? segment(1 + state.displacement) : target.peek();
		const carried = state.velocity;
		goal = next;
		startSegment(from, undefined);
		// Progress velocity carries over unchanged (see the doc above).
		progressVelocity = shape ? 0 : carried;
	};

	const step = (dt: number) => {
		elapsed += dt;
		if (stale) retarget();
		if (sampleAndWrite()) {
			unsubscribeClock?.();
			unsubscribeClock = undefined;
		}
	};

	const wake = () => {
		if (!unsubscribeClock && !stopped) unsubscribeClock = clock.onTick(step);
	};

	startSegment(target.peek(), undefined);
	progressVelocity = 0;
	// Already at the source: nothing to animate until it changes.
	const initiallyResting = shape
		? startDisplacement.every((value) => Math.abs(value) <= restDelta)
		: Object.is(target.peek(), goal);
	if (!initiallyResting) wake();

	const unsubscribeSource = source.subscribe(() => {
		// Only mark: the new value is read at the next clock step.
		stale = true;
		wake();
	});

	return () => {
		stopped = true;
		unsubscribeSource();
		unsubscribeClock?.();
		unsubscribeClock = undefined;
	};
}
