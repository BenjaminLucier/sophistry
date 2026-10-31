import { describe, expect, it } from "vitest";
import { boxplotStats } from "./boxplot";

describe("boxplotStats", () => {
	it("matches hand-computed quartiles for a simple dataset", () => {
		// sorted 1..10, d3-array's default (R-7) interpolation:
		// q1 index (n-1)*0.25 = 2.25 -> between 3 and 4 -> 3.25
		// median index 4.5 -> between 5 and 6 -> 5.5
		// q3 index 6.75 -> between 7 and 8 -> 7.75
		const stats = boxplotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(stats).not.toBeNull();
		expect(stats?.q1).toBeCloseTo(3.25);
		expect(stats?.median).toBeCloseTo(5.5);
		expect(stats?.q3).toBeCloseTo(7.75);
		expect(stats?.min).toBe(1);
		expect(stats?.max).toBe(10);
	});

	it("returns null for empty input", () => {
		expect(boxplotStats([])).toBeNull();
	});

	it("returns null when every value is non-finite", () => {
		expect(boxplotStats([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
	});

	it("sets low/high to min/max when nothing falls outside the fence", () => {
		const stats = boxplotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(stats?.low).toBe(stats?.min);
		expect(stats?.high).toBe(stats?.max);
		expect(stats?.outliers).toEqual([]);
	});

	it("splits values outside the fence into outliers, leaving whiskers short of min/max", () => {
		// same q1/q3 as the dataset above (100 doesn't touch the 0.25/0.75
		// positions), so the fence is still q1 - 1.5*iqr .. q3 + 1.5*iqr
		// = 3.25 - 6.75 .. 7.75 + 6.75 = -3.5 .. 14.5
		const stats = boxplotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
		expect(stats).not.toBeNull();
		expect(stats?.max).toBe(100);
		expect(stats?.outliers).toEqual([100]);
		expect(stats?.high).toBe(9);
		expect(stats?.low).toBe(1);
	});

	it("drops non-finite values before computing stats", () => {
		const withJunk = boxplotStats([
			1,
			2,
			Number.NaN,
			3,
			Number.POSITIVE_INFINITY,
			4,
			5,
		]);
		const clean = boxplotStats([1, 2, 3, 4, 5]);
		expect(withJunk).toEqual(clean);
	});

	it("honors a custom whiskerScale via options", () => {
		const wide = boxplotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], {
			whiskerScale: 25,
		});
		expect(wide?.outliers).toEqual([]);
		expect(wide?.high).toBe(100);
	});

	it("collapses to a single point for single-value input", () => {
		const stats = boxplotStats([5]);
		expect(stats).not.toBeNull();
		expect(stats?.min).toBe(5);
		expect(stats?.q1).toBe(5);
		expect(stats?.median).toBe(5);
		expect(stats?.q3).toBe(5);
		expect(stats?.max).toBe(5);
		expect(stats?.low).toBe(5);
		expect(stats?.high).toBe(5);
		expect(stats?.outliers).toEqual([]);
	});
});
