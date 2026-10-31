import { describe, expect, it } from "vitest";
import { imshowCells } from "./imshow";

describe("imshowCells", () => {
	it("lays a 2x2 grid onto the default extent [0, ncols, 0, nrows]", () => {
		// Z = [[1, 2], [3, 4]], default extent [0, 2, 0, 2], origin "upper":
		// row 0 (values 1, 2) sits at the TOP, i.e. y in [1, 2];
		// row 1 (values 3, 4) sits at the BOTTOM, i.e. y in [0, 1].
		const Z = [
			[1, 2],
			[3, 4],
		];
		const { cells, min, max, nrows, ncols } = imshowCells(Z);
		expect(nrows).toBe(2);
		expect(ncols).toBe(2);
		expect(min).toBe(1);
		expect(max).toBe(4);
		expect(cells).toHaveLength(4);

		const topLeft = cells.find((c) => c.row === 0 && c.column === 0);
		expect(topLeft).toEqual({
			row: 0,
			column: 0,
			x0: 0,
			x1: 1,
			y0: 1,
			y1: 2,
			value: 1,
		});

		const bottomRight = cells.find((c) => c.row === 1 && c.column === 1);
		expect(bottomRight).toEqual({
			row: 1,
			column: 1,
			x0: 1,
			x1: 2,
			y0: 0,
			y1: 1,
			value: 4,
		});
	});

	it("flips row placement for origin 'lower': row 0 sits at the bottom", () => {
		const Z = [
			[1, 2],
			[3, 4],
		];
		const { cells } = imshowCells(Z, { origin: "lower" });
		const row0 = cells.find((c) => c.row === 0 && c.column === 0);
		expect(row0).toEqual({
			row: 0,
			column: 0,
			x0: 0,
			x1: 1,
			y0: 0,
			y1: 1,
			value: 1,
		});
		const row1 = cells.find((c) => c.row === 1 && c.column === 0);
		expect(row1).toEqual({
			row: 1,
			column: 0,
			x0: 0,
			x1: 1,
			y0: 1,
			y1: 2,
			value: 3,
		});
	});

	it("maps cells onto a custom extent", () => {
		const Z = [[1, 2, 3]];
		const { cells } = imshowCells(Z, { extent: [10, 40, 100, 200] });
		expect(cells).toHaveLength(3);
		const middle = cells.find((c) => c.column === 1);
		expect(middle?.x0).toBeCloseTo(20);
		expect(middle?.x1).toBeCloseTo(30);
		// Single row: origin "upper" default puts it spanning the full y extent.
		expect(middle?.y0).toBeCloseTo(100);
		expect(middle?.y1).toBeCloseTo(200);
	});

	it("returns no cells and default min/max for an empty grid", () => {
		expect(imshowCells([])).toEqual({
			cells: [],
			min: 0,
			max: 1,
			nrows: 0,
			ncols: 0,
		});
	});

	it("returns no cells when every row is empty", () => {
		const { cells, nrows, ncols } = imshowCells([[], []]);
		expect(cells).toEqual([]);
		expect(nrows).toBe(2);
		expect(ncols).toBe(0);
	});

	it("omits cells past a ragged row's own length rather than inventing values", () => {
		const Z = [[1, 2, 3], [4]];
		const { cells, ncols } = imshowCells(Z);
		expect(ncols).toBe(3);
		expect(cells.filter((c) => c.row === 1)).toHaveLength(1);
		expect(cells.filter((c) => c.row === 0)).toHaveLength(3);
	});

	it("passes through non-finite values but excludes them from min/max", () => {
		const Z = [[1, Number.NaN, Number.POSITIVE_INFINITY, 5]];
		const { cells, min, max } = imshowCells(Z);
		expect(cells.map((c) => c.value)).toEqual([
			1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			5,
		]);
		expect(min).toBe(1);
		expect(max).toBe(5);
	});

	it("falls back to min 0, max 1 when every value is non-finite", () => {
		const Z = [[Number.NaN, Number.NaN]];
		const { min, max } = imshowCells(Z);
		expect(min).toBe(0);
		expect(max).toBe(1);
	});
});
