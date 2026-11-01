import { describe, expect, it } from "vitest";
import { largestRemainder, waffleCells } from "./waffle.js";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("largestRemainder", () => {
	it("sums to exactly the total where plain rounding would not", () => {
		// Plain rounding gives 33 + 33 + 33 = 99.
		expect(largestRemainder([1, 1, 1], 100)).toEqual([34, 33, 33]);
		// Plain rounding gives 17 + 17 + 17 + 17 + 17 + 17 = 102.
		const six = largestRemainder([1, 1, 1, 1, 1, 1], 100);
		expect(sum(six)).toBe(100);
		expect(six).toEqual([17, 17, 17, 17, 16, 16]);
	});

	it("gives leftover units to the largest remainders", () => {
		// Quotas 45.5, 33.3, 21.2 -> floors 45, 33, 21; one unit left, to the .5.
		expect(largestRemainder([45.5, 33.3, 21.2], 100)).toEqual([46, 33, 21]);
	});

	it("keeps exact shares exact", () => {
		expect(largestRemainder([62, 38], 100)).toEqual([62, 38]);
		expect(largestRemainder([1, 3], 8)).toEqual([2, 6]);
	});

	it("sums exactly across many random inputs and totals", () => {
		let seed = 7;
		const random = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		for (let trial = 0; trial < 200; trial++) {
			const n = 1 + Math.floor(random() * 9);
			const values = Array.from({ length: n }, () => random() * 50);
			const total = 1 + Math.floor(random() * 300);
			const counts = largestRemainder(values, total);
			expect(sum(counts)).toBe(total);
			for (let i = 0; i < n; i++) {
				// Never more than one unit away from the exact quota.
				const quota = (values[i] / sum(values)) * total;
				expect(Math.abs(counts[i] - quota)).toBeLessThan(1);
			}
		}
	});

	it("treats negative and non-finite values as 0 and never gives them a unit", () => {
		const counts = largestRemainder([-5, Number.NaN, 1, 1, 1], 10);
		expect(counts.slice(0, 2)).toEqual([0, 0]);
		expect(sum(counts)).toBe(10);
	});

	it("returns zeros when nothing is positive or the total is not positive", () => {
		expect(largestRemainder([0, 0], 100)).toEqual([0, 0]);
		expect(largestRemainder([], 100)).toEqual([]);
		expect(largestRemainder([1, 2], 0)).toEqual([0, 0]);
		expect(largestRemainder([1, 2], Number.NaN)).toEqual([0, 0]);
	});
});

describe("waffleCells", () => {
	it("defaults to a 10 × 10 grid with one cell per rank", () => {
		const cells = waffleCells([1, 1]);
		expect(cells).toHaveLength(100);
		expect(cells.map((c) => c.rank)).toEqual(
			Array.from({ length: 100 }, (_, i) => i),
		);
	});

	it("fills row by row from the bottom-left", () => {
		const cells = waffleCells([1], { rows: 3, columns: 4 });
		expect(cells[0]).toMatchObject({ row: 0, column: 0 });
		expect(cells[3]).toMatchObject({ row: 0, column: 3 });
		expect(cells[4]).toMatchObject({ row: 1, column: 0 });
		expect(cells[11]).toMatchObject({ row: 2, column: 3 });
	});

	it("gives each category one contiguous run, in data order", () => {
		const cells = waffleCells([1, 1, 1], { rows: 10, columns: 10 });
		const categories = cells.map((c) => c.category);
		expect(categories.filter((c) => c === 0)).toHaveLength(34);
		expect(categories.filter((c) => c === 1)).toHaveLength(33);
		expect(categories.filter((c) => c === 2)).toHaveLength(33);
		// Non-decreasing: no category interleaves another.
		for (let i = 1; i < categories.length; i++)
			expect(categories[i]).toBeGreaterThanOrEqual(categories[i - 1]);
	});

	it("skips zero-valued categories without breaking index alignment", () => {
		const cells = waffleCells([1, 0, 1], { rows: 1, columns: 4 });
		expect(cells.map((c) => c.category)).toEqual([0, 0, 2, 2]);
	});

	it("leaves every cell empty when nothing is positive", () => {
		const cells = waffleCells([0, 0], { rows: 2, columns: 2 });
		expect(cells.map((c) => c.category)).toEqual([-1, -1, -1, -1]);
	});

	it("handles a degenerate grid", () => {
		expect(waffleCells([1], { rows: 0, columns: 10 })).toEqual([]);
		expect(waffleCells([1], { rows: 2.7, columns: 3.2 })).toHaveLength(6);
	});
});
