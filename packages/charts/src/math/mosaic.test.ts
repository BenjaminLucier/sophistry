import { describe, expect, it } from "vitest";
import type { MosaicInput } from "./mosaic";
import { mosaicLayout } from "./mosaic";

const table: MosaicInput[] = [
	{ x: "N", y: "a", value: 30 },
	{ x: "N", y: "b", value: 10 },
	{ x: "S", y: "a", value: 20 },
	{ x: "S", y: "b", value: 40 },
];

describe("mosaicLayout", () => {
	it("makes columns as wide as their share of the total", () => {
		const { columns, total } = mosaicLayout(table, { width: 10, height: 4 });
		expect(total).toBe(100);
		expect(columns.map((c) => c.key)).toEqual(["N", "S"]);
		expect(columns[0].x0).toBe(0);
		expect(columns[0].x1).toBeCloseTo(4);
		expect(columns[1].x0).toBeCloseTo(4);
		expect(columns[1].x1).toBe(10);
		expect(columns.map((c) => c.share)).toEqual([0.4, 0.6]);
		expect(columns.map((c) => c.value)).toEqual([40, 60]);
	});

	it("stacks segments bottom-up in row order, y pointing down", () => {
		const { rects } = mosaicLayout(table, { width: 10, height: 4 });
		expect(rects).toHaveLength(4);
		const [na, nb, sa, sb] = rects;
		// The first row sits at the bottom (largest y).
		expect(na).toMatchObject({ column: "N", row: "a", rowIndex: 0 });
		expect(na.y1).toBe(4);
		expect(na.y0).toBeCloseTo(1);
		expect(nb.y1).toBeCloseTo(1);
		expect(nb.y0).toBe(0);
		expect(na.rowShare).toBeCloseTo(0.75);
		expect(nb.rowShare).toBeCloseTo(0.25);
		expect(sa.y0).toBeCloseTo(4 - 4 / 3);
		expect(sb.y0).toBe(0);
		expect(sa.columnShare).toBeCloseTo(0.6);
		// Areas are proportional to values.
		for (const r of rects) {
			const area = (r.x1 - r.x0) * (r.y1 - r.y0);
			expect(area).toBeCloseTo((r.value / 100) * 40, 9);
		}
	});

	it("defaults to a unit box", () => {
		const { rects } = mosaicLayout(table);
		for (const r of rects) {
			expect(r.x0).toBeGreaterThanOrEqual(0);
			expect(r.x1).toBeLessThanOrEqual(1);
			expect(r.y0).toBeGreaterThanOrEqual(0);
			expect(r.y1).toBeLessThanOrEqual(1);
		}
	});

	it("puts padding between columns and between segments", () => {
		const { columns, rects } = mosaicLayout(table, {
			width: 10.5,
			height: 4.5,
			padding: 0.5,
		});
		expect(columns[1].x0 - columns[0].x1).toBeCloseTo(0.5);
		expect(columns[0].x1 - columns[0].x0).toBeCloseTo(4);
		expect(columns[1].x1 - columns[1].x0).toBeCloseTo(6);
		const [na, nb] = rects;
		expect(na.y0 - nb.y1).toBeCloseTo(0.5);
		expect(na.y1 - na.y0).toBeCloseTo(3);
		expect(nb.y1 - nb.y0).toBeCloseTo(1);
		expect(nb.y0).toBeCloseTo(0);
	});

	it("caps gaps at half the box", () => {
		const { columns } = mosaicLayout(table, { width: 2, padding: 5 });
		expect(columns[1].x0 - columns[0].x1).toBeCloseTo(1);
		expect(columns[0].x1 - columns[0].x0).toBeCloseTo(0.4);
		expect(columns[1].x1).toBe(2);
	});

	it("follows the given column and row order, appending unlisted keys", () => {
		const data: MosaicInput[] = [
			...table,
			{ x: "E", y: "c", value: 10 },
			{ x: "W", y: "a", value: 10 },
		];
		const layout = mosaicLayout(data, {
			columns: ["S", "W", "missing"],
			rows: ["b"],
		});
		expect(layout.columns.map((c) => c.key)).toEqual(["S", "W", "N", "E"]);
		expect(layout.rows).toEqual(["b", "a", "c"]);
		const s = layout.rects.filter((r) => r.column === "S");
		expect(s.map((r) => r.row)).toEqual(["b", "a"]);
		// "b" is the first row, so it sits at the bottom.
		expect(s[0].y1).toBe(1);
		expect(s[0].rowIndex).toBe(0);
		expect(layout.rects.find((r) => r.row === "c")?.rowIndex).toBe(2);
	});

	it("sums duplicate pairs and keeps the first contributing datum", () => {
		const layout = mosaicLayout([
			{ x: "A", y: "p", value: 0 },
			{ x: "A", y: "p", value: 2 },
			{ x: "A", y: "q", value: 1 },
			{ x: "A", y: "p", value: 1 },
		]);
		expect(layout.rects).toHaveLength(2);
		expect(layout.rects[0]).toMatchObject({ row: "p", value: 3, dataIndex: 1 });
		expect(layout.rects[0].rowShare).toBeCloseTo(0.75);
		expect(layout.columns[0].dataIndex).toBe(1);
	});

	it("counts negative and non-finite values as 0 and drops empty parts", () => {
		const layout = mosaicLayout(
			[
				{ x: "A", y: "p", value: 1 },
				{ x: "A", y: "q", value: -5 },
				{ x: "B", y: "p", value: Number.NaN },
				{ x: "C", y: "q", value: Number.POSITIVE_INFINITY },
				{ x: "D", y: "q", value: 3 },
			],
			{ width: 4, padding: 0.1 },
		);
		expect(layout.total).toBe(4);
		expect(layout.columns.map((c) => c.key)).toEqual(["A", "D"]);
		expect(layout.columns.map((c) => c.index)).toEqual([0, 1]);
		expect(layout.rects.map((r) => `${r.column}${r.row}`)).toEqual([
			"Ap",
			"Dq",
		]);
		// One segment per column: no row gap, full height.
		expect(layout.rects[0].y0).toBe(0);
		expect(layout.rects[0].y1).toBe(1);
		expect(layout.rows).toEqual(["p", "q"]);
	});

	it("returns an empty layout when nothing is positive", () => {
		expect(mosaicLayout([])).toEqual({
			columns: [],
			rects: [],
			rows: [],
			total: 0,
		});
		const zero = mosaicLayout([{ x: "A", y: "p", value: 0 }]);
		expect(zero.rects).toEqual([]);
		expect(zero.rows).toEqual(["p"]);
	});

	it("accepts number keys", () => {
		const layout = mosaicLayout([
			{ x: 2024, y: 1, value: 1 },
			{ x: 2025, y: 1, value: 3 },
		]);
		expect(layout.columns.map((c) => c.key)).toEqual([2024, 2025]);
		expect(layout.columns[0].x1).toBeCloseTo(0.25);
	});
});
