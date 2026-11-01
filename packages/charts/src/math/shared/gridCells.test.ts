import { describe, expect, it } from "vitest";
import { buildGridCells, gridNcols } from "./gridCells.js";

describe("gridNcols", () => {
	it("is the longest row", () => {
		expect(gridNcols([[1, 2, 3], [1], [1, 2]])).toBe(3);
	});

	it("is 0 for an empty grid", () => {
		expect(gridNcols([])).toBe(0);
	});
});

describe("buildGridCells", () => {
	const unitRect = (row: number, col: number) => ({
		x0: col,
		x1: col + 1,
		y0: row,
		y1: row + 1,
	});

	it("builds one cell per entry, ragged rows tolerated", () => {
		const { cells } = buildGridCells([[1, 2, 3], [4]], unitRect);
		expect(cells).toHaveLength(4);
		expect(cells[3]).toEqual({
			row: 1,
			column: 0,
			x0: 0,
			x1: 1,
			y0: 1,
			y1: 2,
			value: 4,
		});
	});

	it("computes min/max over finite values only", () => {
		const { min, max } = buildGridCells([[1, Number.NaN, 5]], unitRect);
		expect(min).toBe(1);
		expect(max).toBe(5);
	});

	it("falls back to [0, 1] when there are no finite values", () => {
		const { min, max } = buildGridCells([[Number.NaN]], unitRect);
		expect(min).toBe(0);
		expect(max).toBe(1);
	});

	it("falls back to [0, 1] for an empty grid", () => {
		const { cells, min, max } = buildGridCells([], unitRect);
		expect(cells).toEqual([]);
		expect(min).toBe(0);
		expect(max).toBe(1);
	});
});
