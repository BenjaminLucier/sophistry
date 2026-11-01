import { describe, expect, it } from "vitest";
import { facetGrid, facetSlots, outerEdge, panelProgress } from "./facet.js";

describe("facetSlots", () => {
	it("lays rows × columns out row-major", () => {
		const { slots, rows, columns } = facetSlots(["r1", "r2"], ["a", "b", "c"]);
		expect([rows, columns]).toEqual([2, 3]);
		expect(slots.map((s) => [s.row, s.column, s.rowKey, s.columnKey])).toEqual([
			[0, 0, "r1", "a"],
			[0, 1, "r1", "b"],
			[0, 2, "r1", "c"],
			[1, 0, "r2", "a"],
			[1, 1, "r2", "b"],
			[1, 2, "r2", "c"],
		]);
		expect(slots.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("puts one column variable in a row, wrapped after `wrap`", () => {
		expect(facetSlots([], ["a", "b", "c"]).columns).toBe(3);
		const { slots, rows, columns } = facetSlots(
			[],
			["a", "b", "c", "d", "e"],
			2,
		);
		expect([rows, columns]).toEqual([3, 2]);
		expect(slots.map((s) => [s.row, s.column])).toEqual([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
			[2, 0],
		]);
	});

	it("fills a wrapped row variable down columns, indexed in reading order", () => {
		const { slots, rows, columns } = facetSlots(["a", "b", "c"], [], 2);
		expect([rows, columns]).toEqual([2, 2]);
		const byKey = Object.fromEntries(
			slots.map((s) => [s.rowKey, [s.row, s.column, s.index]]),
		);
		expect(byKey).toEqual({ a: [0, 0, 0], c: [0, 1, 1], b: [1, 0, 2] });
	});

	it("is one panel with no facet variable", () => {
		expect(facetSlots([], [])).toEqual({
			slots: [{ index: 0, row: 0, column: 0 }],
			rows: 1,
			columns: 1,
		});
	});
});

describe("outerEdge", () => {
	it("finds the panels with nothing below, including above a wrap gap", () => {
		const { slots } = facetSlots([], ["a", "b", "c"], 2);
		const bottom = slots.map((s) => outerEdge(s, slots, "bottom"));
		// "b" (row 0, col 1) has an empty slot under it.
		expect(bottom).toEqual([false, true, true]);
		expect(slots.map((s) => outerEdge(s, slots, "left"))).toEqual([
			true,
			false,
			true,
		]);
	});
});

describe("facetGrid", () => {
	it("shares the footprint between equal cells after the gaps", () => {
		const grid = facetGrid({
			rows: 1,
			columns: 3,
			width: 9.6,
			height: 3,
			gapX: 0.3,
			gapY: 0.3,
		});
		const cells = grid.cells[0];
		expect(cells.map((c) => c.width)).toEqual([3, 3, 3]);
		expect(cells[0].center.x).toBeCloseTo(-3.3);
		expect(cells[2].center.x).toBeCloseTo(3.3);
		expect(grid.plots).toEqual({
			minX: -4.8,
			maxX: 4.8,
			minY: -1.5,
			maxY: 1.5,
		});
	});

	it("keeps outer room free and splits by ratio", () => {
		const grid = facetGrid({
			rows: 2,
			columns: 2,
			width: 7,
			height: 7,
			center: { x: 1, y: 0 },
			gapX: 0,
			gapY: 0,
			outer: { left: 1, top: 1 },
			widthRatios: [5, 1],
			heightRatios: [1, 5],
		});
		expect(grid.cells[0][0].width).toBeCloseTo(5);
		expect(grid.cells[0][1].width).toBeCloseTo(1);
		expect(grid.cells[0][0].height).toBeCloseTo(1);
		expect(grid.plots.minX).toBeCloseTo(1 - 3.5 + 1);
		expect(grid.plots.maxY).toBeCloseTo(3.5 - 1);
		expect(grid.plots.maxX).toBeCloseTo(4.5);
	});
});

describe("panelProgress", () => {
	it("passes the frame half through and staggers the data half by index", () => {
		expect(panelProgress(0.3, 2, 3, 0.6)).toBe(0.3);
		expect(panelProgress(0.75, 0, 3, 0)).toBe(0.75);
		const at = (i: number) => panelProgress(0.7, i, 3, 0.6);
		expect(at(0)).toBeGreaterThan(at(1));
		expect(at(1)).toBeGreaterThan(at(2));
		expect(at(2)).toBe(0.5);
		for (let i = 0; i < 3; i++) expect(panelProgress(1, i, 3, 0.6)).toBe(1);
	});

	it("starts the last panel after a fixed total spread", () => {
		// Data half at 0.6: the last panel (delay 0.6) is just starting.
		expect(panelProgress(0.8, 4, 5, 0.6)).toBeCloseTo(0.5);
		expect(panelProgress(0.8 + 1e-3, 4, 5, 0.6)).toBeGreaterThan(0.5);
	});
});
