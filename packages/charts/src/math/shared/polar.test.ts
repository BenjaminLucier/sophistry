import { describe, expect, it } from "vitest";
import { resolvePolarSweep, TAU } from "./polar.js";

describe("TAU", () => {
	it("is one full turn", () => {
		expect(TAU).toBeCloseTo(2 * Math.PI);
	});
});

describe("resolvePolarSweep", () => {
	it("defaults to 12 o'clock, clockwise", () => {
		expect(resolvePolarSweep(undefined)).toEqual({
			startAngle: Math.PI / 2,
			direction: -1,
		});
	});

	it("honors an explicit startAngle", () => {
		expect(resolvePolarSweep({ startAngle: 0 }).startAngle).toBe(0);
	});

	it("flips direction for clockwise: false", () => {
		expect(resolvePolarSweep({ clockwise: false }).direction).toBe(1);
	});
});
