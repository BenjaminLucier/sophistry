import { describe, expect, it } from "vitest";
import { INSIDE_LABEL_FADE, insideLabelFit, stackTotals } from "./barLabels";

const box = (minX: number, maxX: number, minY: number, maxY: number) => ({
	minX,
	maxX,
	minY,
	maxY,
});

describe("insideLabelFit", () => {
	const rest = box(0, 1, 0, 2);
	const size = { width: 0.4, height: 0.2 };

	it("shows a label that fits a bar at full length", () => {
		expect(insideLabelFit(rest, rest, size, 0.05, true)).toBe(1);
	});

	it("hides a label wider than the bar", () => {
		expect(
			insideLabelFit(rest, rest, { width: 0.95, height: 0.2 }, 0.05, true),
		).toBe(0);
	});

	it("hides a label on a segment too short for it, and a zero-length one", () => {
		const short = box(0, 1, 0, 0.25);
		expect(insideLabelFit(short, short, size, 0.05, true)).toBe(0);
		const flat = box(0, 1, 1, 1);
		expect(insideLabelFit(flat, flat, size, 0, true)).toBe(0);
	});

	it("fades in as a growing segment passes the label's length, never ahead of it", () => {
		const need = 0.2 + 2 * 0.05;
		expect(
			insideLabelFit(box(0, 1, 0, need * 0.9), rest, size, 0.05, true),
		).toBe(0);
		expect(insideLabelFit(box(0, 1, 0, need), rest, size, 0.05, true)).toBe(0);
		const half = need + (INSIDE_LABEL_FADE * need) / 2;
		expect(
			insideLabelFit(box(0, 1, 0, half), rest, size, 0.05, true),
		).toBeCloseTo(0.5);
		expect(insideLabelFit(box(0, 1, 0, 1.5), rest, size, 0.05, true)).toBe(1);
	});

	it("measures along x for horizontal bars", () => {
		const wide = box(0, 2, 0, 0.3);
		expect(insideLabelFit(wide, wide, size, 0.02, false)).toBe(1);
		const narrow = box(0, 0.3, 0, 0.3);
		expect(insideLabelFit(narrow, narrow, size, 0.02, false)).toBe(0);
	});
});

describe("stackTotals", () => {
	it("totals each category's stack on its outermost segment", () => {
		expect(stackTotals(["a", "a", "b"], [3, 5, 4], [3, 8, 4])).toEqual([
			{ total: 8, outer: false },
			{ total: 8, outer: true },
			{ total: 4, outer: true },
		]);
	});

	it("gives a diverging stack a total each way", () => {
		expect(
			stackTotals(["a", "a", "a", "a"], [3, -2, 5, -1], [3, -2, 8, -3]),
		).toEqual([
			{ total: 8, outer: false },
			{ total: -3, outer: false },
			{ total: 8, outer: true },
			{ total: -3, outer: true },
		]);
	});

	it("leaves zero and non-finite segments out", () => {
		expect(
			stackTotals(["a", "a", "a"], [0, Number.NaN, 2], [0, Number.NaN, 2]),
		).toEqual([undefined, undefined, { total: 2, outer: true }]);
	});

	it("tells number and string categories apart", () => {
		const totals = stackTotals([1, "1"], [2, 3], [2, 3]);
		expect(totals.map((t) => t?.total)).toEqual([2, 3]);
	});
});
