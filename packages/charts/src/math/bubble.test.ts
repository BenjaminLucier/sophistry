import { describe, expect, it } from "vitest";
import { bubbleRadiusScale } from "./bubble";

describe("bubbleRadiusScale", () => {
	it("maps the max value to maxRadius", () => {
		const radii = bubbleRadiusScale([1, 4, 9], { maxRadius: 3 });
		expect(radii[2]).toBeCloseTo(3);
	});

	it("maps 0 to minRadius", () => {
		const radii = bubbleRadiusScale([0, 4], { minRadius: 0.5, maxRadius: 2 });
		expect(radii[0]).toBeCloseTo(0.5);
	});

	it("scales by area (sqrt), not linearly", () => {
		// Half the value should NOT be half the radius.
		const radii = bubbleRadiusScale([1, 4], { maxRadius: 1 });
		expect(radii[0]).toBeCloseTo(0.5);
		expect(radii[0]).not.toBeCloseTo(0.25);
	});

	it("clamps a negative or non-finite value to 0 instead of throwing", () => {
		expect(() => bubbleRadiusScale([1, -5, Number.NaN])).not.toThrow();
		const radii = bubbleRadiusScale([1, -5, Number.NaN], { minRadius: 0.2 });
		expect(radii[1]).toBeCloseTo(0.2);
		expect(radii[2]).toBeCloseTo(0.2);
	});

	it("falls back to minRadius for every value when all are zero", () => {
		const radii = bubbleRadiusScale([0, 0], { minRadius: 0.3 });
		expect(radii).toEqual([0.3, 0.3]);
	});

	it("returns [] for empty input", () => {
		expect(bubbleRadiusScale([])).toEqual([]);
	});

	it("honours an explicit maxValue over the data's own max", () => {
		const radii = bubbleRadiusScale([1], { maxValue: 4, maxRadius: 2 });
		expect(radii[0]).toBeCloseTo(1);
	});
});

describe("bubbleRadiusScale defaults", () => {
	it("makes area strictly proportional to value (no radius offset by default)", () => {
		const radii = bubbleRadiusScale([1, 2, 4, 0]);
		const areas = radii.map((r) => r * r);
		expect(areas[1] / areas[0]).toBeCloseTo(2);
		expect(areas[2] / areas[0]).toBeCloseTo(4);
		expect(radii[3]).toBe(0);
	});
});
