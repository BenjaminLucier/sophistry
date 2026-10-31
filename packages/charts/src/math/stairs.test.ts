import { describe, expect, it } from "vitest";
import { stairsPolyline } from "./stairs";

describe("stairsPolyline", () => {
	it("defaults edges to 0..n", () => {
		expect(stairsPolyline([1, 2])).toEqual([
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 2 },
			{ x: 2, y: 2 },
		]);
	});

	it("holds each value flat over its own edge span", () => {
		expect(stairsPolyline([5, 3], [0, 2, 5])).toEqual([
			{ x: 0, y: 5 },
			{ x: 2, y: 5 },
			{ x: 2, y: 3 },
			{ x: 5, y: 3 },
		]);
	});

	it("throws when edges doesn't have exactly one more entry than values", () => {
		expect(() => stairsPolyline([1, 2], [0, 1])).toThrow();
	});
});
