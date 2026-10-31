/**
 * Small helpers the chart components share: value equality for memo
 * boundaries, point mixing, bisection. Internal; not exported from the
 * package entry.
 */

import type { Point } from "@sophistry/core/geometry";

/**
 * Whether two values are equal one level deep: the same value, or arrays
 * (or plain objects) whose members are identical (`Object.is`).
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	)
		return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
		return true;
	}
	if (Array.isArray(b)) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (
			!Object.is(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
			)
		)
			return false;
	}
	return true;
}

/**
 * Whether two values are equal by structure (arrays, plain objects,
 * primitives; functions and class instances by identity). For reports and
 * other small configuration values, never for large data.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	)
		return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
		return true;
	}
	if (Array.isArray(b)) return false;
	const aProto = Object.getPrototypeOf(a);
	if (aProto !== Object.prototype && aProto !== null) return false;
	if (Object.getPrototypeOf(b) !== aProto) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (
			!deepEqual(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
			)
		)
			return false;
	}
	return true;
}

/** `a + (b − a)·t`. */
export function mix(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** Two points mixed by `t`. */
export function mixPoint(a: Point, b: Point, t: number): Point {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The first index of sorted `values` whose value is `>= target`. */
export function lowerBound(values: readonly number[], target: number): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((values[mid] as number) < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * A last-value cache by equality: returns the previous value while
 * `equals(previous, next)` holds, so identity-keyed caches downstream hit.
 */
export function stableValue<T>(
	equals: (a: T, b: T) => boolean = shallowEqual,
): (next: T) => T {
	let last: { value: T } | null = null;
	return (next) => {
		if (last && equals(last.value, next)) return last.value;
		last = { value: next };
		return next;
	};
}

/**
 * A last-input cache over a dependency list: `make()` runs only when `deps`
 * differ (shallowly) from the last call's, else the last result is returned.
 */
export function keyedMemo<T>(): (deps: readonly unknown[], make: () => T) => T {
	let last: { deps: readonly unknown[]; value: T } | null = null;
	return (deps, make) => {
		if (last && shallowEqual(last.deps, deps)) return last.value;
		const value = make();
		last = { deps, value };
		return value;
	};
}
