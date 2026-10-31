import {
	clampNonNegative,
	finiteValues,
	maxOf,
	minOf,
} from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";

describe("finiteValues", () => {
	it("drops NaN and ±Infinity", () => {
		expect(
			finiteValues([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3]),
		).toEqual([1, 2, 3]);
	});

	it("returns [] for [] and for all-non-finite input", () => {
		expect(finiteValues([])).toEqual([]);
		expect(finiteValues([Number.NaN, Number.NEGATIVE_INFINITY])).toEqual([]);
	});
});

describe("clampNonNegative", () => {
	it("passes through non-negative finite values", () => {
		expect(clampNonNegative(0)).toBe(0);
		expect(clampNonNegative(4.5)).toBe(4.5);
	});

	it("clamps negative values to 0", () => {
		expect(clampNonNegative(-3)).toBe(0);
	});

	it("clamps non-finite values to 0", () => {
		expect(clampNonNegative(Number.NaN)).toBe(0);
		expect(clampNonNegative(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe("maxOf / minOf", () => {
	it("handle arrays too large for spread", () => {
		const big = Array.from({ length: 500_000 }, (_, i) => i);
		expect(maxOf(big)).toBe(499_999);
		expect(minOf(big)).toBe(0);
		expect(maxOf(big, 1e9)).toBe(1e9);
	});
});
