import { describe, expect, it } from "vitest";
import { barSlot } from "./bar.js";

describe("barSlot", () => {
	it("centres each bar in its slot", () => {
		const box = barSlot(0, 5, 0);
		expect(box).not.toBeNull();
		expect(((box?.x0 ?? 0) + (box?.x1 ?? 0)) / 2).toBeCloseTo(0.5);
	});

	it("sizes the bar to barWidth, independent of how many slots share the axis", () => {
		const box = barSlot(2, 5, 0, 0.6);
		expect(box).not.toBeNull();
		expect((box?.x1 ?? 0) - (box?.x0 ?? 0)).toBeCloseTo(0.6);
		expect(box?.x0).toBeCloseTo(2.2);
		expect(box?.x1).toBeCloseTo(2.8);
	});

	it("hangs a negative value below the baseline instead of drawing it inside out", () => {
		const box = barSlot(0, -5, 0);
		expect(box).not.toBeNull();
		expect(box?.y0).toBe(-5);
		expect(box?.y1).toBe(0);
	});

	it("returns null for a non-finite value", () => {
		expect(barSlot(0, Number.NaN, 0)).toBeNull();
	});
});
