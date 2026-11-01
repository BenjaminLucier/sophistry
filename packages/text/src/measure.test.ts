import { describe, expect, it } from "vitest";
import { intersect, isInk } from "./measure.js";

describe("intersect", () => {
	it("returns the overlap", () => {
		expect(
			intersect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 5, y: 5, width: 10, height: 10 },
			),
		).toEqual({ x: 5, y: 5, width: 5, height: 5 });
	});

	it("returns a zero-size rect (not null) when the rects miss", () => {
		const r = intersect(
			{ x: 0, y: 0, width: 1, height: 1 },
			{ x: 5, y: 5, width: 1, height: 1 },
		);
		expect(r).not.toBeNull();
		expect(r.width).toBe(0);
		expect(r.height).toBe(0);
	});
});

describe("isInk", () => {
	it("skips whitespace and the zero-width space KaTeX puts in every vlist", () => {
		expect(isInk("x")).toBe(true);
		expect(isInk("\u2212")).toBe(true);
		expect(isInk(" ")).toBe(false);
		expect(isInk("\u00a0")).toBe(false);
		expect(isInk("\u200b")).toBe(false);
		expect(isInk("\ufeff")).toBe(false);
	});
});
