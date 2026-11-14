import { describe, expect, it } from "vitest";
import { themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import type { ImagePixels, ImageSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { fitImage, image } from "./image.js";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

/** A picture whose every pixel holds its own column and row. */
function grid(width: number, height: number): ImagePixels {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = x;
			data[i + 1] = y;
			data[i + 3] = 255;
		}
	}
	return { width, height, data };
}

describe("fitImage", () => {
	it("fill stretches the whole picture to the box", () => {
		expect(fitImage(200, 100, 4, 4, "fill")).toEqual({
			crop: { x: 0, y: 0, width: 200, height: 100 },
			width: 4,
			height: 4,
		});
	});

	it("contain fits the whole picture inside", () => {
		const fit = fitImage(200, 100, 4, 4, "contain");
		expect(fit.width).toBeCloseTo(4);
		expect(fit.height).toBeCloseTo(2);
		expect(fit.crop).toEqual({ x: 0, y: 0, width: 200, height: 100 });
	});

	it("cover fills the box and crops the overflow evenly", () => {
		const fit = fitImage(200, 100, 4, 4, "cover");
		expect(fit.width).toBe(4);
		expect(fit.height).toBe(4);
		expect(fit.crop.x).toBeCloseTo(50);
		expect(fit.crop.width).toBeCloseTo(100);
		expect(fit.crop.height).toBeCloseTo(100);
	});
});

describe("image", () => {
	it("draws nothing without pixels", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(image.create({ pixels: null, width: 2 }));
		commit();
		expect((node.spec as ImageSpec).pixels.width).toBe(0);
	});

	it("is centred, upright and sized by its aspect ratio", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			image.create({ pixels: grid(4, 2), width: 2, center: { x: 1, y: 1 } }),
		);
		commit();
		const spec = node.spec as ImageSpec;
		expect(spec.origin).toEqual({ x: 0, y: 1.5 });
		expect(spec.xAxis).toEqual({ x: 2, y: 0 });
		expect(spec.yAxis).toEqual({ x: 0, y: -1 });
	});

	it("cover crops the pixels to the centre", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			image.create({
				pixels: grid(4, 2),
				width: 1,
				height: 1,
				objectFit: "cover",
			}),
		);
		commit();
		const pixels = (node.spec as ImageSpec).pixels;
		expect(pixels.width).toBe(2);
		expect(pixels.height).toBe(2);
		// The first pixel kept is column 1 of the source.
		expect(pixels.data[0]).toBe(1);
	});
});
