/**
 * Reducers and per-series maps: the arithmetic behind the `group`, `bin`,
 * `rolling` and `normalize` transforms. Arrays of numbers in, numbers out.
 */

import { finiteValues } from "@sophistry/core/internal";
import { deviation, max, mean, median, min, sum, variance } from "d3-array";

/**
 * How a set of values becomes one number. Every reducer but `"count"` (which
 * counts rows) drops non-finite values first. An empty set reduces to `NaN`
 * (0 for `"count"` and `"sum"`).
 *
 * @category Math & helpers
 */
export type ReducerName =
	| "count"
	| "sum"
	| "mean"
	| "median"
	| "min"
	| "max"
	| "first"
	| "last"
	| "deviation"
	| "variance";

/**
 * A named reducer, or your own function of the values.
 *
 * @category Math & helpers
 */
export type Reducer = ReducerName | ((values: number[]) => number);

/**
 * Reduces `values` to one number; see {@link ReducerName}.
 *
 * @category Math & helpers
 */
export function reduceValues(
	values: readonly number[],
	reducer: Reducer,
): number {
	if (typeof reducer === "function") return reducer([...values]);
	if (reducer === "count") return values.length;
	const finite = finiteValues(values);
	if (reducer === "sum") return sum(finite);
	if (finite.length === 0) return Number.NaN;
	switch (reducer) {
		case "mean":
			return mean(finite) ?? Number.NaN;
		case "median":
			return median(finite) ?? Number.NaN;
		case "min":
			return min(finite) ?? Number.NaN;
		case "max":
			return max(finite) ?? Number.NaN;
		case "first":
			return finite[0];
		case "last":
			return finite[finite.length - 1];
		case "deviation":
			return deviation(finite) ?? Number.NaN;
		case "variance":
			return variance(finite) ?? Number.NaN;
	}
	return Number.NaN;
}

/** @category Math */
export interface RollingOptions {
	/** Window size, in values. @default 3 */
	k?: number;
	/**
	 * Where each value sits in its window: `"middle"` (centred), `"start"`
	 * (looking ahead) or `"end"` (trailing).
	 * @default "middle"
	 */
	anchor?: "start" | "middle" | "end";
	/** @default "mean" */
	reduce?: Reducer;
	/**
	 * Only reduce full windows of finite values (elsewhere `NaN`). Off, windows
	 * cut short or holding non-finite values reduce what they have.
	 * @default false
	 */
	strict?: boolean;
}

/**
 * A moving-window reduction of `values`, a rolling mean by default.
 *
 * @returns One value per input value.
 * @category Math & helpers
 */
export function rollingValues(
	values: readonly number[],
	options: RollingOptions = {},
): number[] {
	const k = Math.max(1, Math.floor(options.k ?? 3));
	const anchor = options.anchor ?? "middle";
	const reduce = options.reduce ?? "mean";
	const before =
		anchor === "start" ? 0 : anchor === "end" ? k - 1 : Math.floor((k - 1) / 2);
	return values.map((_, i) => {
		const from = i - before;
		const to = from + k;
		if (options.strict) {
			if (from < 0 || to > values.length) return Number.NaN;
			const span = values.slice(from, to);
			if (!span.every((v) => Number.isFinite(v))) return Number.NaN;
			return reduceValues(span, reduce);
		}
		const span = finiteValues(
			values.slice(Math.max(0, from), Math.min(values.length, to)),
		);
		return span.length === 0 ? Number.NaN : reduceValues(span, reduce);
	});
}

/**
 * What {@link normalizeValues} divides by: `"first"` (growth from the first
 * value), `"last"`, `"sum"`, `"mean"`, `"median"`, `"min"` or `"max"`;
 * `"extent"` rescales min..max to 0..1; `"deviation"` gives z-scores; a
 * number divides by itself.
 *
 * @category Math & helpers
 */
export type NormalizeBasis =
	| "first"
	| "last"
	| "sum"
	| "mean"
	| "median"
	| "min"
	| "max"
	| "extent"
	| "deviation"
	| number;

/**
 * Normalizes a series against a basis. Non-finite values, and every value
 * under a zero or non-finite basis, become `NaN`.
 *
 * @param basis - Defaults to `"first"`.
 * @returns One value per input value.
 * @category Math & helpers
 */
export function normalizeValues(
	values: readonly number[],
	basis: NormalizeBasis = "first",
): number[] {
	const finite = finiteValues(values);
	const each = (map: (v: number) => number) =>
		values.map((v) => (Number.isFinite(v) ? map(v) : Number.NaN));
	if (basis === "extent") {
		const lo = min(finite) ?? Number.NaN;
		const hi = max(finite) ?? Number.NaN;
		return each((v) => (hi > lo ? (v - lo) / (hi - lo) : Number.NaN));
	}
	if (basis === "deviation") {
		const m = mean(finite) ?? Number.NaN;
		const sd = deviation(finite) ?? Number.NaN;
		return each((v) => (sd > 0 ? (v - m) / sd : Number.NaN));
	}
	const by = typeof basis === "number" ? basis : reduceValues(finite, basis);
	return each((v) => (Number.isFinite(by) && by !== 0 ? v / by : Number.NaN));
}
