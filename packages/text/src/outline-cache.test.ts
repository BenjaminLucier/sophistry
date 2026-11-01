/**
 * `latexOutline` memoises per formula, but boundedly: a `<MathTex>` tracking a
 * live value typesets a new formula per frame, and an unbounded map would keep
 * every one of them forever. Typesetting is faked as never settling, so every
 * entry stays in flight and only the LRU can remove it.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("./measure.js", () => ({
	HOST_FONT_SIZE: 100,
	measureLatex: vi.fn(() => new Promise(() => {})),
}));

import {
	latexOutline,
	OUTLINE_CACHE_LIMIT,
	outlineCacheSize,
} from "./outline.js";

describe("latexOutline cache", () => {
	it("shares one promise per formula", () => {
		expect(latexOutline("x^2")).toBe(latexOutline("x^2"));
		expect(latexOutline("x^2")).not.toBe(
			latexOutline("x^2", { displayMode: false }),
		);
	});

	it("stays bounded under churn and keeps recently used formulas", () => {
		const stable = latexOutline("\\pi");
		const firstChurn = latexOutline("0");
		for (let i = 1; i < OUTLINE_CACHE_LIMIT * 3; i++) {
			latexOutline(String(i));
			// Touch the stable formula so it is never the oldest.
			latexOutline("\\pi");
		}
		expect(outlineCacheSize()).toBe(OUTLINE_CACHE_LIMIT);
		expect(latexOutline("\\pi")).toBe(stable);
		// The earliest churn entry was evicted, so it typesets afresh.
		expect(latexOutline("0")).not.toBe(firstChurn);
	});
});
