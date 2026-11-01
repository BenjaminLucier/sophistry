import { describe, expect, it } from "vitest";
import { ecdfSteps } from "./ecdf.js";

describe("ecdfSteps", () => {
	it("builds a non-decreasing step function ending at exactly 1 for distinct values", () => {
		const { edges, values } = ecdfSteps([3, 1, 4, 1, 5, 9, 2, 6]);
		// distinct values here: 1,2,3,4,5,6,9 (1 repeats, so k = 7)
		expect(edges.length).toBe(values.length + 1);
		for (let i = 1; i < values.length; i++) {
			expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
		}
		expect(values[values.length - 1]).toBe(1);
	});

	it("collapses repeated values into one step reflecting the repeat count", () => {
		const { edges, values } = ecdfSteps([1, 1, 1, 2, 3]);
		// unique values: 1, 2, 3 -> k = 3, edges length k + 2
		expect(edges.length).toBe(5);
		expect(values.length).toBe(4);
		// leading pad is 0, then F(1) = 3/5, F(2) = 4/5, F(3) = 5/5
		expect(values[0]).toBe(0);
		expect(values[1]).toBeCloseTo(3 / 5);
		expect(values[2]).toBeCloseTo(4 / 5);
		expect(values[3]).toBe(1);
	});

	it("handles a single unique value as the degenerate 3-edge/2-value case", () => {
		const { edges, values } = ecdfSteps([7, 7, 7]);
		expect(edges).toEqual([6.5, 7, 7.5]);
		expect(values).toEqual([0, 1]);
	});

	it("returns empty steps for empty input", () => {
		expect(ecdfSteps([])).toEqual({ edges: [], values: [] });
	});

	it("drops non-finite values", () => {
		const { values } = ecdfSteps([
			1,
			Number.NaN,
			2,
			Number.POSITIVE_INFINITY,
			3,
		]);
		// only 1, 2, 3 are finite -> total = 3, k = 3
		expect(values[values.length - 1]).toBe(1);
		expect(values.length).toBe(4);
	});

	it("respects an explicit pad override", () => {
		const { edges } = ecdfSteps([1, 2, 3], { pad: 10 });
		expect(edges[0]).toBe(1 - 10);
		expect(edges[edges.length - 1]).toBe(3 + 10);
	});

	it("falls back to a fixed pad for all-identical data instead of a zero-width edge", () => {
		const { edges } = ecdfSteps([4, 4, 4, 4]);
		expect(edges[0]).not.toBe(edges[1]);
		expect(edges[edges.length - 1] - edges[0]).toBeCloseTo(1); // 0.5 pad on each side
	});

	it("is 0 across the leading pad, before the smallest observation", () => {
		const { edges, values } = ecdfSteps([2, 4]);
		expect(edges[1]).toBe(2);
		expect(values[0]).toBe(0);
		expect(values[1]).toBe(0.5);
	});
});
