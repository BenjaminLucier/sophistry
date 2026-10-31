import { describe, expect, it } from "vitest";
import { alignedRange, autoRange, fitRange } from "./range";

describe("autoRange", () => {
	it("always includes zero", () => {
		expect(autoRange([3, 7])).toEqual([0, 8, 2]);
		expect(autoRange([-7, -3])).toEqual([-8, 0, 2]);
	});

	it("rounds out to a nice step", () => {
		expect(autoRange([0, 42])).toEqual([0, 50, 10]);
	});

	it("collapses a zero-span series to [0, 1, 1]", () => {
		expect(autoRange([0])).toEqual([0, 1, 1]);
		expect(autoRange([])).toEqual([0, 1, 1]);
	});

	it("honors a custom targetTicks via options", () => {
		expect(autoRange([0, 42], { targetTicks: 2 })).not.toEqual(
			autoRange([0, 42]),
		);
	});

	it("ignores non-finite values", () => {
		expect(autoRange([Number.NaN, 3, Number.POSITIVE_INFINITY, 7])).toEqual([
			0, 8, 2,
		]);
	});
});

describe("fitRange", () => {
	it("fits the data's extent, rounded to a nice step, without forcing zero", () => {
		expect(fitRange([3.2, 8.9])).toEqual([2, 10, 2]);
		expect(fitRange([3.2, 8.9], { zero: true })).toEqual([0, 10, 2]);
	});

	it("leaves the ends alone with nice: false", () => {
		expect(fitRange([3.2, 8.9], { nice: false })).toEqual([3.2, 8.9]);
	});

	it("gives a lone value room either side", () => {
		const [min, max] = fitRange([5]);
		expect(min).toBeLessThan(5);
		expect(max).toBeGreaterThan(5);
	});

	it("keeps a lone value's zero side flush when zero is asked for", () => {
		expect(fitRange([5], { zero: true })[0]).toBe(0);
	});

	it("matches autoRange exactly for zero: true", () => {
		for (const values of [[3, 7], [-7, -3], [0, 42], [], [0]]) {
			expect(fitRange(values, { zero: true })).toEqual(autoRange(values));
		}
	});

	it("rounds log ranges out to whole decades and skips non-positive values", () => {
		expect(fitRange([2, 3000], { type: "log" })).toEqual([1, 10000]);
		expect(fitRange([0, -5, 10, 1000], { type: "log" })).toEqual([10, 1000]);
		expect(fitRange([], { type: "log" })).toEqual([1, 10]);
	});

	it("nices time ranges to calendar units", () => {
		const [start, end] = fitRange(
			[Date.UTC(2024, 0, 3), Date.UTC(2024, 10, 20)],
			{ type: "utc" },
		);
		expect(new Date(start).getUTCDate()).toBe(1);
		expect(new Date(end).getUTCDate()).toBe(1);
		expect(start).toBeLessThanOrEqual(Date.UTC(2024, 0, 3));
		expect(end).toBeGreaterThanOrEqual(Date.UTC(2024, 10, 20));
	});
});

describe("fitRange margin", () => {
	it("pads the extent by a fraction of its span before rounding", () => {
		// 0..10 on the nose: without a margin the extremes sit on the frame.
		expect(fitRange([0, 10], { nice: false })).toEqual([0, 10]);
		expect(fitRange([0, 10], { nice: false, margin: 0.05 })).toEqual([
			-0.5, 10.5,
		]);
	});

	it("keeps a zero baseline sticky", () => {
		expect(
			fitRange([2, 10], { nice: false, zero: true, margin: 0.05 }),
		).toEqual([0, 10.5]);
		expect(
			fitRange([-10, -2], { nice: false, zero: true, margin: 0.05 }),
		).toEqual([-10.5, 0]);
	});

	it("pads time ranges too, and ignores log", () => {
		const [low, high] = fitRange([0, 1000], {
			type: "utc",
			nice: false,
			margin: 0.1,
		});
		expect(low).toBe(-100);
		expect(high).toBe(1100);
		expect(fitRange([1, 100], { type: "log", margin: 0.5 })).toEqual([1, 100]);
	});
});

describe('fitRange nice: "tight"', () => {
	it("stops at the data when the next tick is most of a step away", () => {
		// Weeks 0–11: `true` runs on to 15, a quarter of the axis empty.
		expect(fitRange([0, 11])).toEqual([0, 15, 5]);
		expect(fitRange([0, 11], { nice: "tight" })).toEqual([0, 11, 5]);
	});

	it("rounds out to a tick within a quarter of a step", () => {
		expect(fitRange([0, 9.6], { nice: "tight" })).toEqual([0, 10, 2]);
		expect(fitRange([0.4, 9.6], { nice: "tight" })).toEqual([0, 10, 2]);
		// 7.4 is 0.3 of a step short of 8.
		expect(fitRange([0, 7.4], { nice: "tight" })).toEqual([0, 7.4, 2]);
	});

	it("keeps the step `true` chooses, and ends already on ticks", () => {
		expect(fitRange([3.2, 8.9], { nice: "tight" })).toEqual([3.2, 8.9, 2]);
		expect(fitRange([0, 8], { nice: "tight" })).toEqual(fitRange([0, 8]));
		expect(fitRange([3, 7], { zero: true, nice: "tight" })).toEqual([0, 7, 2]);
	});

	it("counts the slack in decades on a log scale", () => {
		expect(fitRange([2, 3000], { type: "log", nice: "tight" })).toEqual([
			2, 3000,
		]);
		const [low, high] = fitRange([1.2, 900], { type: "log", nice: "tight" });
		expect(low).toBe(1);
		expect(high).toBe(1000);
	});

	it("rounds a time axis out only to a near calendar tick", () => {
		const day = 86_400_000;
		const start = Date.UTC(2024, 0, 1);
		const [low, high] = fitRange([start, start + 9.5 * day], {
			type: "utc",
			nice: "tight",
		});
		expect(low).toBe(start);
		expect(high).toBe(start + 9.5 * day);
	});
});

describe("alignedRange", () => {
	const primary = [0, 80, 20] as const;
	const ticks = [0, 20, 40, 60, 80];

	it("puts the secondary's ticks on the primary's, with a nice step", () => {
		expect(
			alignedRange([...primary], ticks, [3.1, 18.2], { zero: true }),
		).toEqual([0, 20, 5]);
		// Four intervals either way: 0..80 by 20 and 0..2000 by 500.
		expect(alignedRange([...primary], ticks, [100, 1900])).toEqual([
			0, 2000, 500,
		]);
	});

	it("chooses the smallest step that covers the data", () => {
		// 2.5 × 10ⁿ is a nice step too.
		expect(alignedRange([...primary], ticks, [1, 9.5])).toEqual([0, 10, 2.5]);
		const [low, high, step] = alignedRange([...primary], ticks, [-3, 14]) ?? [];
		expect(step).toBe(5);
		expect(low).toBe(-5);
		expect(high).toBe(15);
	});

	it("matches the tick phase of a primary that does not start on a tick", () => {
		// Primary 5..95 ticking at 20, 40, 60, 80: ticks at fractions 1/6 + k·2/9.
		const range = alignedRange([5, 95], [20, 40, 60, 80], [0, 30]);
		expect(range).toBeDefined();
		const [low = 0, high = 0, step = 0] = range ?? [];
		const fraction = (v: number, a: number, b: number) => (v - a) / (b - a);
		for (const [i, t] of [20, 40, 60, 80].entries()) {
			const secondary = low + fraction(t, 5, 95) * (high - low);
			// Lands on a multiple of the step, in order.
			expect(secondary / step).toBeCloseTo(Math.round(secondary / step), 9);
			if (i > 0) expect(secondary).toBeGreaterThan(low);
		}
		expect(low).toBeLessThanOrEqual(0);
		expect(high).toBeGreaterThanOrEqual(30);
	});

	it("mirrors the phase for axes running opposite ways", () => {
		const same = alignedRange([0, 90], [0, 20, 40, 60, 80], [0, 9]);
		const opposite = alignedRange([0, 90], [0, 20, 40, 60, 80], [0, 9], {
			opposite: true,
		});
		expect(same).not.toEqual(opposite);
		const [low = 0, high = 0, step = 0] = opposite ?? [];
		// The primary's top tick (80) is 1/9 down from its top end, which the
		// opposite axis starts at: its lowest tick is 1/9 up.
		const first = low + (1 / 9) * (high - low);
		expect(first / step).toBeCloseTo(Math.round(first / step), 9);
	});

	it("needs two primary ticks", () => {
		expect(alignedRange([0, 1], [0], [0, 5])).toBeUndefined();
		expect(alignedRange([0, 0], [0, 1], [0, 5])).toBeUndefined();
	});
});
