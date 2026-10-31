/**
 * Time as an encoding: where a keyed series of keyframes stands between
 * them, the trail it leaves behind, and the ranks of a bar chart race. Every
 * function reads only the moment it is asked about, so playback scrubs.
 */

import type { BandKey, Point } from "@sophistry/core/geometry";

/**
 * Where a moment falls among keyframe times.
 *
 * @category Math & helpers
 */
export interface KeyframeSpan {
	/** Index of the keyframe at or before the moment. */
	lo: number;
	/** Index of the keyframe after it (`lo` itself on a keyframe). */
	hi: number;
	/** How far from `lo` to `hi`, 0..1. */
	u: number;
}

/**
 * The keyframes either side of `at` and the linear blend between them.
 *
 * @param times - Keyframe times, ascending.
 * @returns The span, or undefined when `at` is outside the keyframes.
 * @category Math & helpers
 */
export function keyframeAt(
	times: readonly number[],
	at: number,
): KeyframeSpan | undefined {
	const n = times.length;
	if (n === 0 || !(at >= times[0]) || !(at <= times[n - 1])) return undefined;
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= at) lo = mid;
		else hi = mid;
	}
	if (times[hi] <= at) return { lo: hi, hi, u: 0 };
	if (times[lo] === at || hi === lo) return { lo, hi: lo, u: 0 };
	return { lo, hi, u: (at - times[lo]) / (times[hi] - times[lo]) };
}

/**
 * The path a keyed mark has travelled from `at - length` to `at`, both ends
 * interpolated, in time order.
 *
 * @param times - Keyframe times, ascending, parallel to `points`.
 * @param length - How much time the trail spans. Defaults to all of it.
 * @returns The trail, or `[]` before the first keyframe.
 * @category Math & helpers
 */
export function trailPolyline(
	points: readonly Point[],
	times: readonly number[],
	at: number,
	length = Number.POSITIVE_INFINITY,
): Point[] {
	const n = Math.min(points.length, times.length);
	if (n === 0 || !(at >= times[0])) return [];
	const end = Math.min(at, times[n - 1]);
	const start = Math.max(times[0], end - Math.max(0, length));
	const pointAt = (moment: number): Point => {
		const span = keyframeAt(times.slice(0, n), moment);
		if (!span) return points[moment < times[0] ? 0 : n - 1];
		const a = points[span.lo];
		const b = points[span.hi];
		return { x: a.x + (b.x - a.x) * span.u, y: a.y + (b.y - a.y) * span.u };
	};
	const out: Point[] = [pointAt(start)];
	for (let i = 0; i < n; i++) {
		if (times[i] > start && times[i] < end) out.push(points[i]);
	}
	if (end > start) out.push(pointAt(end));
	return out;
}

/**
 * One entry of a bar chart race at a moment. See {@link raceTimeline}.
 *
 * @category Math & helpers
 */
export interface RaceEntry {
	/** The entry's key. */
	key: BandKey;
	/** Its value, interpolated linearly between keyframes. */
	value: number;
	/** Its rank by that value, 0 for the first place. */
	rank: number;
	/** Where it is drawn, in ranks: `rank` at rest, sliding on the swap's ease after a change. */
	position: number;
	/**
	 * How present it is, 0..1: 1 within the `top` slots, fading to 0 as it
	 * slides past the last one. Always 1 without a `top`.
	 */
	presence: number;
}

/**
 * A race at one moment, laid out for a band axis of `top` slots. See
 * {@link RaceTimeline.view}.
 *
 * @category Math & helpers
 */
export interface RaceView {
	/** The entries still present (`presence > 0`), in key order. */
	entries: RaceEntry[];
	/**
	 * The axis's categories: the `top` entries drawn nearest first place (all
	 * without a `top`), in key order. An entry sliding past the last slot is
	 * drawn past the axis's end (cut by `<Chart clip>`).
	 */
	categories: BandKey[];
	/** Each entry's slot: its `position`, for a band axis's `slot` option. */
	slot: (key: BandKey) => number | undefined;
}

/**
 * Options for {@link raceTimeline}.
 *
 * @category Math & helpers
 */
export interface RaceOptions {
	/**
	 * How long a rank swap takes, in the keyframes' time units; 0 swaps at once. Defaults to a
	 * quarter of the shortest gap between keyframes.
	 */
	swap?: number;
	/** `"descending"` puts the largest value first. @default "descending" */
	order?: "descending" | "ascending";
	/**
	 * How many places are shown: entries ranked past it fade as they slide
	 * below the last place. Defaults to every entry.
	 */
	top?: number;
}

/**
 * A bar chart race, precomputed: ask it for any moment.
 *
 * @category Math & helpers
 */
export interface RaceTimeline {
	/** The keys, in the order given. */
	readonly keys: readonly BandKey[];
	/** The keyframe times, ascending. */
	readonly times: readonly number[];
	/** How many places are shown (`top`), or undefined for all. */
	readonly top: number | undefined;
	/** Every entry at `time`, in key order. */
	at(time: number): RaceEntry[];
	/**
	 * The race at `time` laid out for a band axis. Pass `categories` and `slot`
	 * to `<Chart yAxis>` (with `clip`) and draw `entries`.
	 */
	view(time: number): RaceView;
}

/** One key's rank changing by `delta` at `time`. */
interface RankStep {
	time: number;
	key: number;
	delta: number;
}

/** Cubic in-out, the `"smooth"` easing. */
function smooth(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * A bar chart race over keyframes: values interpolate linearly, ranks come
 * from the interpolated values (so bars swap exactly when values cross), and
 * each swap slides on its own short ease (`swap`). A pure function of time,
 * so it scrubs.
 *
 * @param keys - One key per entry.
 * @param times - Keyframe times, ascending.
 * @param values - `values[k][e]`: entry `e`'s value at keyframe `k`; non-finite counts as 0.
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Math & helpers
 */
export function raceTimeline(
	keys: readonly BandKey[],
	times: readonly number[],
	values: readonly (readonly number[])[],
	options: RaceOptions = {},
): RaceTimeline {
	const n = keys.length;
	const sign = options.order === "ascending" ? -1 : 1;
	const frames = times.map((_, k) =>
		keys.map((_, e) => {
			const v = values[k]?.[e];
			return Number.isFinite(v) ? (v as number) : 0;
		}),
	);
	let gap = Number.POSITIVE_INFINITY;
	for (let k = 1; k < times.length; k++)
		gap = Math.min(gap, times[k] - times[k - 1]);
	const swap = Math.max(
		0,
		options.swap ?? (Number.isFinite(gap) ? gap / 4 : 0),
	);

	const valuesAt = (time: number): number[] => {
		const span = keyframeAt(times, time);
		if (!span) {
			const edge = time < times[0] ? 0 : times.length - 1;
			return frames[edge] ?? keys.map(() => 0);
		}
		const a = frames[span.lo];
		const b = frames[span.hi];
		return a.map((v, e) => v + (b[e] - v) * span.u);
	};
	/** Each entry's rank: larger first (descending), ties by key order. */
	const ranksOf = (vs: readonly number[]): number[] => {
		const order = vs
			.map((_, e) => e)
			.sort((a, b) => sign * (vs[b] - vs[a]) || a - b);
		const rank: number[] = [];
		order.forEach((e, r) => {
			rank[e] = r;
		});
		return rank;
	};

	// Breakpoints: the keyframes and every crossing between them. Ranks are
	// constant between consecutive breakpoints; a change at a breakpoint is
	// a step there.
	const breaks: number[] = [];
	for (let k = 0; k < times.length; k++) {
		breaks.push(times[k]);
		if (k + 1 >= times.length) continue;
		const t0 = times[k];
		const t1 = times[k + 1];
		const a = frames[k];
		const b = frames[k + 1];
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const d0 = a[i] - a[j];
				const d1 = b[i] - b[j];
				if (d0 === d1 || Math.sign(d0) === Math.sign(d1)) continue;
				const s = d0 / (d0 - d1);
				if (s > 0 && s < 1) breaks.push(t0 + (t1 - t0) * s);
			}
		}
	}
	breaks.sort((x, y) => x - y);
	const steps: RankStep[] = [];
	let initial: number[] = ranksOf(valuesAt(times[0] ?? 0));
	if (breaks.length > 1) {
		const mid = (i: number) => (breaks[i] + breaks[i + 1]) / 2;
		initial = ranksOf(valuesAt(mid(0)));
		let previous = initial;
		for (let i = 1; i + 1 < breaks.length; i++) {
			if (!(breaks[i + 1] > breaks[i])) continue;
			const next = ranksOf(valuesAt(mid(i)));
			for (let e = 0; e < n; e++) {
				if (next[e] !== previous[e])
					steps.push({ time: breaks[i], key: e, delta: next[e] - previous[e] });
			}
			previous = next;
		}
	}

	const top =
		options.top !== undefined && Number.isFinite(options.top)
			? Math.max(0, Math.floor(options.top))
			: undefined;
	/** 1 within the top, fading over the slot past the last one. */
	const presenceAt = (position: number) =>
		top === undefined ? 1 : Math.max(0, Math.min(1, top - position));
	const at = (time: number): RaceEntry[] => {
		const vs = valuesAt(time);
		const rank = ranksOf(vs);
		const position = [...initial];
		for (const step of steps) {
			if (step.time > time) break;
			const f = swap > 0 ? Math.min(1, (time - step.time) / swap) : 1;
			position[step.key] += step.delta * smooth(f);
		}
		return keys.map((key, e) => ({
			key,
			value: vs[e],
			rank: rank[e],
			position: position[e],
			presence: presenceAt(position[e]),
		}));
	};

	return {
		keys,
		times,
		top,
		at,
		view(time) {
			const all = at(time);
			const slots = new Map<BandKey, number>();
			for (const entry of all) slots.set(entry.key, entry.position);
			// The `top` entries drawn nearest first place, back in key order
			// (ties by key order, so the set changes only where two pass).
			const nearest = new Set(
				all
					.map((entry, e) => ({ entry, e }))
					.sort((a, b) => a.entry.position - b.entry.position || a.e - b.e)
					.slice(0, top ?? all.length)
					.map(({ entry }) => entry.key),
			);
			return {
				entries: all.filter((entry) => entry.presence > 0),
				categories: keys.filter((key) => nearest.has(key)),
				slot: (key) => slots.get(key),
			};
		},
	};
}
