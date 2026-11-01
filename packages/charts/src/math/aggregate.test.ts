import { describe, expect, it } from "vitest";
import { normalizeValues, reduceValues, rollingValues } from "./aggregate.js";

describe("reduceValues", () => {
	const values = [4, 1, Number.NaN, 3, 2];

	it("drops non-finite values for every reducer but count", () => {
		expect(reduceValues(values, "count")).toBe(5);
		expect(reduceValues(values, "sum")).toBe(10);
		expect(reduceValues(values, "mean")).toBe(2.5);
		expect(reduceValues(values, "median")).toBe(2.5);
		expect(reduceValues(values, "min")).toBe(1);
		expect(reduceValues(values, "max")).toBe(4);
		expect(reduceValues(values, "first")).toBe(4);
		expect(reduceValues(values, "last")).toBe(2);
		expect(reduceValues([1, 3], "variance")).toBe(2);
		expect(reduceValues([1, 3], "deviation")).toBeCloseTo(Math.SQRT2);
	});

	it("reduces nothing to NaN (count and sum: 0)", () => {
		expect(reduceValues([], "count")).toBe(0);
		expect(reduceValues([], "sum")).toBe(0);
		expect(reduceValues([], "mean")).toBeNaN();
	});

	it("takes a function", () => {
		expect(reduceValues([1, 2, 3], (v) => v.length * 10)).toBe(30);
	});
});

describe("rollingValues", () => {
	it("is a centred moving mean by default, shrinking at the ends", () => {
		expect(rollingValues([1, 2, 3, 4, 5], { k: 3 })).toEqual([
			1.5, 2, 3, 4, 4.5,
		]);
	});

	it("anchors trailing and leading windows", () => {
		expect(rollingValues([1, 2, 3], { k: 2, anchor: "end" })).toEqual([
			1, 1.5, 2.5,
		]);
		expect(rollingValues([1, 2, 3], { k: 2, anchor: "start" })).toEqual([
			1.5, 2.5, 3,
		]);
	});

	it("strict leaves incomplete windows NaN", () => {
		const out = rollingValues([1, 2, Number.NaN, 4, 5, 6], {
			k: 2,
			anchor: "end",
			strict: true,
		});
		expect(out[0]).toBeNaN();
		expect(out[1]).toBe(1.5);
		expect(out[2]).toBeNaN();
		expect(out[3]).toBeNaN();
		expect(out[4]).toBe(4.5);
	});

	it("takes any reducer", () => {
		expect(rollingValues([3, 1, 2], { k: 3, reduce: "max" })).toEqual([
			3, 3, 2,
		]);
	});
});

describe("normalizeValues", () => {
	it("indexes against the first value by default", () => {
		expect(normalizeValues([50, 60, 75])).toEqual([1, 1.2, 1.5]);
	});

	it("divides by a statistic, rescales the extent, or standardizes", () => {
		expect(normalizeValues([1, 3], "sum")).toEqual([0.25, 0.75]);
		expect(normalizeValues([2, 4, 6], "extent")).toEqual([0, 0.5, 1]);
		const z = normalizeValues([1, 2, 3], "deviation");
		expect(z[1]).toBe(0);
		expect(z[2]).toBeCloseTo(1);
		expect(normalizeValues([2, 4], 4)).toEqual([0.5, 1]);
	});

	it("keeps NaN in place, and a zero basis gives NaN", () => {
		const out = normalizeValues([Number.NaN, 2, 4], "first");
		expect(out[0]).toBeNaN();
		expect(out[1]).toBe(1);
		expect(normalizeValues([0, 1], "first").every(Number.isNaN)).toBe(true);
	});
});
