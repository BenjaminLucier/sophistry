/**
 * The animation model: an `Animation` is data plus a sampler with a known
 * duration, not a running process. A runner (`timeline.ts`) samples the whole
 * script at one absolute time per clock step, which keeps composition exact and
 * makes fast-forward and scrubbing work. No canvas, no clock here.
 */

import { clamp } from "../geometry/lerp";
import type { Easing } from "../tween/easing";
import { resolveEasing } from "../tween/easing";

/**
 * Floating-point slack, in seconds, when comparing absolute times. Child
 * offsets are sums of floats (`0.1 + 0.2`), so a child that "should" be exactly
 * finished can land a few ulps short; without slack its last frame would be
 * left at 0.99999999 of the way.
 */
export const EPSILON = 1e-9;

/**
 * A lazy, seekable animation with a known length. Nothing runs when you build
 * one; a runner ({@link timeline}, {@link play}) samples it. Implement the
 * members only for a custom leaf (see {@link animation}).
 *
 * `seek(t)` writes the state for local time `t` and must not depend on what
 * time was seen before. Composites restore children that are now ahead of the
 * seek time to their start ({@link Animation.restore}), and write later
 * children over earlier ones. {@link Animation.begin} runs the first time a
 * child is entered, seeing the world as of its own start time, so relative
 * animations capture what the previous step left; restoring does not re-arm.
 * `repeat` and `forever` re-enter each cycle.
 *
 * @see {@link https://sophistry.dev/guides/timelines/#what-seeking-does}
 * @see {@link https://sophistry.dev/guides/extending/#custom-animations}
 * @category Animation composition & timelines
 */
export interface Animation {
	/**
	 * Length in seconds of timeline time, including any leading `delay`.
	 * `Infinity` is allowed (`forever`); a runner then never finishes on its own.
	 */
	readonly duration: number;
	/**
	 * The local time a reduced-motion run jumps to instead of playing: the
	 * state the animation comes to rest in. Defaults to {@link
	 * Animation.duration} when that is finite and to `0` when it is infinite
	 * (an endless loop holds its starting state). {@link compose} derives it
	 * from its children, so `sequence(fadeIn(a), forever(spin(b)))` rests at
	 * the end of the fade with the spin held at its start.
	 */
	readonly restAt?: number;
	/**
	 * Called when the animation is armed: the first time it is entered, and
	 * again for each fresh run (a new `repeat` cycle, a `timeline` replay).
	 * Capture start values here, with `peek()`.
	 * It is **not** called again when the animation is merely re-entered after
	 * a {@link Animation.restore}; the earlier capture stays valid.
	 */
	begin?(): void;
	/**
	 * Writes the state for local time `t` (clamped to `[0, duration]` by the
	 * composites and by {@link animation}).
	 */
	seek(t: number): void;
	/**
	 * Optional: writes the start state (what `seek(0)` would write for a leaf
	 * with no leading hold) **and keeps whatever {@link Animation.begin}
	 * captured**. Composites call it instead of `seek(0)` when a scrub rewinds
	 * to before the animation's start, and then skip `begin()` on re-entry. It
	 * matters for zero-length leaves (whose `seek` can only report the final
	 * value) and for `from`-style leaves (whose start state would otherwise be
	 * mistaken for the rest value). Does nothing if the animation was never
	 * entered. When omitted, composites fall back to `seek(0)` and re-arm the
	 * animation with `begin()` on re-entry (the pre-`restore` behaviour).
	 */
	restore?(): void;
	/**
	 * Optional cleanup when the run is aborted while this animation is active
	 * (entered but not finished). The grow presets use it to snap back to rest.
	 * Presets that simply stop where they stand leave it undefined.
	 */
	abort?(): void;
}

/** The time a reduced-motion run of `animation` jumps to; see {@link Animation.restAt}. */
export function restTime(animation: Animation): number {
	return (
		animation.restAt ??
		(Number.isFinite(animation.duration) ? animation.duration : 0)
	);
}

/**
 * Normalises a requested seek time into `[0, duration]`, always finite.
 *
 * `NaN` and `-Infinity` mean the start (`0`); a finite or `+Infinity` time is
 * clamped to `duration`. `+Infinity` on an *endless* animation has no end to
 * land on, so it lands on `rest` (the reduced-motion rest state, finite by
 * construction). Every `seek` path goes through this so a non-finite time can
 * never reach arithmetic like `Infinity - Infinity`.
 */
export function sampleTime(t: number, duration: number, rest = 0): number {
	if (!(t > 0)) return 0;
	if (t === Number.POSITIVE_INFINITY && duration === Number.POSITIVE_INFINITY) {
		return Number.isFinite(rest) && rest > 0 ? rest : 0;
	}
	return t > duration ? duration : t;
}

/** Non-finite, negative and NaN lengths collapse to `fallback`. */
function seconds(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

/**
 * Builds a custom leaf {@link Animation}.
 *
 * `seek` always receives a time clamped to `[0, duration]`, and `duration` is
 * sanitised (negative or NaN becomes 0; `Infinity` is allowed). Use it for
 * anything the track-driving builders ({@link driveTrack}, {@link driveProgress})
 * do not cover.
 *
 * @param spec - The members of {@link Animation}.
 * @returns The animation.
 * @category Animation composition & timelines
 */
export function animation(spec: Animation): Animation {
	const duration = Number.isNaN(spec.duration) ? 0 : Math.max(0, spec.duration);
	return {
		duration,
		restAt: spec.restAt,
		begin: spec.begin ? () => spec.begin?.() : undefined,
		seek: (t) => spec.seek(sampleTime(t, duration, restTime(spec))),
		restore: spec.restore ? () => spec.restore?.() : undefined,
		abort: spec.abort ? () => spec.abort?.() : undefined,
	};
}

/** Timing common to every eased leaf. */
export interface LeafTiming {
	/**
	 * Seconds of eased motion; 0 lands immediately.
	 * @default 1
	 */
	duration?: number;
	/**
	 * Seconds of leading hold inside the animation's own duration.
	 * @default 0
	 */
	delay?: number;
	/**
	 * Easing curve name or function.
	 * @default `"smooth"`
	 */
	easing?: Easing;
}

/** What an eased leaf does at each sampled progress. */
export interface LeafHooks {
	/** Capture start values (via `peek`). */
	begin?: () => void;
	/**
	 * Write state for eased progress `eased` (raw progress `raw`, uneased,
	 * 0..1).
	 */
	apply: (eased: number, raw: number) => void;
	/** Cleanup when aborted while active. Only called if the leaf has begun. */
	abort?: () => void;
	/**
	 * Write the start state (progress 0) for the whole leading `delay` too,
	 * instead of staying silent until the delay ends. The grow presets use it
	 * so a delayed grow is hidden during its delay. Without it a delaying leaf
	 * does not touch the track until the delay is over (so it cannot clobber a
	 * concurrent animation of the same track), except to restore the start
	 * when it is rewound.
	 */
	holdStart?: boolean;
}

/**
 * The shared eased leaf: `[delay][duration of eased progress]`.
 *
 * Handles delay, zero-length animations (a zero-length `seek` reports only the
 * final value; {@link Animation.restore} writes the start), easing, and lazy
 * `begin` so a leaf can be seeked directly in a test without a composite
 * around it.
 */
export function easedLeaf(timing: LeafTiming, hooks: LeafHooks): Animation {
	const length = seconds(timing.duration, 1);
	const delay = seconds(timing.delay, 0);
	const ease = resolveEasing(timing.easing);
	let began = false;
	// Whether this leaf has written since it was last armed; a rewind into the
	// delay then has something to restore.
	let written = false;

	const begin = () => {
		began = true;
		written = false;
		hooks.begin?.();
	};

	return {
		duration: delay + length,
		begin,
		seek(t) {
			if (!began) begin();
			const local = sampleTime(t, delay + length);
			if (local < delay) {
				if (hooks.holdStart || written) {
					hooks.apply(ease(0), 0);
					written = true;
				}
				return;
			}
			const raw = length === 0 ? 1 : Math.min(1, (local - delay) / length);
			hooks.apply(ease(raw), raw);
			written = true;
		},
		restore() {
			// Only a leaf that has written (or holds its start) has anything to undo.
			if (!began || !(written || hooks.holdStart)) return;
			hooks.apply(ease(0), 0);
			written = false;
		},
		abort: () => {
			if (began) hooks.abort?.();
		},
	};
}

/** Where a child is in its life, as seen by the composite that owns it. */
const PENDING = 0;
const ACTIVE = 1;
const DONE = 2;

/** A child placed at an offset inside a composite. */
export interface Placed {
	animation: Animation;
	/** Seconds after the composite's start at which the child begins. */
	start: number;
}

/**
 * Slack, in seconds, when looking children up by start or end time in the
 * sorted indexes. The lookups only narrow the candidates; the exact tests
 * below (the same expressions the semantics are written in) decide, so the
 * slack only has to exceed the rounding in `start + duration`.
 */
const INDEX_SLACK = 1e-6;

/** First position in `sorted` (ascending by `key`) whose key exceeds `limit`. */
function upperBound(
	sorted: readonly number[],
	key: (i: number) => number,
	limit: number,
): number {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (key(sorted[middle] ?? 0) > limit) high = middle;
		else low = middle + 1;
	}
	return low;
}

/** Inserts `value` into `list`, kept ascending, unless it is already there. */
function insertSorted(list: number[], value: number): void {
	let low = 0;
	let high = list.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((list[middle] ?? 0) < value) low = middle + 1;
		else high = middle;
	}
	if (list[low] !== value) list.splice(low, 0, value);
}

/**
 * Builds a composite from children placed at known offsets. `sequence`,
 * `parallel` and `lagged` are all this with different offsets.
 *
 * Duration is `max(start + child.duration)`. See {@link Animation} for the
 * seek semantics it implements.
 *
 * A steady-state seek costs O(active children + log n), not O(n): children
 * are indexed by start and by end time, the active ones are kept in a list,
 * and only a seek that moves *backwards* visits the children it crosses.
 * The bookkeeping rests on two invariants that hold after every seek to
 * `last`: a child that has been entered started at or before `last`, and a
 * finished (DONE) child ended at or before `last`. So a forward seek can only
 * enter children starting in `(last, now]`, and a backward one can only
 * rewind children starting in `(now, last]` or reopen ones ending there.
 */
export function compose(children: Placed[]): Animation {
	const count = children.length;
	const status = children.map(() => PENDING);
	// Whether each child holds a capture from `begin()` that is still valid, so
	// re-entering it after a restore must not call `begin()` again.
	const captured = children.map(() => false);
	const starts = children.map((child) => child.start);
	const lengths = children.map((child) => child.animation.duration);
	const duration = children.reduce(
		(longest, child) =>
			Math.max(longest, child.start + child.animation.duration),
		0,
	);
	// A child that starts at `Infinity` (after an endless one) is never reached,
	// so it cannot define where a reduced run comes to rest.
	const restAt = children.reduce((latest, child) => {
		const rest = child.start + restTime(child.animation);
		return Number.isFinite(rest) ? Math.max(latest, rest) : latest;
	}, 0);
	// Children in start order (stable), computed once: entering needs it every
	// seek, and sorting there would cost O(n log n) per frame.
	const order = children
		.map((_, i) => i)
		.sort((x, y) => (starts[x] ?? 0) - (starts[y] ?? 0) || x - y);
	// Children by end time, for reopening finished ones on a backward seek.
	const ends = starts.map((start, i) => start + (lengths[i] ?? 0));
	const byEnd = children
		.map((_, i) => i)
		.sort((x, y) => (ends[x] ?? 0) - (ends[y] ?? 0) || x - y);
	const startOf = (i: number) => starts[i] ?? 0;
	const endOf = (i: number) => ends[i] ?? 0;
	/** How many children (a prefix of `order`) have started by `now`. */
	const startedBy = (now: number): number => {
		// Exact and monotone in the start, so a plain binary search is exact.
		let low = 0;
		let high = count;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (now - startOf(order[middle] ?? 0) >= -EPSILON) low = middle + 1;
			else high = middle;
		}
		return low;
	};

	// The time of the last seek, or -Infinity when nothing has been entered.
	let last = Number.NEGATIVE_INFINITY;
	// The ACTIVE children, in list order (kept between seeks).
	let live: number[] = [];
	// Reused by every seek, so stepping does not allocate per frame.
	const entering: number[] = [];
	const crossed: number[] = [];
	let merged: number[] = [];

	/** Rewinds child `i` to its start, keeping its capture if it supports that. */
	const rewind = (i: number) => {
		const child = children[i]?.animation;
		if (!child) return;
		if (child.restore) child.restore();
		else {
			child.seek(0);
			captured[i] = false;
		}
		status[i] = PENDING;
	};

	/** Removes the children no longer ACTIVE from `live`, in place. */
	const pruneLive = () => {
		let kept = 0;
		for (const j of live) if (status[j] === ACTIVE) live[kept++] = j;
		live.length = kept;
	};

	return {
		duration,
		restAt,
		begin() {
			// Armed afresh by the parent: forget what we entered and captured.
			status.fill(PENDING);
			captured.fill(false);
			live.length = 0;
			last = Number.NEGATIVE_INFINITY;
		},
		restore() {
			for (let i = count - 1; i >= 0; i--) {
				if (status[i] !== PENDING) rewind(i);
			}
			live.length = 0;
			last = Number.NEGATIVE_INFINITY;
		},
		seek(t) {
			const now = sampleTime(t, duration, restAt);
			const startedBefore =
				last === Number.NEGATIVE_INFINITY ? 0 : startedBy(last);
			const startedNow = startedBy(now);
			// Pass 1, last to first: restore children that were entered but are
			// now ahead of `now`, so their start values land before (and are
			// overridden by) anything earlier in the list. Only children starting
			// in `(now, last]` can be such.
			if (startedNow < startedBefore) {
				crossed.length = 0;
				for (let k = startedNow; k < startedBefore; k++) {
					const i = order[k] ?? 0;
					if (status[i] !== PENDING) crossed.push(i);
				}
				crossed.sort((x, y) => y - x);
				for (const i of crossed) rewind(i);
				pruneLive();
			}
			// Finished children that a backward seek reopens: those ending after
			// `now` (and, by the invariant, at or before `last`).
			crossed.length = 0;
			if (now < last) {
				const from = upperBound(byEnd, endOf, now - INDEX_SLACK);
				const to = upperBound(byEnd, endOf, last + INDEX_SLACK);
				for (let k = from; k < to; k++) {
					const i = byEnd[k] ?? 0;
					if (status[i] !== DONE) continue;
					const local = now - startOf(i);
					if (local >= -EPSILON && local < (lengths[i] ?? 0) - EPSILON) {
						crossed.push(i);
					}
				}
				crossed.sort((x, y) => x - y);
			}
			// Pass 2a: enter children that have started, in start order. A
			// child captures the state *as of its own start time*, so every
			// child begun earlier is first advanced to that time, and children
			// that start together all begin before any of them writes (a group
			// of animations of one track must all capture the same value).
			entering.length = 0;
			for (let k = Math.min(startedBefore, startedNow); k < startedNow; k++) {
				const i = order[k] ?? 0;
				if (status[i] === PENDING) entering.push(i);
			}
			let next = 0;
			while (next < entering.length) {
				const at = startOf(entering[next] ?? 0);
				const batchStart = next;
				while (
					next < entering.length &&
					startOf(entering[next] ?? 0) - at <= EPSILON
				) {
					next++;
				}
				// Advance every active child that started before `at`, in list order.
				// A DONE child already left its end state; rewriting it would let an
				// earlier sibling clobber a later one that wrote the same track
				// (a nested composite skips its own DONE children), so it drops out.
				let kept = 0;
				for (const j of live) {
					const child = children[j];
					if (!child) continue;
					if (child.start >= at - EPSILON) {
						live[kept++] = j;
						continue;
					}
					const local = at - child.start;
					const length = child.animation.duration;
					const finished = local >= length - EPSILON;
					child.animation.seek(finished ? length : local);
					status[j] = finished ? DONE : ACTIVE;
					if (!finished) live[kept++] = j;
				}
				live.length = kept;
				for (let k = batchStart; k < next; k++) {
					const i = entering[k] ?? 0;
					if (!captured[i]) {
						children[i]?.animation.begin?.();
						captured[i] = true;
					}
					status[i] = ACTIVE;
				}
				// Merge the batch (sorted by index) into `live`, keeping list order.
				const batch = entering.slice(batchStart, next).sort((x, y) => x - y);
				merged.length = 0;
				let a = 0;
				let b = 0;
				while (a < live.length || b < batch.length) {
					const fromLive =
						b >= batch.length ||
						(a < live.length && (live[a] ?? 0) < (batch[b] ?? 0));
					merged.push((fromLive ? live[a++] : batch[b++]) ?? 0);
				}
				[live, merged] = [merged, live];
			}
			// Reopened children join the walk below, in list order.
			for (const i of crossed) insertSorted(live, i);
			// Pass 2b, first to last: finish or advance everything that has
			// started and is not already finished (a finished child that stays
			// finished needs no write).
			let kept = 0;
			for (const i of live) {
				const child = children[i];
				if (!child) continue;
				const local = now - child.start;
				const length = child.animation.duration;
				if (local >= length - EPSILON) {
					if (status[i] !== DONE) {
						child.animation.seek(length);
						status[i] = DONE;
					}
				} else {
					child.animation.seek(Math.max(0, local));
					status[i] = ACTIVE;
					live[kept++] = i;
				}
			}
			live.length = kept;
			last = now;
		},
		abort() {
			for (const i of live) {
				if (status[i] === ACTIVE) children[i]?.animation.abort?.();
			}
		},
	};
}

/**
 * Where each cycle of a `repeat`/`forever` takes its start values from.
 *
 * - `"continue"`: from wherever the previous cycle left the tracks (the
 *   default). Relative animations accumulate.
 * - `"fixed"`: from one capture taken when the repeat is first entered; every
 *   cycle restarts from it. Scrubbing is exact in both directions.
 *
 * @category Animation composition & timelines
 */
export type CycleStart = "continue" | "fixed";

/** Most whole cycles one seek will replay to bring relative animations up to date. */
const MAX_REPLAYED_CYCLES = 1000;

/**
 * Plays `inner` `times` times; the engine behind `repeat` and `forever`.
 *
 * Each cycle re-enters `inner`, so it captures its start values afresh from
 * wherever the previous cycle left the tracks (a `forever` of
 * `sequence(valueTo(a, 2), valueTo(a, 0))` loops without a jump, and a
 * repeated relative move accumulates). A seek that jumps over cycles finishes
 * each skipped cycle in turn so those captures are right (at most
 * {@link MAX_REPLAYED_CYCLES} are replayed; older ones are skipped).
 *
 * Scrubbing *backwards* across a cycle boundary re-samples the earlier cycle
 * with the start values captured for the most recent cycle, because the
 * earlier capture is gone: exact for absolute animations, an offset for
 * relative ones that accumulate.
 *
 * With `start: "fixed"` the animation is entered once and every cycle replays
 * from that one capture (each new cycle first restores the start state, it
 * does not recapture). Relative animations then repeat the same move instead
 * of accumulating, and because no cycle depends on a previous one, a seek
 * anywhere, in either direction, is exact.
 */
export function cycles(
	inner: Animation,
	times: number,
	start: CycleStart = "continue",
): Animation {
	const count = Number.isNaN(times) ? 0 : Math.max(0, times);
	const length = inner.duration;
	const duration = length === 0 || count === 0 ? 0 : count * length;
	// Whether `inner` has been entered, and which cycle its captures belong to.
	let armed = false;
	let held = 0;

	// An endless loop is not played under reduced motion; a finite repeat rests
	// at the end of its last cycle like any other animation.
	const restAt = Number.isFinite(duration) ? duration : 0;

	return {
		duration,
		restAt,
		begin() {
			armed = false;
		},
		restore() {
			if (!armed) return;
			if (inner.restore) inner.restore();
			else {
				// No restore hook: rewind and re-arm on re-entry.
				inner.seek(0);
				armed = false;
			}
		},
		seek(t) {
			if (count === 0) return;
			if (!armed) {
				armed = true;
				held = 0;
				inner.begin?.();
			}
			if (length === 0) {
				inner.seek(0);
				return;
			}
			const now = sampleTime(t, duration, restAt);
			if (!Number.isFinite(length)) {
				inner.seek(now);
				return;
			}
			let cycle = Math.floor((now + EPSILON) / length);
			let local = now - cycle * length;
			// So many cycles that the count overflows: nothing meaningful to land on.
			if (!Number.isFinite(cycle)) {
				cycle = 0;
				local = 0;
			}
			if (now >= duration - EPSILON && Number.isFinite(duration)) {
				// The last cycle ends where the run does, which for a fractional
				// `count` is part-way through it; only a whole cycle lands on `length`.
				cycle = Math.ceil(count) - 1;
				local = duration - cycle * length;
				if (Math.abs(local - length) <= EPSILON) local = length;
			}
			if (start === "fixed") {
				// One capture serves every cycle: sampling the local time is all it takes.
				inner.seek(clamp(local, 0, length));
				return;
			}
			if (cycle > held) {
				// Counted, not compared: past 2^53 cycles `held++` stops advancing.
				const skipped = Math.min(cycle - held, MAX_REPLAYED_CYCLES);
				for (let n = 0; n < skipped; n++) {
					inner.seek(length);
					inner.begin?.();
				}
			}
			held = cycle;
			inner.seek(clamp(local, 0, length));
		},
		abort() {
			if (armed) inner.abort?.();
		},
	};
}
