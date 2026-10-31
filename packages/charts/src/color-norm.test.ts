import { divergingScale } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { colorNorm, normLevels } from "./color-norm";

describe("divergingScale", () => {
	it("puts the centre mid-way over an asymmetric range", () => {
		const scale = divergingScale([-2, 10], 0);
		expect(scale.toUnit(-2)).toBeCloseTo(0);
		expect(scale.toUnit(-1)).toBeCloseTo(0.25);
		expect(scale.toUnit(0)).toBeCloseTo(0.5);
		expect(scale.toUnit(5)).toBeCloseTo(0.75);
		expect(scale.toUnit(10)).toBeCloseTo(1);
		for (const t of [0, 0.2, 0.5, 0.8, 1])
			expect(scale.toUnit(scale.fromUnit(t))).toBeCloseTo(t);
	});

	it("ticks each half on its own, the centre among them", () => {
		const { majors } = divergingScale([-2, 10], 0).ticks?.(6) ?? {
			majors: [],
		};
		expect(majors).toContain(0);
		expect(majors[0]).toBe(-2);
		expect(majors.at(-1)).toBe(10);
		expect(majors.filter((v) => v < 0).length).toBeGreaterThan(0);
		expect([...majors].sort((a, b) => a - b)).toEqual(majors);
	});

	it("runs log halves around a ratio centre", () => {
		const scale = divergingScale([0.01, 10], 1, { kind: "log" });
		expect(scale.toUnit(0.1)).toBeCloseTo(0.25);
		expect(scale.toUnit(1)).toBeCloseTo(0.5);
		expect(scale.toUnit(10)).toBeCloseTo(1);
		expect(scale.ticks?.().majors).toEqual([0.01, 0.1, 1, 10]);
	});

	it("maps a flat half's one value to the middle", () => {
		const scale = divergingScale([0, 4], 0);
		expect(scale.toUnit(0)).toBe(0.5);
		expect(scale.toUnit(4)).toBeCloseTo(1);
	});
});

describe("colorNorm", () => {
	it("is undefined for the default linear norm", () => {
		expect(colorNorm([1, 2], {})).toBeUndefined();
		expect(colorNorm([1, 2], { rampScale: "linear" })).toBeUndefined();
	});

	it("log: positive extent, non-positive values missing", () => {
		const norm = colorNorm([-5, 0, 1, 10, 100, Number.NaN], {
			rampScale: "log",
		});
		expect(norm?.domain).toEqual([1, 100]);
		expect(norm?.unit(10)).toBeCloseTo(0.5);
		expect(norm?.unit(0)).toBeNaN();
		expect(norm?.unit(-5)).toBeNaN();
		expect(norm?.unit(Number.NaN)).toBeNaN();
		// A non-positive rampMin is ignored; a positive one is kept.
		expect(
			colorNorm([1, 100], { rampScale: "log", rampMin: 0 })?.domain,
		).toEqual([1, 100]);
		expect(
			colorNorm([1, 100], { rampScale: "log", rampMin: 10 })?.domain,
		).toEqual([10, 100]);
	});

	it("symlog spans zero and negatives", () => {
		const norm = colorNorm([-100, 0, 100], { rampScale: "symlog" });
		expect(norm?.domain).toEqual([-100, 100]);
		expect(norm?.unit(0)).toBeCloseTo(0.5);
		expect(norm?.unit(10)).toBeGreaterThan(0.75);
	});

	it("rampMidpoint without rampMin/rampMax is symmetric about the centre", () => {
		const norm = colorNorm([-2, 10], { rampMidpoint: 0 });
		expect(norm?.domain).toEqual([-10, 10]);
		expect(norm?.unit(0)).toBeCloseTo(0.5);
		expect(norm?.unit(5)).toBeCloseTo(0.75);
	});

	it("rampMidpoint with rampMin/rampMax is two-slope", () => {
		const norm = colorNorm([-2, 10], {
			rampMidpoint: 0,
			rampMin: -2,
			rampMax: 10,
		});
		expect(norm?.domain).toEqual([-2, 10]);
		expect(norm?.unit(-1)).toBeCloseTo(0.25);
		expect(norm?.unit(5)).toBeCloseTo(0.75);
		// One end from the data, the other given.
		expect(
			colorNorm([-2, 10], { rampMidpoint: 0, rampMax: 4 })?.domain,
		).toEqual([-2, 4]);
		// A data end short of the centre is mirrored from the given one.
		expect(colorNorm([3, 10], { rampMidpoint: 0, rampMax: 4 })?.domain).toEqual(
			[-4, 4],
		);
	});

	it("rampMidpoint on a log norm is symmetric in ratio", () => {
		const norm = colorNorm([0.25, 2], { rampScale: "log", rampMidpoint: 1 });
		expect(norm?.domain[0]).toBeCloseTo(0.25);
		expect(norm?.domain[1]).toBeCloseTo(4);
		expect(norm?.unit(1)).toBeCloseTo(0.5);
		expect(norm?.unit(2)).toBeCloseTo(0.75);
	});
});

describe("normLevels", () => {
	it("spaces a count geometrically on a log norm", () => {
		const norm = colorNorm([1, 1000], { rampScale: "log" });
		if (!norm) throw new Error("expected a norm");
		const cover = normLevels(norm, 4, "cover");
		expect(cover[0]).toBe(1);
		expect(cover[1]).toBeCloseTo(10);
		expect(cover[2]).toBeCloseTo(100);
		expect(cover[3]).toBe(1000);
		const between = normLevels(norm, 2, "between");
		expect(between[0]).toBeCloseTo(10);
		expect(between[1]).toBeCloseTo(100);
	});

	it("splits a centred count evenly either side", () => {
		const norm = colorNorm([-2, 10], {
			rampMidpoint: 0,
			rampMin: -2,
			rampMax: 10,
		});
		if (!norm) throw new Error("expected a norm");
		const levels = normLevels(norm, 5, "cover");
		expect(levels.map((v) => Number(v.toFixed(6)))).toEqual([-2, -1, 0, 5, 10]);
	});
});
