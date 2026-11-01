/**
 * Small numeric helpers shared across the package (unit clamping, endpoint-exact
 * `mix`, finite filtering and extents, even samples, angle wrapping, polar
 * points, `hashUnit`). Internal unless re-exported elsewhere.
 *
 * Mind the semantics: `mix` pins both ends, `lerp` only `t === 1`; `clamp01`
 * maps `NaN` to 0. `fieldJitter` (`./field`) and `hash01` (`color/random.ts`)
 * are separate hashes on purpose: their outputs are pinned by tests and
 * baselines.
 */

import { lerp } from "./lerp.js";
import type { Point } from "./path/types.js";

/** One full turn in radians, `2π`. */
export const TAU = Math.PI * 2;

/**
 * Clamps to `[0, 1]`, with `NaN` reading as 0 (unlike `clamp`, which passes
 * `NaN` through). `-0` also comes back as `0`.
 *
 * @param value - Any number.
 * @returns `value` restricted to 0..1; 0 for `NaN`.
 */
export function clamp01(value: number): number {
	return value > 0 ? (value < 1 ? value : 1) : 0;
}

/**
 * `a` blended toward `b` by `t`, exact at both ends: `a` itself for any
 * `t <= 0` and `b` itself for any `t >= 1` — so unlike `lerp` it neither
 * extrapolates nor drifts by rounding at either endpoint. The blend a
 * transition wants, where a finished (or not-yet-started) tween must land
 * exactly on its target. `NaN` `t` gives `NaN`.
 *
 * @param a - Value at `t <= 0`.
 * @param b - Value at `t >= 1`.
 * @param t - Blend factor.
 * @returns `a + (b - a) * t` inside 0..1, the nearer end outside it.
 */
export function mix(a: number, b: number, t: number): number {
	return t <= 0 ? a : t >= 1 ? b : a + (b - a) * t;
}

/**
 * Two points blended at `t`, each coordinate as {@link mix} blends it. At
 * `t <= 0` / `t >= 1` it returns `a` / `b` themselves (same object, not a
 * copy), so an identity check can tell a settled transition.
 *
 * @param a - Point at `t <= 0`.
 * @param b - Point at `t >= 1`.
 * @param t - Blend factor.
 * @returns A new point in between, or one of the inputs at an end.
 */
export function mixPoint(a: Point, b: Point, t: number): Point {
	return t <= 0 ? a : t >= 1 ? b : { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) };
}

/**
 * Whether `at` is a point with finite `x` and `y`. `undefined` (and `null`)
 * answer false, so a sparse sample lookup can be tested and narrowed in one
 * go.
 *
 * @param at - A point, or nothing.
 * @returns True when both coordinates are finite.
 */
export function isFinitePoint(
	at: { readonly x: number; readonly y: number } | undefined,
): at is Point {
	return !!at && Number.isFinite(at.x) && Number.isFinite(at.y);
}

/**
 * The value when finite, otherwise 0 — a missing or non-finite contribution
 * counts as nothing rather than poisoning a running total with `NaN`.
 * Negatives are kept.
 *
 * @param value - A number, or nothing.
 * @returns `value`, or 0 when it is `undefined`, `NaN` or `±Infinity`.
 */
export function finiteOrZero(value: number | undefined): number {
	return value !== undefined && Number.isFinite(value) ? value : 0;
}

/**
 * Largest of `values` (and `floor`, if given), via a loop rather than
 * `Math.max(...values)`, whose spread throws `RangeError` for ~100k+ elements.
 * Returns `-Infinity` for an empty array with no `floor`.
 *
 * @param values - The numbers to scan.
 * @param floor - A lower bound on the answer. Defaults to `-Infinity`.
 * @returns The maximum.
 */
export function maxOf(
	values: readonly number[],
	floor = Number.NEGATIVE_INFINITY,
): number {
	let result = floor;
	for (const v of values) if (v > result) result = v;
	return result;
}

/**
 * Smallest of `values`; the loop counterpart of `Math.min(...values)`.
 * `Infinity` when empty.
 *
 * @param values - The numbers to scan.
 * @returns The minimum.
 */
export function minOf(values: readonly number[]): number {
	let result = Number.POSITIVE_INFINITY;
	for (const v of values) if (v < result) result = v;
	return result;
}

/**
 * The first index in `sorted[from..to)` whose value is `>= value` (`to` when
 * none is): a binary search over an ascending array, NumPy's
 * `searchsorted(side="left")`. A `NaN` `value` answers `to`.
 *
 * @param sorted - Ascending numbers (a typed array works too).
 * @param value - The value to place.
 * @param from - First index searched. Defaults to 0.
 * @param to - One past the last index searched. Defaults to the length.
 * @returns The insertion index.
 */
export function lowerBound(
	sorted: ArrayLike<number>,
	value: number,
	from = 0,
	to = sorted.length,
): number {
	if (Number.isNaN(value)) return to;
	let lo = from;
	let hi = to;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (sorted[mid] < value) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Drops non-finite entries. The convention every sampling/statistics module
 * shares (`histogramBins`, `boxplotStats`, `violinRing`/`gaussianKde`,
 * `ecdfSteps`, `autoRange`): there's no meaningful bin/quantile/density for a
 * `NaN`, so it's dropped before the real work starts rather than special-cased
 * throughout.
 *
 * @param values - The numbers to filter.
 * @returns A new array of the finite ones, in order.
 */
export function finiteValues(values: readonly number[]): number[] {
	return values.filter((value) => Number.isFinite(value));
}

/**
 * Clamps a value to a non-negative finite number: `Number.isFinite(v) ?
 * Math.max(0, v) : 0`. Shared by every module where a value maps to
 * something that can't sensibly be negative — a pie/wedge/radar value, a
 * bubble radius input — so one bad entry degrades to "nothing to draw" for
 * that entry instead of throwing or poisoning a running total with `NaN`.
 *
 * @param value - Any number.
 * @returns `value` floored at 0; 0 when non-finite.
 */
export function clampNonNegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * The `[min, max]` of the finite entries of `values`, ignoring `NaN` and
 * `±Infinity`; `fallback` when there are none. A single finite value gives a
 * degenerate `[v, v]` — callers that divide by the span should guard it
 * (`span || 1`). Accepts any iterable, so a grid can be scanned with
 * `finiteExtent(rows.flat())`.
 *
 * @param values - The numbers to scan.
 * @param fallback - The extent when nothing is finite. Defaults to `[0, 1]`.
 * @returns A fresh `[min, max]` pair (or `fallback` itself).
 */
export function finiteExtent(
	values: Iterable<number>,
	fallback: [number, number] = [0, 1],
): [number, number] {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		if (!Number.isFinite(v)) continue;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return min <= max ? [min, max] : fallback;
}

/**
 * `count` evenly spaced values from `start` to `stop` inclusive, NumPy's
 * `linspace`: each is `lerp(start, stop, i / (count - 1))`, so the last is
 * exactly `stop`. One value is `[start]`; zero, negative or non-finite counts
 * give `[]`. Fractional counts are floored.
 *
 * @param start - First value.
 * @param stop - Last value.
 * @param count - How many values.
 * @returns The values, ascending from `start` toward `stop`.
 */
export function linspace(start: number, stop: number, count: number): number[] {
	const n = Number.isFinite(count) ? Math.floor(count) : 0;
	if (n <= 0) return [];
	if (n === 1) return [start];
	const out = new Array<number>(n);
	for (let i = 0; i < n; i++) out[i] = lerp(start, stop, i / (n - 1));
	return out;
}

/**
 * `angle` wrapped into `[0, TAU)` (radians). Rounding can land a tiny
 * negative angle on exactly `TAU`; non-finite input gives `NaN`.
 *
 * @param angle - Any angle, radians.
 * @returns The same direction as an angle in `[0, TAU)`.
 */
export function wrapAngle(angle: number): number {
	const v = angle % TAU;
	return v < 0 ? v + TAU : v;
}

/**
 * The point at `radius` from `(cx, cy)` in direction `theta` (radians from +x,
 * counter-clockwise with y up): exactly
 * `{ x: cx + radius * Math.cos(theta), y: cy + radius * Math.sin(theta) }`,
 * operand for operand, so it can replace that literal without moving a bit.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param radius - Distance from the centre.
 * @param theta - Direction, radians.
 * @returns A new point.
 */
export function polarPoint(
	cx: number,
	cy: number,
	radius: number,
	theta: number,
): Point {
	return { x: cx + radius * Math.cos(theta), y: cy + radius * Math.sin(theta) };
}

/**
 * A number in `[0, 1)` from `key` and `seed`, the same every time: a 32-bit
 * FNV-1a hash of the key's text, finished with a murmur3-style mix so nearby
 * keys (`"a1"`, `"a2"`, `0`, `1`) land far apart. Integer-only arithmetic, so
 * bit-identical on every engine.
 *
 * @param key - What to hash: a string or a number.
 * @param seed - Varies the whole sequence. Defaults to 0.
 * @returns A uniform-looking number in `[0, 1)`.
 *
 * @category Math & helpers
 */
export function hashUnit(key: string | number, seed = 0): number {
	const text = `${seed}\u0000${key}`;
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
