import { describe, expect, it } from "vitest";
import { polarAreaSlices } from "./polarArea.js";

describe("polarAreaSlices", () => {
	it("splits the turn evenly across n values, regardless of their size", () => {
		const slices = polarAreaSlices([1, 100, 1]);
		const sweeps = slices.map((slice) => slice.endAngle - slice.startAngle);
		expect(Math.abs(sweeps[0])).toBeCloseTo(Math.abs(sweeps[1]));
		expect(Math.abs(sweeps[1])).toBeCloseTo(Math.abs(sweeps[2]));
		expect(Math.abs(sweeps[0])).toBeCloseTo((2 * Math.PI) / 3);
	});

	it("scales radius linearly by share of maxValue", () => {
		const slices = polarAreaSlices([1, 2, 4]);
		expect(slices[0].radius).toBeCloseTo(0.25);
		expect(slices[1].radius).toBeCloseTo(0.5);
		expect(slices[2].radius).toBeCloseTo(1);
	});

	it("keeps a zero-value entry as a zero-radius wedge, not dropped", () => {
		const slices = polarAreaSlices([1, 0, 1]);
		expect(slices).toHaveLength(3);
		expect(slices[1].index).toBe(1);
		expect(slices[1].radius).toBeCloseTo(0);
	});

	it("returns [] for empty input", () => {
		expect(polarAreaSlices([])).toEqual([]);
	});

	it("clamps a negative value to 0 instead of throwing", () => {
		expect(() => polarAreaSlices([1, -5, 2])).not.toThrow();
		const slices = polarAreaSlices([1, -5, 2]);
		expect(slices[1].value).toBe(0);
		expect(slices[1].radius).toBeCloseTo(0);
	});

	it("sweeps counter-clockwise when clockwise is false", () => {
		const clockwise = polarAreaSlices([1, 1], { clockwise: true });
		const counterClockwise = polarAreaSlices([1, 1], { clockwise: false });
		expect(clockwise[0].endAngle - clockwise[0].startAngle).toBeLessThan(0);
		expect(
			counterClockwise[0].endAngle - counterClockwise[0].startAngle,
		).toBeGreaterThan(0);
	});

	it("defaults startAngle to Math.PI / 2 (12 o'clock on a y-up stage)", () => {
		const slices = polarAreaSlices([1, 1]);
		expect(slices[0].startAngle).toBeCloseTo(Math.PI / 2);
	});

	it("honours an explicit maxValue over the data's own max", () => {
		const slices = polarAreaSlices([1], { maxValue: 4 });
		expect(slices[0].radius).toBeCloseTo(0.25);
	});
});
