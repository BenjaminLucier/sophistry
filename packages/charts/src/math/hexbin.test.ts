import { describe, expect, it } from "vitest";
import { hexbin } from "./hexbin.js";

function dist(ax: number, ay: number, bx: number, by: number): number {
	return Math.hypot(ax - bx, ay - by);
}

describe("hexbin", () => {
	it("returns [] for empty input", () => {
		expect(hexbin([], [], 1)).toEqual([]);
	});

	it("bins a single point into one cell close to it", () => {
		const cells = hexbin([5], [7], 1);
		expect(cells.length).toBe(1);
		expect(cells[0].count).toBe(1);
		expect(
			dist(cells[0].center.x, cells[0].center.y, 5, 7),
		).toBeLessThanOrEqual(1);
	});

	it("merges points clustered well within one hex radius into a single cell", () => {
		const xs = [0, 0.05, -0.05, 0.02, -0.02];
		const ys = [0, 0.02, -0.02, -0.03, 0.03];
		const cells = hexbin(xs, ys, 1);
		expect(cells.length).toBe(1);
		expect(cells[0].count).toBe(5);
	});

	it("separates points several hex-widths apart into distinct cells", () => {
		const xs = [0, 20, -20];
		const ys = [0, 20, -20];
		const cells = hexbin(xs, ys, 1);
		expect(cells.length).toBe(3);
		for (const cell of cells) expect(cell.count).toBe(1);
	});

	it("drops non-finite pairs", () => {
		const xs = [0, Number.NaN, 2, Number.POSITIVE_INFINITY];
		const ys = [0, 1, Number.NaN, 3];
		const cells = hexbin(xs, ys, 1);
		const total = cells.reduce((sum, c) => sum + c.count, 0);
		expect(total).toBe(1);
	});

	it("total count across all cells equals the number of finite pairs", () => {
		const xs = [0, 1, 2, 3, 4, 5, Number.NaN, 7];
		const ys = [0, 1, 2, 3, 4, 5, 6, Number.NaN];
		const cells = hexbin(xs, ys, 0.5);
		const total = cells.reduce((sum, c) => sum + c.count, 0);
		expect(total).toBe(6);
	});
});

describe("hexbin invalid radius", () => {
	it("returns [] for zero, negative, NaN or infinite radius", () => {
		for (const r of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(hexbin([1, 2], [1, 2], r)).toEqual([]);
		}
	});
});
