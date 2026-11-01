import { describe, expect, it } from "vitest";
import type { StackItem } from "./stack.js";
import { stackColumns, stackOrder } from "./stack.js";

/** Columns from a [series][column] matrix, every series present everywhere. */
const matrix = (values: number[][]): StackItem[][] =>
	values[0].map((_, c) =>
		values.map((row, s) => ({ series: s, value: row[c] })),
	);

describe("stackColumns", () => {
	it("stacks each column's items end to end from zero", () => {
		const { spans } = stackColumns(
			matrix([
				[1, 2],
				[3, 4],
			]),
			2,
		);
		expect(spans).toEqual([
			[
				[0, 1],
				[1, 4],
			],
			[
				[0, 2],
				[2, 6],
			],
		]);
	});

	it("stacks negatives down from zero as their own stack (diverging)", () => {
		const { spans } = stackColumns(
			[
				[
					{ series: 0, value: 2 },
					{ series: 1, value: -1 },
					{ series: 2, value: 3 },
					{ series: 3, value: -2 },
				],
			],
			4,
		);
		expect(spans[0]).toEqual([
			[0, 2],
			[0, -1],
			[2, 5],
			[-1, -3],
		]);
	});

	it("keeps one running total when not diverging (matplotlib's stackplot)", () => {
		const { spans } = stackColumns(
			[
				[
					{ series: 0, value: 3 },
					{ series: 1, value: -1 },
				],
			],
			2,
			{ diverging: false },
		);
		expect(spans[0]).toEqual([
			[0, 3],
			[3, 2],
		]);
	});

	it("starts at the baseline under zero, and ignores it otherwise", () => {
		const items = matrix([[1], [1]]);
		expect(stackColumns(items, 2, { baseline: 10 }).spans[0][1]).toEqual([
			11, 12,
		]);
		expect(
			stackColumns(items, 2, { baseline: 10, offset: "normalize" }).spans[0][1],
		).toEqual([0.5, 1]);
	});

	it("normalize scales every column to 0..1", () => {
		const { spans } = stackColumns(
			matrix([
				[1, 6],
				[3, 2],
			]),
			2,
			{ offset: "normalize" },
		);
		expect(spans[0]).toEqual([
			[0, 0.25],
			[0.25, 1],
		]);
		expect(spans[1]).toEqual([
			[0, 0.75],
			[0.75, 1],
		]);
	});

	it("center puts every column's middle on zero", () => {
		const { spans } = stackColumns(
			matrix([
				[2, 1],
				[2, 1],
			]),
			2,
			{ offset: "center" },
		);
		expect(spans[0]).toEqual([
			[-2, 0],
			[0, 2],
		]);
		expect(spans[1]).toEqual([
			[-1, 0],
			[0, 1],
		]);
	});

	it("wiggle keeps a lone growing layer's midline level, centred overall", () => {
		// One series: wiggle should hold its midline flat (zero slope), i.e.
		// grow symmetrically about one line, and centring puts that line at 0.
		const { spans } = stackColumns(matrix([[2, 4, 6]]), 1, {
			offset: "wiggle",
		});
		const mids = spans.map(([[a, b]]) => (a + b) / 2);
		expect(mids[0]).toBeCloseTo(mids[1]);
		expect(mids[1]).toBeCloseTo(mids[2]);
		expect(mids[0]).toBeCloseTo(0);
		expect(spans[2][0][1] - spans[2][0][0]).toBeCloseTo(6);
	});

	it("wiggle leaves a flat stack flat", () => {
		const { spans } = stackColumns(
			matrix([
				[1, 1, 1],
				[2, 2, 2],
			]),
			2,
			{ offset: "wiggle" },
		);
		for (const column of spans) {
			expect(column[0][0]).toBeCloseTo(spans[0][0][0]);
			expect(column[1][1]).toBeCloseTo(spans[0][1][1]);
		}
	});

	it("is homogeneous: scaling every value scales the stack (so × t reveals stay valid)", () => {
		const values = [
			[1, 3, 2],
			[2, 1, 4],
			[3, 2, 1],
		];
		const half = values.map((row) => row.map((v) => v / 2));
		for (const offset of ["zero", "center", "wiggle"] as const) {
			const a = stackColumns(matrix(values), 3, { offset }).spans;
			const b = stackColumns(matrix(half), 3, { offset }).spans;
			a.forEach((column, c) => {
				column.forEach(([lo, hi], s) => {
					expect(b[c][s][0]).toBeCloseTo(lo / 2);
					expect(b[c][s][1]).toBeCloseTo(hi / 2);
				});
			});
		}
	});

	it("gives a non-finite item no room and NaN ends", () => {
		const { spans } = stackColumns(
			[
				[
					{ series: 0, value: Number.NaN },
					{ series: 1, value: 2 },
				],
			],
			2,
		);
		expect(spans[0][0].every(Number.isNaN)).toBe(true);
		expect(spans[0][1]).toEqual([0, 2]);
	});

	it("stacks in the order asked for", () => {
		const { spans, order } = stackColumns(matrix([[1], [2]]), 2, {
			order: "reverse",
		});
		expect(order).toEqual([1, 0]);
		expect(spans[0]).toEqual([
			[2, 3],
			[0, 2],
		]);
	});
});

describe("stackOrder", () => {
	const columns = matrix([
		[5, 0, 0], // peaks first, total 5
		[0, 0, 9], // peaks last, total 9
		[0, 3, 0], // peaks in the middle, total 3
	]);

	it("sum puts the smallest total at the bottom", () => {
		expect(stackOrder(columns, 3, "sum")).toEqual([2, 0, 1]);
	});

	it("insideOut puts early peaks in the middle, balancing the sides", () => {
		// By peak: 0, 2, 1. 0 → bottom; 2 → top (top 0 < bottom 5); 1 → top (3 < 5).
		expect(stackOrder(columns, 3, "insideOut")).toEqual([0, 2, 1]);
	});

	it("an explicit order wins, unlisted series following in appearance", () => {
		expect(stackOrder(columns, 3, [2])).toEqual([2, 0, 1]);
		expect(stackOrder(columns, 3, [1, 1, 7, 0])).toEqual([1, 0, 2]);
	});
});
