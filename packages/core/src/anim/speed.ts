/**
 * `changeSpeed` — Manim's `ChangeSpeed`: one animation played faster or
 * slower than written, uniformly or with the speed varying through it.
 *
 * A wrapper, not a new kind of leaf: it owns a different duration and maps
 * its own time onto the inner animation's before seeking it, and passes
 * `begin`, `restore` and `abort` straight through, so every seek rule the
 * inner animation follows (restore order, the first-entry capture) still
 * holds. Only time changes.
 */

import type { Animation } from "./animation.js";
import { restTime, sampleTime } from "./animation.js";

/**
 * How fast to play: one factor for the whole animation, or speeds at points
 * through it.
 *
 * As a record, each key is a place in the animation (0..1, a share of its
 * written length) and each value the speed there (2 is twice as fast). The
 * speed changes linearly between keys. A key 0 or 1 left out counts as
 * speed 1, as in Manim. Speeds must be positive;
 * anything below 0.001 is taken as 0.001.
 *
 * @category Animation composition & timelines
 */
export type SpeedSpec = number | Readonly<Record<number, number>>;

/** Slowest speed honoured: zero would make the animation endless. */
const MIN_SPEED = 1e-3;
/** Steps the speed profile is integrated in, per animation. */
const STEPS = 512;

/** The speed nodes sorted by place, with 0 and 1 filled in. */
function nodes(spec: Readonly<Record<number, number>>): [number, number][] {
	const entries = Object.entries(spec)
		.map(
			([at, speed]) =>
				[Number(at), Math.max(MIN_SPEED, speed)] as [number, number],
		)
		.filter(([at, speed]) => at >= 0 && at <= 1 && Number.isFinite(speed))
		.sort((a, b) => a[0] - b[0]);
	if (entries[0]?.[0] !== 0) entries.unshift([0, 1]);
	if (entries[entries.length - 1][0] !== 1) entries.push([1, 1]);
	return entries;
}

/**
 * Plays `animation` at a different speed: Manim's `ChangeSpeed`.
 *
 * A number scales the whole animation (`changeSpeed(a, 2)` takes half as
 * long). A record varies the speed through it: `{ 0.4: 1, 0.5: 0.2, 0.6: 1 }`
 * slows to a fifth of the speed around the middle and recovers, for a
 * moment of emphasis inside one move. The new duration is however long the
 * profile takes, and the animation still ends exactly where it would have;
 * it just gets there on a different schedule. Works on composites as well
 * as leaves, and a constant factor works on an endless `forever` too (a
 * varying one needs a finite length to place its keys in).
 *
 * @param animation - The animation to retime.
 * @param speed - A factor, or speeds at places through it; see {@link SpeedSpec}.
 * @returns An {@link Animation} with the new duration.
 * @throws If a varying speed is given for an endless animation.
 * @category Animation composition & timelines
 */
export function changeSpeed(animation: Animation, speed: SpeedSpec): Animation {
	const inner = animation.duration;
	const innerRest = restTime(animation);

	// `outer(s)` is how long the new animation takes to reach inner time `s`;
	// `toInner(t)` is the inverse, what a seek needs.
	let outerDuration: number;
	let toInner: (t: number) => number;
	let toOuter: (s: number) => number;

	if (typeof speed === "number") {
		const factor = Number.isFinite(speed) ? Math.max(MIN_SPEED, speed) : 1;
		outerDuration = inner / factor;
		toInner = (t) => t * factor;
		toOuter = (s) => s / factor;
	} else {
		if (!Number.isFinite(inner))
			throw new RangeError(
				"changeSpeed: a varying speed needs an animation with a finite duration",
			);
		const profile = nodes(speed);
		// Outer time at each of STEPS + 1 evenly spaced inner times, so the
		// inverse is a lookup and a lerp. Each entry is exact: between nodes
		// the speed is linear, and ∫ du / (a + b·u) has a closed form.
		const outerAt = (u: number) => {
			let total = 0;
			for (let i = 1; i < profile.length; i++) {
				const [a, va] = profile[i - 1];
				const [b, vb] = profile[i];
				if (u <= a) break;
				const end = Math.min(u, b);
				const vEnd = b > a ? va + ((vb - va) * (end - a)) / (b - a) : vb;
				const width = end - a;
				total +=
					Math.abs(vEnd - va) < 1e-12
						? width / va
						: (width * Math.log(vEnd / va)) / (vEnd - va);
			}
			return total * inner;
		};
		const table = new Float64Array(STEPS + 1);
		for (let i = 1; i <= STEPS; i++) table[i] = outerAt(i / STEPS);
		const ds = inner / STEPS;
		outerDuration = table[STEPS];
		toOuter = (s) =>
			inner > 0 ? outerAt(Math.min(1, Math.max(0, s / inner))) : 0;
		toInner = (t) => {
			if (!(outerDuration > 0)) return t > 0 ? inner : 0;
			let lo = 0;
			let hi = STEPS;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (table[mid] <= t) lo = mid;
				else hi = mid;
			}
			const span = table[hi] - table[lo];
			const k = span > 0 ? (t - table[lo]) / span : 0;
			return Math.min(inner, (lo + Math.min(1, Math.max(0, k))) * ds);
		};
	}

	const restAt = Number.isFinite(innerRest) ? toOuter(innerRest) : undefined;
	return {
		duration: outerDuration,
		restAt,
		begin: animation.begin ? () => animation.begin?.() : undefined,
		seek(t) {
			const local = sampleTime(t, outerDuration, restAt ?? 0);
			// The end maps to the end exactly, whatever the table's rounding.
			animation.seek(local >= outerDuration ? inner : toInner(local));
		},
		restore: animation.restore ? () => animation.restore?.() : undefined,
		abort: animation.abort ? () => animation.abort?.() : undefined,
	};
}
