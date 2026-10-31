/**
 * A web font that loads after a string was measured: the metrics cache must
 * drop the fallback font's box, and `fontLoads` subscribers must hear it.
 * Uses a fake `document` (fonts + a canvas whose width the test controls),
 * installed before `metrics.ts` is imported so its oracle picks it up.
 */

import { afterAll, describe, expect, it, vi } from "vitest";

describe("font-load invalidation", () => {
	const fonts = new EventTarget();
	let advance = 10;
	const ctx = {
		font: "",
		measureText: (text: string) => ({ width: text.length * advance }),
	};
	vi.stubGlobal("document", {
		fonts,
		createElement: () => ({ getContext: () => ctx }),
	});
	afterAll(() => {
		vi.unstubAllGlobals();
	});

	it("clears the cache and tells subscribers on loadingdone", async () => {
		const { fontLoads, labelBox } = await import("./metrics");
		const style = {
			fontSize: 64,
			fontFamily: "WebFont",
			fontWeight: 500,
			italic: false,
			letterSpacing: 0,
			align: "left" as const,
			baseline: "middle" as const,
		};
		const width = () => {
			const box = labelBox("ab", style);
			return box.maxX - box.minX;
		};
		let heard = 0;
		const unsubscribe = fontLoads.subscribe(() => {
			heard++;
		});
		try {
			expect(width()).toBe(20);
			expect(fontLoads.peek()).toBe(0);
			// The real font arrives: the cached fallback box is still served...
			advance = 15;
			expect(width()).toBe(20);
			// ...until the font set reports the load.
			fonts.dispatchEvent(new Event("loadingdone"));
			expect(heard).toBe(1);
			expect(fontLoads.peek()).toBe(1);
			expect(width()).toBe(30);
		} finally {
			unsubscribe();
		}
		fonts.dispatchEvent(new Event("loadingdone"));
		expect(heard).toBe(1);
	});
});
