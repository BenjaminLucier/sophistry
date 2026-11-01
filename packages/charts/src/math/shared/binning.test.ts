import { describe, expect, it } from "vitest";
import { binEdges, binIndex, widenDegenerate } from "./binning.js";

describe("widenDegenerate", () => {
	it("passes through a real range", () => {
		expect(widenDegenerate(0, 10)).toEqual([0, 10]);
	});

	it("widens a degenerate range symmetrically by 0.5", () => {
		expect(widenDegenerate(5, 5)).toEqual([4.5, 5.5]);
	});
});

describe("binIndex", () => {
	it("floors into equal-width bins", () => {
		expect(binIndex(0, 0, 10, 2)).toBe(0);
		expect(binIndex(4.9, 0, 10, 2)).toBe(0);
		expect(binIndex(5, 0, 10, 2)).toBe(1);
	});

	it("clamps the maximum value into the last bin (right-inclusive)", () => {
		expect(binIndex(10, 0, 10, 5)).toBe(4);
	});

	it("clamps below min into the first bin", () => {
		expect(binIndex(-5, 0, 10, 4)).toBe(0);
	});
});

describe("binEdges", () => {
	it("produces n + 1 evenly spaced edges", () => {
		expect(binEdges(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
	});
});

describe("binIndex / binEdges agreement", () => {
	it("puts a value exactly on an inner edge in the upper bin", () => {
		const edges = binEdges(0, 100, 30);
		for (let i = 1; i < 30; i++) expect(binIndex(edges[i], 0, 100, 30)).toBe(i);
		expect(binIndex(edges[30], 0, 100, 30)).toBe(29);
	});

	it("handles -0.8 on a [-1, 1] range with 10 bins", () => {
		expect(binEdges(-1, 1, 10)[1]).toBe(-0.8);
		expect(binIndex(-0.8, -1, 1, 10)).toBe(1);
	});
});
