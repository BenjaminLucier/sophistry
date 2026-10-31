import { describe, expect, it } from "vitest";
import { bulletDomain, bulletRow } from "./bullet";

describe("bulletDomain", () => {
	it("runs from zero to the largest value, rounded out to ticks", () => {
		expect(bulletDomain([270, 250, 150, 225, 300])).toEqual([0, 300, 100]);
		expect(bulletDomain([4.3, 4.5, 3.5, 4.25, 5])).toEqual([0, 5, 1]);
		expect(bulletDomain([23, 26])).toEqual([0, 30, 10]);
	});

	it("starts below zero when a value is negative", () => {
		expect(bulletDomain([-12, 30])).toEqual([-20, 30, 10]);
		// All negative: the scale ends at zero.
		expect(bulletDomain([-12, -30])).toEqual([-30, 0, 10]);
	});

	it("can skip the rounding", () => {
		expect(bulletDomain([23, 26], { nice: false }).slice(0, 2)).toEqual([
			0, 26,
		]);
	});

	it("keeps an explicit min or max as given", () => {
		const [lo, hi, step] = bulletDomain([270, 300], { min: 100, max: 350 });
		expect([lo, hi]).toEqual([100, 350]);
		expect(step).toBe(50);
		expect(bulletDomain([270], { max: 400 }).slice(0, 2)).toEqual([0, 400]);
		expect(bulletDomain([270], { min: 200 }).slice(0, 2)).toEqual([200, 300]);
	});

	it("degrades on empty, non-finite or inverted input", () => {
		expect(bulletDomain([])).toEqual([0, 1, 1]);
		expect(bulletDomain([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([
			0, 1, 1,
		]);
		const [lo, hi] = bulletDomain([50], { min: 80, max: 20 });
		expect(lo).toBe(80);
		expect(hi).toBeGreaterThan(lo);
		const [lo2, hi2] = bulletDomain([50], { max: -10 });
		expect(hi2).toBe(-10);
		expect(lo2).toBeLessThan(hi2);
	});
});

describe("bulletRow", () => {
	it("resolves bands, the measure and the target as fractions", () => {
		const row = bulletRow(270, { target: 250, ranges: [150, 225, 300] });
		expect(row.domain).toEqual([0, 300, 100]);
		expect(row.ticks).toEqual([0, 100, 200, 300]);
		expect(row.bands.map((b) => [b.index, b.from, b.to])).toEqual([
			[0, 0, 150],
			[1, 150, 225],
			[2, 225, 300],
		]);
		expect(row.bands[1].startFraction).toBeCloseTo(0.5);
		expect(row.bands[1].endFraction).toBeCloseTo(0.75);
		expect(row.zero).toBe(true);
		expect(row.baseline).toBe(0);
		expect(row.measure).toEqual({
			from: 0,
			to: 270,
			startFraction: 0,
			endFraction: 0.9,
		});
		expect(row.target?.value).toBe(250);
		expect(row.target?.fraction).toBeCloseTo(250 / 300);
	});

	it("runs the last band on to the end of a rounded-out scale", () => {
		const row = bulletRow(340, { ranges: [150, 225, 300] });
		expect(row.domain.slice(0, 2)).toEqual([0, 400]);
		expect(row.bands[2]).toMatchObject({ from: 225, to: 400, endFraction: 1 });
	});

	it("uses a given domain as is, clamping the bar and the target", () => {
		const row = bulletRow(120, {
			target: -5,
			ranges: [40, 80],
			domain: [0, 100, 25],
		});
		expect(row.domain).toEqual([0, 100, 25]);
		expect(row.ticks).toEqual([0, 25, 50, 75, 100]);
		expect(row.measure?.to).toBe(100);
		expect(row.measure?.endFraction).toBe(1);
		expect(row.target).toEqual({ value: 0, fraction: 0 });
	});

	it("draws a negative value leftward from zero", () => {
		const row = bulletRow(-15, { target: 10, ranges: [0, 20] });
		expect(row.domain).toEqual([-20, 20, 10]);
		expect(row.baseline).toBe(0);
		expect(row.measure).toMatchObject({
			from: 0,
			to: -15,
			startFraction: 0.5,
			endFraction: 0.125,
		});
		// The first band starts at the scale's start, not at zero.
		expect(row.bands[0]).toMatchObject({ from: -20, to: 0 });
	});

	it("has no zero to grow from when the scale starts above it", () => {
		const row = bulletRow(270, { min: 200, ranges: [250, 300] });
		expect(row.zero).toBe(false);
		expect(row.baseline).toBe(200);
		expect(row.measure).toMatchObject({ from: 200, startFraction: 0 });
		// And an all-negative scale that stops short of zero starts at its top.
		const below = bulletRow(-50, { max: -10, min: -100 });
		expect(below.zero).toBe(false);
		expect(below.baseline).toBe(-10);
	});

	it("degrades on non-finite input", () => {
		const row = bulletRow(Number.NaN, {
			target: Number.NaN,
			ranges: [Number.NaN, 50, Number.POSITIVE_INFINITY],
		});
		expect(row.measure).toBeNull();
		expect(row.target).toBeNull();
		expect(row.domain).toEqual([0, 50, 10]);
		expect(row.bands.map((b) => [b.from, b.to])).toEqual([
			[0, 0],
			[0, 50],
			[50, 50],
		]);
		// An out-of-order threshold leaves an empty band, indices intact.
		const shuffled = bulletRow(10, { ranges: [60, 30, 100] });
		expect(shuffled.bands.map((b) => [b.index, b.from, b.to])).toEqual([
			[0, 0, 60],
			[1, 60, 60],
			[2, 60, 100],
		]);
		// A degenerate given domain is ignored in favour of the default.
		expect(bulletRow(5, { domain: [3, 3] }).domain.slice(0, 2)).toEqual([0, 5]);
		expect(bulletRow(5).bands).toEqual([]);
	});
});
