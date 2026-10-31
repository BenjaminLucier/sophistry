import { expect, test } from "@playwright/test";
import { FIXTURES, frames } from "./helpers";

/**
 * A real, unmocked `MathTex` (fonts, KaTeX layout and outline extraction all
 * run for real) must reach the canvas. Unit tests mock `latexOutline`, and a
 * stage whose only node is still typesetting once painted nothing at all, so
 * this is the check that the async path ends in pixels.
 */
test("MathTex paints its formula in the stage's canvas", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	await page.goto(`${FIXTURES}/?s=math`);
	await page.waitForFunction(() => window.__t.typeset === true);
	await frames(page, 5);

	const red = () =>
		page.evaluate(() => {
			const canvas = document.querySelector("canvas") as HTMLCanvasElement;
			const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
			const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			let hits = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) hits++;
			}
			return hits;
		});
	// A formula is hundreds of glyph pixels; a stray anti-aliased dot is not.
	await expect.poll(red).toBeGreaterThan(300);
	expect(errors).toEqual([]);
});
