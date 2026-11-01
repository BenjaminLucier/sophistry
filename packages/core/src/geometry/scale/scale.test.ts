import { scaleLinear } from "d3-scale";
import { describe, expect, it } from "vitest";
import {
	currentRange,
	interpolateRange,
	isRangeTransition,
	transitionTicks,
} from "./range-transition.js";
import type { Range, ScaleSpec } from "./scales.js";
import {
	linearScale,
	logScale,
	powScale,
	resolveScale,
	sqrtScale,
	symlogScale,
	timeScale,
} from "./scales.js";
import type { TickFormatterSpec } from "./tick-format.js";
import {
	formatSpecifier,
	formatTick,
	resolveTickFormatter,
	tickFormatters,
} from "./tick-format.js";
import {
	axisTicks,
	logTicks,
	niceStep,
	thinTickLabels,
	tickStep,
	tickValues,
} from "./ticks.js";

describe("linearScale", () => {
	it("toUnit/fromUnit are inverses at the endpoints", () => {
		const s = linearScale([0, 10]);
		expect(s.toUnit(0)).toBe(0);
		expect(s.toUnit(10)).toBe(1);
		expect(s.fromUnit(0)).toBe(0);
		expect(s.fromUnit(1)).toBe(10);
	});

	it("values outside the range map outside 0..1 rather than clamping", () => {
		const s = linearScale([0, 10]);
		expect(s.toUnit(20)).toBe(2);
		expect(s.toUnit(-10)).toBe(-1);
	});

	it("degenerate range (min===max) collapses to fraction 0", () => {
		const s = linearScale([5, 5]);
		expect(s.toUnit(5)).toBe(0);
		expect(s.toUnit(100)).toBe(0);
	});

	it("round-trips an arbitrary value", () => {
		const s = linearScale([-3, 7]);
		for (const v of [-3, 0, 2.5, 7, 12]) {
			expect(s.fromUnit(s.toUnit(v))).toBeCloseTo(v, 9);
		}
	});

	it("matches d3's scaleLinear bit for bit, ascending and descending", () => {
		const values = [-1e9, -3.3, -0, 0, 0.1, 1 / 3, 2.5, 7, 12, Infinity];
		for (const range of [
			[-3, 7],
			[0.1, 0.30000000000000004],
			[7, -3],
			[1e-12, 1e12],
		] as const) {
			const ours = linearScale([range[0], range[1]]);
			const d3 = scaleLinear().domain(range).range([0, 1]);
			for (const v of values) {
				expect(Object.is(ours.toUnit(v), d3(v))).toBe(true);
				expect(Object.is(ours.fromUnit(v), d3.invert(v))).toBe(true);
			}
		}
	});
});

describe("logScale", () => {
	it("endpoints map to fraction 0 and 1", () => {
		const s = logScale([1, 1000]);
		expect(s.toUnit(1)).toBeCloseTo(0, 9);
		expect(s.toUnit(1000)).toBeCloseTo(1, 9);
	});

	it("fromUnit inverts toUnit", () => {
		const s = logScale([1, 1000]);
		for (const v of [1, 10, 100, 1000]) {
			expect(s.fromUnit(s.toUnit(v))).toBeCloseTo(v, 6);
		}
	});

	it("non-positive domain value returns NaN, not a clamp", () => {
		const s = logScale([1, 1000]);
		expect(Number.isNaN(s.toUnit(0))).toBe(true);
		expect(Number.isNaN(s.toUnit(-5))).toBe(true);
	});

	it("a range that isn't wholly positive degenerates to fraction 0 everywhere", () => {
		const s = logScale([-1, 100]);
		expect(s.toUnit(50)).toBe(0);
		expect(s.toUnit(1)).toBe(0);
	});

	it("base <= 1 degenerates safely", () => {
		const s = logScale([1, 100], 1);
		expect(s.toUnit(10)).toBe(0);
		expect(Number.isFinite(s.fromUnit(0.5))).toBe(true);
	});
});

describe("resolveScale", () => {
	it("defaults to linear", () => {
		const s = resolveScale(undefined, [0, 10]);
		expect(s.toUnit(5)).toBeCloseTo(0.5, 9);
	});

	it("'log' resolves to a log scale", () => {
		const s = resolveScale("log", [1, 100]);
		expect(s.toUnit(10)).toBeCloseTo(0.5, 9);
	});

	it("a custom Scale object passes through unchanged", () => {
		const custom = { toUnit: () => 0.42, fromUnit: () => 7 };
		const s = resolveScale(custom, [0, 10]);
		expect(s).toBe(custom);
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() => resolveScale("nonexistent" as ScaleSpec, [0, 10])).toThrow(
			/Unknown scale "nonexistent"/,
		);
	});

	it("a custom scale is passed as a value, unchanged", () => {
		const custom = { toUnit: () => 0.9, fromUnit: () => 1 };
		expect(resolveScale(custom, [0, 10])).toBe(custom);
	});
});

describe("logTicks", () => {
	it("majors are the decades within range", () => {
		const { majors } = logTicks([1, 1000]);
		expect(majors).toEqual([1, 10, 100, 1000]);
	});

	it("minors are the 2..base-1 multiples within each decade", () => {
		const { minors } = logTicks([1, 10]);
		expect(minors).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it("clips to a range that starts mid-decade", () => {
		const { majors } = logTicks([3, 400]);
		expect(majors).toEqual([10, 100]);
	});

	it("inside one decade, the multiples are majors (all within 0.4 of a decade)", () => {
		expect(logTicks([40, 100])).toEqual({
			majors: [40, 50, 60, 70, 80, 90, 100],
			minors: [],
		});
	});

	it("over most of a decade, the 1, 2, 3 and 5 multiples carry numbers", () => {
		expect(logTicks([15, 90])).toEqual({
			majors: [20, 30, 50],
			minors: [40, 60, 70, 80, 90],
		});
		// One decade in view: still labelled around it.
		expect(logTicks([3, 40]).majors).toEqual([3, 5, 10, 20, 30]);
		expect(logTicks([0.2, 0.9]).majors).toEqual([0.2, 0.3, 0.5]);
	});

	it("a window with fewer than three multiples falls back to uniform ticks", () => {
		expect(logTicks([21, 29])).toEqual({
			majors: [22, 24, 26, 28],
			minors: [],
		});
		expect(logTicks([4.1, 4.9]).majors).toEqual([4.2, 4.4, 4.6, 4.8]);
		// Base 2 has no multiples between its powers.
		expect(logTicks([5, 7], { base: 2 }).majors.length).toBeGreaterThan(2);
	});

	it("two decades in view keep the decades as the only majors", () => {
		expect(logTicks([10, 100]).majors).toEqual([10, 100]);
		expect(logTicks([9, 110]).majors).toEqual([10, 100]);
	});

	it("invalid range (non-positive) returns empty", () => {
		expect(logTicks([-1, 10])).toEqual({ majors: [], minors: [] });
		expect(logTicks([0, 10])).toEqual({ majors: [], minors: [] });
	});
});

describe("niceStep", () => {
	it("picks 1/2/5 * power-of-ten steps", () => {
		expect(niceStep(10, 10)).toBe(1);
		expect(niceStep(100, 10)).toBe(10);
	});

	it("non-finite or non-positive span falls back to 1", () => {
		expect(niceStep(0)).toBe(1);
		expect(niceStep(Number.NaN)).toBe(1);
		expect(niceStep(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe("tickStep", () => {
	it("uses the range's own step when present", () => {
		expect(tickStep([0, 10, 2])).toBe(2);
	});

	it("options.step overrides the range's step", () => {
		expect(tickStep([0, 10, 2], { step: 5 })).toBe(5);
	});

	it("falls back to niceStep when no step is given", () => {
		expect(tickStep([0, 100])).toBe(niceStep(100, undefined));
	});

	it("ignores a non-positive explicit step", () => {
		expect(tickStep([0, 10, -1])).toBeGreaterThan(0);
	});
});

describe("tickValues", () => {
	it("includes 0 when it's in range, even for an asymmetric range", () => {
		const ticks = tickValues([-3.5, 3.5, 1]);
		expect(ticks).toContain(0);
	});

	it("first and last ticks are within [min,max]", () => {
		// The leading tick can come back as -0 (an artefact of `Math.ceil` on a
		// value nudged just below 0 by the epsilon slack) — numerically still 0,
		// so compare with `+` rather than `toEqual`'s -0-sensitive matcher.
		const ticks = tickValues([0, 10, 2]);
		expect(ticks.map((t) => t + 0)).toEqual([0, 2, 4, 6, 8, 10]);
	});

	it("has no floating point drift for a repeating step", () => {
		const ticks = tickValues([0, 10, 0.1]);
		expect(ticks[ticks.length - 1]).toBe(10);
		expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
	});

	it("a non-positive explicit step is ignored in favour of a nice step", () => {
		// `step: 0` is falsy but not `undefined`, so `tickStep`'s `?? range[2]`
		// still picks it up as "explicit" — the `explicit > 0` guard is what
		// actually rejects it and falls through to `niceStep`.
		expect(tickValues([0, 10, 0]).length).toBeGreaterThan(0);
	});

	it("returns empty when min/max non-finite", () => {
		expect(tickValues([Number.NaN, 10, 1])).toEqual([]);
	});

	it("caps the count via limit/stride for a huge span", () => {
		const ticks = tickValues([0, 1, 1e-6], { limit: 10 });
		expect(ticks.length).toBeLessThanOrEqual(11);
	});

	it("handles reversed min/max", () => {
		const ticks = tickValues([10, 0, 2]);
		expect(ticks.map((t) => t + 0)).toEqual([0, 2, 4, 6, 8, 10]);
	});
});

describe("formatTick", () => {
	it("negative zero prints as '0'", () => {
		expect(formatTick(-0)).toBe("0");
	});

	it("integers print with no decimal point", () => {
		expect(formatTick(5)).toBe("5");
	});

	it("non-integers print as short as possible", () => {
		expect(formatTick(0.5)).toBe("0.5");
	});

	it("rounds away representation noise", () => {
		expect(formatTick(0.1 + 0.2)).toBe("0.3");
	});

	it("decimalPlaces forces a fixed width, trailing zeros included", () => {
		expect(formatTick(1, 2)).toBe("1.00");
		expect(formatTick(1.5, 3)).toBe("1.500");
	});

	it("decimalPlaces is clamped to [0,20]", () => {
		expect(formatTick(1, -5)).toBe("1");
		expect(() => formatTick(1, 100)).not.toThrow();
	});
});

describe("tickFormatters", () => {
	it("'plain' is formatTick itself", () => {
		expect(tickFormatters.plain).toBe(formatTick);
	});

	it("'si' scales by the nearest power of a thousand", () => {
		expect(tickFormatters.si(1500)).toBe("1.5k");
		expect(tickFormatters.si(0.0025)).toBe("2.5m");
		expect(tickFormatters.si(0)).toBe("0");
		expect(tickFormatters.si(2_500_000)).toBe("2.5M");
	});

	it("'scientific' writes mantissa e exponent", () => {
		expect(tickFormatters.scientific(1500)).toBe("1.50e3");
		expect(tickFormatters.scientific(0.0025)).toBe("2.50e-3");
		expect(tickFormatters.scientific(0)).toBe("0");
	});

	it("'percent' scales by 100 and appends %", () => {
		expect(tickFormatters.percent(0.5)).toBe("50%");
		expect(tickFormatters.percent(1)).toBe("100%");
	});

	it("'piMultiple' recognises clean fractions of pi", () => {
		expect(tickFormatters.piMultiple(0)).toBe("0");
		expect(tickFormatters.piMultiple(Math.PI)).toBe("π");
		expect(tickFormatters.piMultiple(Math.PI / 2)).toBe("π/2");
		expect(tickFormatters.piMultiple((2 * Math.PI) / 3)).toBe("2π/3");
		expect(tickFormatters.piMultiple((3 * Math.PI) / 2)).toBe("3π/2");
		expect(tickFormatters.piMultiple(-Math.PI / 2)).toBe("-π/2");
		expect(tickFormatters.piMultiple(2 * Math.PI)).toBe("2π");
	});

	it("'piMultiple' falls back to plain formatting for a non-pi value", () => {
		expect(tickFormatters.piMultiple(1)).toBe(formatTick(1));
	});
});

describe("resolveTickFormatter", () => {
	it("defaults to 'plain' when undefined", () => {
		expect(resolveTickFormatter(undefined)).toBe(tickFormatters.plain);
	});

	it("resolves a built-in name", () => {
		expect(resolveTickFormatter("si")).toBe(tickFormatters.si);
	});

	it("passes a function straight through", () => {
		const custom = (value: number) => `${value}!`;
		expect(resolveTickFormatter(custom)).toBe(custom);
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() =>
			resolveTickFormatter("nonexistent" as TickFormatterSpec),
		).toThrow(/Unknown tick formatter "nonexistent"/);
	});

	it("a custom formatter is passed as a value, unchanged", () => {
		const mine = (value: number) => `#${value}`;
		expect(resolveTickFormatter(mine)).toBe(mine);
	});
});

describe("tick formatting and generation edge cases", () => {
	it("never prints a negative zero", () => {
		expect(formatTick(-0.0001, 2)).toBe("0.00");
		expect(formatTick(-0.0000001)).toBe("0");
	});

	it("si chooses the prefix after rounding", () => {
		const si = tickFormatters.si;
		expect(si(999999, 0)).toBe("1M");
		expect(si(999.6, 0)).toBe("1k");
		expect(si(1500)).toBe("1.5k");
	});

	it("tiny steps keep distinct ticks without -0", () => {
		const ticks = tickValues([-2e-13, 2e-13, 1e-13]);
		expect(new Set(ticks).size).toBe(ticks.length);
		expect(ticks.length).toBe(5);
		expect(ticks.some((t) => Object.is(t, -0))).toBe(false);
	});

	it("logTicks minors are snapped", () => {
		const { minors } = logTicks([0.1, 1]);
		expect(minors).toContain(0.3);
	});
});

describe("powScale / sqrtScale", () => {
	it("maps through the power, so a sqrt axis gives area-proportional size", () => {
		const s = sqrtScale([0, 100]);
		expect(s.toUnit(25)).toBeCloseTo(0.5, 9);
		expect(s.fromUnit(0.5)).toBeCloseTo(25, 9);
	});

	it("keeps the sign of negatives (d3's mirrored power)", () => {
		const s = powScale([-4, 4], 0.5);
		expect(s.toUnit(-4)).toBeCloseTo(0, 9);
		expect(s.toUnit(0)).toBeCloseTo(0.5, 9);
	});

	it("collapses a degenerate range to fraction 0", () => {
		expect(powScale([3, 3], 2).toUnit(3)).toBe(0);
		expect(powScale([0, 1], 0).toUnit(0.5)).toBe(0);
	});
});

describe("symlogScale", () => {
	it("is defined through zero and symmetric about it", () => {
		const s = symlogScale([-1000, 1000]);
		expect(s.toUnit(0)).toBeCloseTo(0.5, 9);
		expect(s.toUnit(-100)).toBeCloseTo(1 - s.toUnit(100), 9);
		// log-like far out: 100 sits well past a linear 0.55
		expect(s.toUnit(100)).toBeGreaterThan(0.8);
	});
});

describe("timeScale", () => {
	const jan = Date.UTC(2024, 0, 1);
	const dec = Date.UTC(2024, 11, 31);

	it("maps epoch milliseconds linearly", () => {
		const s = timeScale([jan, dec]);
		expect(s.toUnit(jan)).toBe(0);
		expect(s.toUnit(dec)).toBe(1);
		expect(s.fromUnit(0)).toBe(jan);
	});

	it("ticks on calendar boundaries, written as dates, in UTC by default", () => {
		const s = timeScale([jan, dec]);
		const majors = s.ticks?.().majors ?? [];
		expect(majors.length).toBeGreaterThan(2);
		for (const t of majors) {
			const d = new Date(t);
			expect(d.getUTCDate()).toBe(1);
			expect(d.getUTCHours()).toBe(0);
		}
		expect(s.tickFormat?.(jan)).toBe("2024");
		expect(s.tickFormat?.(Date.UTC(2024, 2, 1))).toBe("March");
	});

	it("has no ticks over a degenerate range", () => {
		expect(timeScale([jan, jan]).ticks?.()).toEqual({ majors: [], minors: [] });
	});

	it("resolves by name", () => {
		expect(resolveScale("utc", [jan, dec]).tickFormat?.(jan)).toBe("2024");
		expect(resolveScale("sqrt", [0, 100]).toUnit(25)).toBeCloseTo(0.5, 9);
		expect(resolveScale("symlog", [-10, 10]).toUnit(0)).toBeCloseTo(0.5, 9);
	});
});

describe("axisTicks", () => {
	it("uniform steps with minors between majors on a linear scale", () => {
		const ticks = axisTicks(linearScale([0, 2]), [0, 2, 1], {
			minorTickCount: 1,
		});
		expect(ticks.majors).toEqual([0, 1, 2]);
		expect(ticks.minors).toEqual([0.5, 1.5]);
	});

	it("defers to a scale's own ticks (log decades)", () => {
		const ticks = axisTicks(logScale([1, 1000]), [1, 1000]);
		expect(ticks.majors).toEqual([1, 10, 100, 1000]);
		expect(ticks.minors.length).toBeGreaterThan(0);
	});

	it("minorTickCount 0 drops a scale's own minors", () => {
		expect(
			axisTicks(logScale([1, 1000]), [1, 1000], { minorTickCount: 0 }).minors,
		).toEqual([]);
	});

	it("a log scale object (not just the name) now carries its decades", () => {
		expect(logScale([1, 100]).ticks?.().majors).toEqual([1, 10, 100]);
	});
});

describe("thinTickLabels", () => {
	it("keeps everything that fits", () => {
		expect(thinTickLabels([0, 2, 4], [1, 1, 1])).toEqual([0, 1, 2]);
	});

	it("halves by parity until neighbours clear, always keeping the first", () => {
		// 1 apart, 1.5 wide: every second label leaves 2 apart, which clears.
		expect(thinTickLabels([0, 1, 2, 3, 4], [1.5, 1.5, 1.5, 1.5, 1.5])).toEqual([
			0, 2, 4,
		]);
		// 3 wide needs every fourth.
		expect(thinTickLabels([0, 1, 2, 3, 4, 5], [3, 3, 3, 3, 3, 3])).toEqual([
			0, 4,
		]);
	});

	it("counts the requested gap", () => {
		expect(thinTickLabels([0, 2, 4], [1.8, 1.8, 1.8], 0.5)).toEqual([0, 2]);
	});

	it("handles nothing and one", () => {
		expect(thinTickLabels([], [])).toEqual([]);
		expect(thinTickLabels([3], [100])).toEqual([0]);
	});
});

describe("interpolateRange", () => {
	it("is from at 0, to at 1, and a lerp of the ends between on a linear axis", () => {
		expect(interpolateRange([0, 10], [0, 100], 0)).toEqual([0, 10]);
		expect(interpolateRange([0, 10], [0, 100], 1)).toEqual([0, 100]);
		const mid = interpolateRange([0, 10], [-20, 100], 0.5);
		expect(mid[0]).toBeCloseTo(-10);
		expect(mid[1]).toBeCloseTo(55);
		expect(interpolateRange([0, 10], [0, 100], 2)).toEqual([0, 100]);
	});

	it("is geometric on a log axis", () => {
		const mid = interpolateRange([1, 10], [1, 1000], 0.5, "log");
		expect(mid[0]).toBeCloseTo(1);
		expect(mid[1]).toBeCloseTo(100);
	});

	it("keeps a step only when both ends share it", () => {
		expect(interpolateRange([0, 10, 2], [0, 20, 2], 0.5)).toHaveLength(3);
		expect(interpolateRange([0, 10, 2], [0, 20, 5], 0.5)).toHaveLength(2);
	});

	it("currentRange passes a plain range through", () => {
		const range: Range = [3, 4];
		expect(currentRange(range)).toBe(range);
		expect(isRangeTransition(range)).toBe(false);
		expect(currentRange({ from: [0, 1], to: [0, 3], t: 0.5 })[1]).toBeCloseTo(
			2,
		);
	});
});

describe("transitionTicks", () => {
	it("keeps shared ticks whole, fades old-only out and new-only in", () => {
		expect(transitionTicks([0, 5, 10], [0, 10, 20], 0.25, [0, 12.5])).toEqual([
			{ value: 0, weight: 1 },
			{ value: 5, weight: 0.75 },
			{ value: 10, weight: 1 },
		]);
		expect(transitionTicks([0, 5, 10], [0, 10, 20], 0.75, [0, 20])).toEqual([
			{ value: 0, weight: 1 },
			{ value: 5, weight: 0.25 },
			{ value: 10, weight: 1 },
			{ value: 20, weight: 0.75 },
		]);
	});

	it("draws exactly the end axes at t = 0 and t = 1", () => {
		const from = [0, 1, 2, 3];
		const to = [0, 2, 4, 6];
		expect(transitionTicks(from, to, 0, [0, 3]).map((t) => t.value)).toEqual(
			from,
		);
		expect(transitionTicks(from, to, 1, [0, 6]).map((t) => t.value)).toEqual(
			to,
		);
	});

	it("matches values across float noise", () => {
		const ticks = transitionTicks([0.30000000000000004], [0.3], 0.5, [0, 1]);
		expect(ticks).toHaveLength(1);
		expect(ticks[0].weight).toBe(1);
	});
});

describe("format strings", () => {
	it("reads a d3-format specifier", () => {
		expect(formatSpecifier(",.2f")(1234.5)).toBe("1,234.50");
		expect(formatSpecifier(".0%")(0.25)).toBe("25%");
		// An SI specifier shares one prefix across the axis, as d3's axes do.
		expect(formatSpecifier("$.2s", { range: [0, 2000] })(1500)).toBe("$1.50k");
	});

	it("takes its precision from the axis when the specifier names none", () => {
		expect(formatSpecifier(",", { range: [0, 1], count: 10 })(0.5)).toBe("0.5");
		expect(formatSpecifier(",f", { range: [0, 20000], count: 4 })(15000)).toBe(
			"15,000",
		);
	});

	it("reads a time format on a time axis", () => {
		const at = Date.UTC(2024, 2, 15);
		expect(
			formatSpecifier("%b %Y", { scale: "utc", range: [at, at + 1e10] })(at),
		).toBe("Mar 2024");
	});

	it("resolveTickFormatter: names first, then specifiers, else the names' error", () => {
		expect(resolveTickFormatter("percent")(0.5)).toBe(
			tickFormatters.percent(0.5),
		);
		expect(resolveTickFormatter(".1f")(2)).toBe("2.0");
		expect(() => resolveTickFormatter("not a format")).toThrow(/percent/);
	});
});
