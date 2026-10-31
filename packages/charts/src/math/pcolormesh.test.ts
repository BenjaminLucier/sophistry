import { describe, expect, it } from "vitest";
import { pcolormeshCells } from "./pcolormesh";

describe("pcolormeshCells", () => {
	it("uses edge arrays directly when given ncols+1/nrows+1 coordinates", () => {
		// X has 3 edges -> 2 columns; Y has 2 edges -> 1 row.
		const X = [0, 10, 30];
		const Y = [0, 5];
		const Z = [[1, 2]];
		const { cells, nrows, ncols, min, max } = pcolormeshCells(X, Y, Z);
		expect(nrows).toBe(1);
		expect(ncols).toBe(2);
		expect(cells).toEqual([
			{ row: 0, column: 0, x0: 0, x1: 10, y0: 0, y1: 5, value: 1 },
			{ row: 0, column: 1, x0: 10, x1: 30, y0: 0, y1: 5, value: 2 },
		]);
		expect(min).toBe(1);
		expect(max).toBe(2);
	});

	it("infers edges from center coordinates as midpoints, extrapolating the boundaries", () => {
		// Centers [1, 2, 4] -> interior edges at 1.5 and 3; boundary edges
		// extrapolated by the neighbouring gap: 1 - (2-1)/2 = 0.5, and
		// 4 + (4-2)/2 = 5.
		const X = [1, 2, 4];
		const Y = [0]; // single row center -> widened by 0.5 either side
		const Z = [[10, 20, 30]];
		const { cells } = pcolormeshCells(X, Y, Z);
		expect(cells[0]).toEqual({
			row: 0,
			column: 0,
			x0: 0.5,
			x1: 1.5,
			y0: -0.5,
			y1: 0.5,
			value: 10,
		});
		expect(cells[1]).toEqual({
			row: 0,
			column: 1,
			x0: 1.5,
			x1: 3,
			y0: -0.5,
			y1: 0.5,
			value: 20,
		});
		expect(cells[2]).toEqual({
			row: 0,
			column: 2,
			x0: 3,
			x1: 5,
			y0: -0.5,
			y1: 0.5,
			value: 30,
		});
	});

	it("throws on a coordinate array that is neither edges nor centers length", () => {
		const X = [0, 1, 2, 3, 4]; // 5 values for 2 columns (needs 2 or 3)
		const Y = [0, 1];
		const Z = [[1, 2]];
		expect(() => pcolormeshCells(X, Y, Z)).toThrow(/X length/);
	});

	it("returns no cells and default min/max for an empty Z, without validating X/Y", () => {
		expect(pcolormeshCells([], [], [])).toEqual({
			cells: [],
			min: 0,
			max: 1,
			nrows: 0,
			ncols: 0,
		});
		// Mismatched X/Y would normally throw, but there are no rows to build.
		expect(pcolormeshCells([1, 2, 3, 4, 5], [1], [])).toEqual({
			cells: [],
			min: 0,
			max: 1,
			nrows: 0,
			ncols: 0,
		});
	});

	it("omits cells past a ragged row's own length", () => {
		const X = [0, 1, 2, 3];
		const Y = [0, 1, 2];
		const Z = [[1, 2, 3], [4]];
		const { cells, ncols } = pcolormeshCells(X, Y, Z);
		expect(ncols).toBe(3);
		expect(cells.filter((c) => c.row === 1)).toHaveLength(1);
	});

	it("passes through non-finite values but excludes them from min/max", () => {
		const X = [0, 1, 2];
		const Y = [0, 1];
		const Z = [[Number.NaN, 7]];
		const { cells, min, max } = pcolormeshCells(X, Y, Z);
		expect(cells.map((c) => c.value)).toEqual([Number.NaN, 7]);
		expect(min).toBe(7);
		expect(max).toBe(7);
	});
});
