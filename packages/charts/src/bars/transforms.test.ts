import { describe, expect, it } from "vitest";
import {
	bin,
	dodge,
	group,
	jitter,
	normalize,
	rolling,
	stack,
	summarize,
} from "./transforms.js";

const sales = [
	{ quarter: "Q1", region: "north", units: 3 },
	{ quarter: "Q1", region: "south", units: 5 },
	{ quarter: "Q2", region: "north", units: 4 },
	{ quarter: "Q2", region: "south", units: -2 },
	{ quarter: "Q2", region: "east", units: 1 },
];

describe("stack", () => {
	it("stacks rows sharing an x by series, keeping the input row", () => {
		const rows = stack(sales, { x: "quarter", y: "units", z: "region" });
		expect(rows.map((r) => [r.y1, r.y2])).toEqual([
			[0, 3],
			[3, 8],
			[0, 4],
			[0, -2],
			[4, 5],
		]);
		expect(rows[1]).toMatchObject({
			datum: sales[1],
			index: 1,
			x: "Q1",
			z: "south",
			zIndex: 1,
			y: 5,
		});
		expect(rows[4].zIndex).toBe(2);
	});

	it("orders series by the keys given", () => {
		const rows = stack(sales.slice(0, 2), {
			x: "quarter",
			y: "units",
			z: "region",
			order: ["south", "north"],
		});
		expect(rows.map((r) => [r.y1, r.y2])).toEqual([
			[5, 8],
			[0, 5],
		]);
	});

	it("normalizes each column to 0..1, diverging values included", () => {
		const rows = stack(sales, {
			x: "quarter",
			y: "units",
			z: "region",
			offset: "normalize",
		});
		expect(rows[0].y2).toBeCloseTo(3 / 8);
		expect(rows[1].y2).toBeCloseTo(1);
		// Q2 spans -2..5: south (−2..0) maps to 0..2/7.
		expect(rows[3].y2).toBeCloseTo(0);
		expect(rows[3].y1).toBeCloseTo(2 / 7);
	});

	it("stacks everything in one column without x, and number data needs no y", () => {
		const rows = stack([1, 2, 3]);
		expect(rows.map((r) => r.y2)).toEqual([1, 3, 6]);
		expect(rows[0].x).toBeUndefined();
	});

	it("takes numeric x columns in ascending order for wiggle", () => {
		const data = [
			{ t: 2, v: 6 },
			{ t: 0, v: 2 },
			{ t: 1, v: 4 },
		];
		const rows = stack(data, { x: "t", y: "v", offset: "wiggle" });
		const mid = (r: { y1: number; y2: number }) => (r.y1 + r.y2) / 2;
		// One layer: wiggle holds its midline level across x.
		expect(mid(rows[0])).toBeCloseTo(mid(rows[1]));
		expect(mid(rows[2])).toBeCloseTo(mid(rows[1]));
	});

	it("gives a non-finite value NaN ends and no room", () => {
		const rows = stack([1, Number.NaN, 2]);
		expect(rows[1].y1).toBeNaN();
		expect(rows[2]).toMatchObject({ y1: 1, y2: 3 });
	});
});

describe("dodge", () => {
	it("gives every series its own place in every band", () => {
		const rows = dodge(sales, { x: "quarter", y: "units", z: "region" });
		const third = (k: number) => [(k + 0.05) / 3, (k + 0.95) / 3];
		expect(rows[0].subband).toEqual(third(0));
		expect(rows[1].subband).toEqual(third(1));
		expect(rows[4].subband).toEqual(third(2));
		expect(rows[3]).toMatchObject({ x: "Q2", z: "south", y: -2 });
	});

	it("compact splits a band only among the series in it", () => {
		const rows = dodge(sales, {
			x: "quarter",
			z: "region",
			compact: true,
			padding: 0,
		});
		expect(rows[0].subband).toEqual([0, 0.5]);
		expect(rows[1].subband).toEqual([0.5, 1]);
		expect(rows[4].subband).toEqual([2 / 3, 1]);
	});
});

describe("group", () => {
	it("counts by one key", () => {
		const rows = group(sales, { by: "quarter" });
		expect(rows.map((r) => [r.x, r.y])).toEqual([
			["Q1", 2],
			["Q2", 3],
		]);
		expect(rows[1].indexes).toEqual([2, 3, 4]);
	});

	it("reduces by two keys, ready for stack", () => {
		const data = [...sales, { quarter: "Q1", region: "north", units: 2 }];
		const totals = group(data, {
			by: ["quarter", "region"],
			y: "units",
			reduce: "sum",
		});
		expect(totals[0]).toMatchObject({ x: "Q1", z: "north", y: 5 });
		const stacked = stack(totals, { x: "x", y: "y", z: "z" });
		expect(stacked[1]).toMatchObject({ y1: 5, y2: 10 });
	});
});

describe("bin", () => {
	it("bins rows like histogramBins and reduces each bin", () => {
		const data = [
			{ age: 1, spend: 10 },
			{ age: 2, spend: 20 },
			{ age: 7, spend: 5 },
			{ age: 9, spend: 15 },
			{ age: Number.NaN, spend: 99 },
		];
		const counts = bin(data, { x: "age", range: [0, 10, 5] });
		expect(counts.map((b) => [b.x1, b.x2, b.y])).toEqual([
			[0, 5, 2],
			[5, 10, 2],
		]);
		const means = bin(data, {
			x: "age",
			y: "spend",
			reduce: "mean",
			range: [0, 10, 5],
		});
		expect(means.map((b) => b.y)).toEqual([15, 10]);
		expect(means[1].x).toBe(7.5);
	});
});

describe("summarize", () => {
	it("pools replicates by x into a mean and interval, ascending in x", () => {
		const data = [
			{ dose: 2, r: 4 },
			{ dose: 1, r: 1 },
			{ dose: 1, r: 3 },
			{ dose: 2, r: 6 },
		];
		const rows = summarize(data, { x: "dose", y: "r", interval: "se" });
		expect(rows.map((r) => [r.x, r.y, r.n])).toEqual([
			[1, 2, 2],
			[2, 5, 2],
		]);
		expect(rows[0].high).toBeCloseTo(3);
		expect(rows[0].low).toBeCloseTo(1);
	});
});

describe("maps", () => {
	it("rolling, normalize and jitter return one number per row", () => {
		const data = [{ v: 2 }, { v: 4 }, { v: 6 }];
		expect(rolling(data, { y: "v", k: 3 })).toEqual([3, 4, 5]);
		expect(normalize(data, { y: "v" })).toEqual([1, 2, 3]);
		const a = jitter(data, { width: 0.4 });
		expect(a).toEqual(jitter(data, { width: 0.4 }));
		expect(a.every((o) => Math.abs(o) <= 0.2)).toBe(true);
		const byId = jitter(
			[
				{ id: "p", v: 1 },
				{ id: "q", v: 2 },
			],
			{ key: "id" },
		);
		const reordered = jitter([{ id: "q" }, { id: "p" }], { key: "id" });
		expect(reordered).toEqual([byId[1], byId[0]]);
	});
});
