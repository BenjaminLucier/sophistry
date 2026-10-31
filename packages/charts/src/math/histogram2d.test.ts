import { describe, expect, it } from "vitest";
import { histogram2d } from "./histogram2d";

function sum2d(counts: readonly (readonly number[])[]): number {
	return counts.reduce(
		(total, row) =>
			total + row.reduce((rowTotal, value) => rowTotal + value, 0),
		0,
	);
}

describe("histogram2d", () => {
	it("bins a small hand-checkable dataset into the right cells", () => {
		// xRange/yRange [0, 10], 2 bins each -> edges [0, 5, 10].
		// (0, 0) and (0, 0) and (1, 1) fall in cell (yi=0, xi=0);
		// (9, 9) falls in cell (yi=1, xi=1): floor(9 / 10 * 2) = 1.
		const xs = [0, 0, 1, 9];
		const ys = [0, 0, 1, 9];
		const { xEdges, yEdges, counts, maxCount } = histogram2d(xs, ys, {
			xBins: 2,
			yBins: 2,
			xRange: [0, 10],
			yRange: [0, 10],
		});
		expect(xEdges).toEqual([0, 5, 10]);
		expect(yEdges).toEqual([0, 5, 10]);
		expect(counts[0][0]).toBe(3);
		expect(counts[1][1]).toBe(1);
		expect(counts[0][1]).toBe(0);
		expect(counts[1][0]).toBe(0);
		expect(maxCount).toBe(3);
	});

	it("supports unequal xBins/yBins", () => {
		const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const ys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const { xEdges, yEdges, counts } = histogram2d(xs, ys, {
			xBins: 5,
			yBins: 2,
			xRange: [0, 10],
			yRange: [0, 10],
		});
		expect(xEdges).toHaveLength(6);
		expect(yEdges).toHaveLength(3);
		expect(counts).toHaveLength(2);
		for (const row of counts) expect(row).toHaveLength(5);
		expect(sum2d(counts)).toBe(10);
	});

	it("returns empty-ish bins for empty input", () => {
		const { xEdges, yEdges, counts, maxCount } = histogram2d([], [], {
			xBins: 4,
			yBins: 3,
		});
		expect(xEdges).toHaveLength(5);
		expect(yEdges).toHaveLength(4);
		expect(counts).toHaveLength(3);
		for (const row of counts) expect(row).toHaveLength(4);
		expect(sum2d(counts)).toBe(0);
		expect(maxCount).toBe(0);
	});

	it("drops a pair when x is finite but y is not", () => {
		const xs = [1, 2, 3];
		const ys = [1, Number.NaN, 3];
		const { counts } = histogram2d(xs, ys, {
			xBins: 4,
			yBins: 4,
			xRange: [0, 4],
			yRange: [0, 4],
		});
		expect(sum2d(counts)).toBe(2);
	});

	it("drops a pair when y is finite but x is not", () => {
		const xs = [1, Number.POSITIVE_INFINITY, 3];
		const ys = [1, 2, 3];
		const { counts } = histogram2d(xs, ys, {
			xBins: 4,
			yBins: 4,
			xRange: [0, 4],
			yRange: [0, 4],
		});
		expect(sum2d(counts)).toBe(2);
	});

	it("computes maxCount as the largest cell value", () => {
		const xs = [0, 0, 0, 5];
		const ys = [0, 0, 0, 5];
		const { counts, maxCount } = histogram2d(xs, ys, {
			xBins: 2,
			yBins: 2,
			xRange: [0, 10],
			yRange: [0, 10],
		});
		expect(maxCount).toBe(3);
		expect(Math.max(...counts.flat())).toBe(maxCount);
	});

	it("produces counts with exactly yBins rows of xBins columns", () => {
		const { counts } = histogram2d([1, 2, 3], [1, 2, 3], {
			xBins: 7,
			yBins: 4,
		});
		expect(counts).toHaveLength(4);
		for (const row of counts) expect(row).toHaveLength(7);
	});

	it("produces xEdges/yEdges of length xBins+1/yBins+1", () => {
		const { xEdges, yEdges } = histogram2d([1, 2, 3], [1, 2, 3], {
			xBins: 6,
			yBins: 9,
		});
		expect(xEdges).toHaveLength(7);
		expect(yEdges).toHaveLength(10);
	});
});

describe("histogram2d range step", () => {
	it("uses each range step as the bin width when the count is omitted", () => {
		const h = histogram2d([1, 3], [1, 7], {
			xRange: [0, 4, 2],
			yRange: [0, 8, 4],
		});
		expect(h.xEdges).toEqual([0, 2, 4]);
		expect(h.yEdges).toEqual([0, 4, 8]);
		expect(h.counts).toEqual([
			[1, 0],
			[0, 1],
		]);
	});

	it("lets explicit bin counts win over the step", () => {
		const h = histogram2d([1], [1], { xRange: [0, 4, 2], xBins: 4 });
		expect(h.xEdges).toHaveLength(5);
	});
});
