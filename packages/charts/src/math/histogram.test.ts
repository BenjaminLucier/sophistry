import { describe, expect, it } from "vitest";
import { histogramBins } from "./histogram.js";

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

describe("histogramBins", () => {
	it("bins simple data into even bin counts", () => {
		const { edges, counts } = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], {
			binCount: 5,
		});
		expect(edges).toHaveLength(6);
		expect(edges[0]).toBeCloseTo(0);
		expect(edges[5]).toBeCloseTo(9);
		expect(counts).toHaveLength(5);
		expect(sum(counts)).toBe(10);
	});

	it("returns empty-ish bins for empty input", () => {
		const { edges, counts } = histogramBins([], { binCount: 4 });
		expect(edges).toHaveLength(5);
		expect(counts).toHaveLength(4);
		expect(sum(counts)).toBe(0);
	});

	it("widens a degenerate range when every value is identical", () => {
		const { edges, counts } = histogramBins([5, 5, 5, 5], { binCount: 4 });
		expect(edges[0]).toBeLessThan(5);
		expect(edges[edges.length - 1]).toBeGreaterThan(5);
		expect(sum(counts)).toBe(4);
	});

	it("drops non-finite values", () => {
		const { counts } = histogramBins(
			[1, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 3],
			{ binCount: 3 },
		);
		expect(sum(counts)).toBe(3);
	});

	it("puts a value exactly on an interior bin boundary into the upper bin", () => {
		// Range [0, 10], binCount 2 -> edges [0, 5, 10]. 5 is the boundary between
		// bin 0 ([0, 5)) and bin 1 ([5, 10]); floor((5 - 0) / 10 * 2) = 1.
		const { counts } = histogramBins([0, 5, 10], {
			binCount: 2,
			range: [0, 10],
		});
		expect(counts).toEqual([1, 2]);
	});

	it("puts the maximum value in the last bin (right-inclusive last bin)", () => {
		const { counts } = histogramBins([0, 10], { binCount: 5, range: [0, 10] });
		expect(counts[4]).toBe(1);
		expect(sum(counts)).toBe(2);
	});

	it("counts always sum to the number of finite values", () => {
		const values = [1, 2, 3, 4, Number.NaN, 5, 6, 7, 8, 9, 10];
		const { counts } = histogramBins(values, { binCount: 7 });
		const finiteCount = values.filter((v) => Number.isFinite(v)).length;
		expect(sum(counts)).toBe(finiteCount);
	});
});

describe("histogramBins edge values", () => {
	it("counts a value on an edge in the upper bin", () => {
		const { counts, edges } = histogramBins([-0.8], {
			range: [-1, 1],
			binCount: 10,
		});
		expect(edges[1]).toBe(-0.8);
		expect(counts[0]).toBe(0);
		expect(counts[1]).toBe(1);
	});
});

describe("histogramBins range step", () => {
	it("uses the step as the bin width when binCount is omitted", () => {
		const { edges, counts } = histogramBins([1, 3, 5, 9], {
			range: [0, 10, 2],
		});
		expect(edges).toEqual([0, 2, 4, 6, 8, 10]);
		expect(counts).toEqual([1, 1, 1, 0, 1]);
	});

	it("rounds a non-dividing step up to a whole last bin", () => {
		const { edges } = histogramBins([1], { range: [0, 5, 2] });
		expect(edges).toEqual([0, 2, 4, 6]);
	});

	it("lets an explicit binCount win over the step", () => {
		const { edges } = histogramBins([1], { range: [0, 10, 2], binCount: 2 });
		expect(edges).toEqual([0, 5, 10]);
	});
});
