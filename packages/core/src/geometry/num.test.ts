import { describe, expect, it } from "vitest";
import { boundsContain } from "./bounds";
import {
	clamp01,
	clampNonNegative,
	finiteExtent,
	finiteOrZero,
	finiteValues,
	hashUnit,
	isFinitePoint,
	linspace,
	maxOf,
	minOf,
	mix,
	mixPoint,
	polarPoint,
	TAU,
	wrapAngle,
} from "./num";
import { ringArea } from "./path/arclength";
import { distanceToSegment } from "./path/cubic";

describe("clamp01", () => {
	it("clamps to the unit interval and reads NaN as 0", () => {
		expect(clamp01(0.25)).toBe(0.25);
		expect(clamp01(-3)).toBe(0);
		expect(clamp01(7)).toBe(1);
		expect(clamp01(Number.NaN)).toBe(0);
		expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
		expect(Object.is(clamp01(-0), 0)).toBe(true);
	});
});

describe("mix / mixPoint", () => {
	it("is exact at, and pinned beyond, both ends", () => {
		expect(mix(1e16, 1, 1)).toBe(1);
		expect(mix(1e16, 1, 2)).toBe(1);
		expect(mix(3, 5, -1)).toBe(3);
		expect(mix(2, 4, 0.5)).toBe(3);
		expect(mix(2, 4, Number.NaN)).toBeNaN();
	});

	it("returns the endpoint objects themselves at the ends", () => {
		const a = { x: 0, y: 0 };
		const b = { x: 2, y: 4 };
		expect(mixPoint(a, b, 0)).toBe(a);
		expect(mixPoint(a, b, 1)).toBe(b);
		expect(mixPoint(a, b, 0.5)).toEqual({ x: 1, y: 2 });
	});
});

describe("finite helpers", () => {
	it("isFinitePoint rejects undefined and non-finite coordinates", () => {
		expect(isFinitePoint({ x: 1, y: 2 })).toBe(true);
		expect(isFinitePoint(undefined)).toBe(false);
		expect(isFinitePoint({ x: Number.NaN, y: 0 })).toBe(false);
		expect(isFinitePoint({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(false);
	});

	it("finiteOrZero keeps finite values, negatives included", () => {
		expect(finiteOrZero(-2)).toBe(-2);
		expect(finiteOrZero(undefined)).toBe(0);
		expect(finiteOrZero(Number.NaN)).toBe(0);
		expect(finiteOrZero(Number.NEGATIVE_INFINITY)).toBe(0);
	});

	it("maxOf / minOf / finiteValues / clampNonNegative", () => {
		expect(maxOf([1, 5, 3])).toBe(5);
		expect(maxOf([], 2)).toBe(2);
		expect(maxOf([])).toBe(Number.NEGATIVE_INFINITY);
		expect(minOf([4, -1, 2])).toBe(-1);
		expect(finiteValues([1, Number.NaN, 2, Number.POSITIVE_INFINITY])).toEqual([
			1, 2,
		]);
		expect(clampNonNegative(-1)).toBe(0);
		expect(clampNonNegative(Number.NaN)).toBe(0);
		expect(clampNonNegative(3)).toBe(3);
	});

	it("finiteExtent skips non-finite values and falls back when none remain", () => {
		expect(
			finiteExtent([3, Number.NaN, -2, 8, Number.POSITIVE_INFINITY]),
		).toEqual([-2, 8]);
		expect(finiteExtent([5])).toEqual([5, 5]);
		expect(finiteExtent([])).toEqual([0, 1]);
		expect(finiteExtent([Number.NaN], [-1, 1])).toEqual([-1, 1]);
		expect(finiteExtent([[1, 9], [-4]].flat())).toEqual([-4, 9]);
	});
});

describe("linspace", () => {
	it("spaces values evenly and lands exactly on stop", () => {
		expect(linspace(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
		expect(linspace(0.1, 0.7, 7).at(-1)).toBe(0.7);
		expect(linspace(3, 9, 1)).toEqual([3]);
		expect(linspace(0, 1, 0)).toEqual([]);
		expect(linspace(0, 1, Number.NaN)).toEqual([]);
		expect(linspace(2, 0, 3)).toEqual([2, 1, 0]);
	});
});

describe("angles", () => {
	it("TAU is a full turn", () => {
		expect(TAU).toBe(2 * Math.PI);
	});

	it("wrapAngle lands in [0, TAU)", () => {
		expect(wrapAngle(0)).toBe(0);
		expect(wrapAngle(TAU)).toBe(0);
		expect(wrapAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
		expect(wrapAngle(5 * Math.PI)).toBeCloseTo(Math.PI, 12);
		expect(wrapAngle(Number.NaN)).toBeNaN();
	});

	it("polarPoint matches the literal expression bit for bit", () => {
		for (const theta of [0, 0.3, 1.7, -2.2, 4]) {
			const at = polarPoint(1.5, -2, 3.25, theta);
			expect(at.x).toBe(1.5 + 3.25 * Math.cos(theta));
			expect(at.y).toBe(-2 + 3.25 * Math.sin(theta));
		}
	});
});

describe("hashUnit", () => {
	it("is deterministic, in [0, 1), and seed-sensitive", () => {
		const a = hashUnit("a1");
		expect(hashUnit("a1")).toBe(a);
		expect(a).toBeGreaterThanOrEqual(0);
		expect(a).toBeLessThan(1);
		expect(hashUnit("a1", 1)).not.toBe(a);
		expect(hashUnit("a2")).not.toBe(a);
	});
});

describe("path helpers shared from geometry/path/", () => {
	it("ringArea is the signed shoelace area", () => {
		const square = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 2 },
			{ x: 0, y: 2 },
		];
		expect(ringArea(square)).toBe(4);
		expect(ringArea([...square].reverse())).toBe(-4);
		expect(ringArea([])).toBe(0);
	});

	it("distanceToSegment clamps to the segment and handles a degenerate one", () => {
		const a = { x: 0, y: 0 };
		const b = { x: 4, y: 0 };
		expect(distanceToSegment({ x: 2, y: 3 }, a, b)).toBe(3);
		expect(distanceToSegment({ x: 7, y: 4 }, a, b)).toBe(5);
		expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
	});

	it("boundsContain includes edges and honours slop", () => {
		const box = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
		expect(boundsContain(box, { x: 1, y: 0 })).toBe(true);
		expect(boundsContain(box, { x: 1.1, y: 0.5 })).toBe(false);
		expect(boundsContain(box, { x: 1.1, y: 0.5 }, 0.2)).toBe(true);
	});
});
