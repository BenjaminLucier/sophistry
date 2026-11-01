import { describe, expect, it, vi } from "vitest";
import { mixColor, toCss } from "../color/index.js";
import * as parse from "../color/parse.js";
import { cssColorInterpolator } from "./interpolators.js";

vi.mock("../color/parse.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../color/parse.js")>();
	return { ...actual, parseColor: vi.fn(actual.parseColor) };
});

describe("cssColorInterpolator hot path", () => {
	it("parses each endpoint once when built, never per sample", () => {
		const parseColor = vi.mocked(parse.parseColor);
		for (const colorSpace of ["rgb", "hsl", "oklch"] as const) {
			parseColor.mockClear();
			const sample = cssColorInterpolator(colorSpace)("#3b4cc0", "#b40426");
			expect(parseColor).toHaveBeenCalledTimes(2);
			for (let i = 0; i <= 100; i++) sample(i / 100);
			expect(parseColor).toHaveBeenCalledTimes(2);
		}
	});

	it("produces the same strings as toCss(mixColor(...)) in every space", () => {
		const pairs: [string, string][] = [
			["#3b4cc0", "#b40426"],
			["#ff0010", "#ff00f0"],
			["#808080", "#ff0000"],
			["#000000", "#ffffff"],
		];
		for (const colorSpace of ["rgb", "hsl", "oklch"] as const) {
			for (const [a, b] of pairs) {
				const sample = cssColorInterpolator(colorSpace)(a, b);
				for (const t of [0, 0.2, 0.5, 0.77, 1]) {
					expect(sample(t)).toBe(toCss(mixColor(a, b, t, { colorSpace })));
				}
			}
		}
	});
});
