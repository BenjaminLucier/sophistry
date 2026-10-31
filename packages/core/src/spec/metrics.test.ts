import { describe, expect, it } from "vitest";
import { labelBox, measureLabel } from "./metrics";

const base = {
	fontFamily: "sans-serif",
	fontWeight: 500,
	italic: false,
	letterSpacing: 0,
};

describe("measureLabel is unit-agnostic", () => {
	it("scales linearly with font size, so scene-unit sizes measure like pixel ones", () => {
		const big = measureLabel("Hello", { ...base, fontSize: 64 });
		const small = measureLabel("Hello", { ...base, fontSize: 0.5 });
		const k = 0.5 / 64;
		expect(small.width).toBeCloseTo(big.width * k, 9);
		expect(small.ascent).toBeCloseTo(big.ascent * k, 9);
		expect(small.descent).toBeCloseTo(big.descent * k, 9);
	});

	it("letter spacing is in the same unit as the font size", () => {
		const plain = measureLabel("abcd", { ...base, fontSize: 2 });
		const spaced = measureLabel("abcd", {
			...base,
			fontSize: 2,
			letterSpacing: 0.25,
		});
		expect(spaced.width - plain.width).toBeCloseTo(4 * 0.25, 9);
	});

	it("is zero for empty text and non-positive sizes", () => {
		expect(measureLabel("", { ...base, fontSize: 1 }).width).toBe(0);
		expect(measureLabel("x", { ...base, fontSize: 0 }).width).toBe(0);
	});

	it("labelBox scales with the size too", () => {
		const a = labelBox("Hi", {
			...base,
			fontSize: 1,
			align: "center",
			baseline: "middle",
		});
		const b = labelBox("Hi", {
			...base,
			fontSize: 3,
			align: "center",
			baseline: "middle",
		});
		expect(b.maxX).toBeCloseTo(a.maxX * 3, 9);
		expect(b.maxY).toBeCloseTo(a.maxY * 3, 9);
	});
});
