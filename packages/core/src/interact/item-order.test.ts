/**
 * `item-order.ts`: where the keys move a batched node's current item.
 */

import { describe, expect, it } from "vitest";
import type { Matrix } from "../geometry/transform";
import type { ImageSpec, MarksSpec, StrokeStyle } from "../spec/types";
import { itemBox, itemPosition, stepItem } from "./item-order";

const style: StrokeStyle = {
	stroke: "none",
	strokeWidth: 0,
	fill: null,
	along: null,
	opacity: 1,
	fillOpacity: 1,
	lineCap: "round",
	lineJoin: "round",
	dash: null,
	dashOffset: 0,
};

/** A y-up view: scene y up is screen y down. */
const yUp: Matrix = { a: 10, b: 0, c: 0, d: -10, e: 0, f: 0 };

function marks(points: [number, number][]): MarksSpec {
	return {
		kind: "marks",
		id: 1,
		zIndex: 0,
		shape: { kind: "circle" },
		count: points.length,
		centers: new Float64Array(points.flat()),
		extents: new Float64Array(points.length).fill(0.5),
		fills: "red",
		alphas: null,
		style,
		progress: 1,
		bounds: null,
	};
}

describe("stepItem on marks", () => {
	const spec = marks([
		[2, 0],
		[0, 0],
		[1, 5],
		[1, -5],
	]);

	it("starts at the leftmost and steps along the screen's x", () => {
		expect(stepItem(spec, null, "ArrowRight", yUp)).toBe(1);
		expect(stepItem(spec, 1, "ArrowRight", yUp)).not.toBe(0);
		expect(stepItem(spec, 0, "ArrowRight", yUp)).toBe(0);
		expect(stepItem(spec, 1, "End", yUp)).toBe(0);
		expect(itemPosition(spec, 0, yUp)).toBe(4);
	});

	it("goes up and down on screen, under a y-up view", () => {
		// Item 2 is at scene y 5: above on screen.
		expect(stepItem(spec, 1, "ArrowUp", yUp)).toBe(2);
		expect(stepItem(spec, 1, "ArrowDown", yUp)).toBe(3);
		expect(stepItem(spec, 2, "ArrowUp", yUp)).toBe(2);
	});

	it("reads left to right on screen under a mirrored view", () => {
		const mirrored: Matrix = { ...yUp, a: -10 };
		expect(stepItem(spec, null, "ArrowRight", mirrored)).toBe(0);
	});

	it("ignores keys that do not navigate", () => {
		expect(stepItem(spec, 1, "a", yUp)).toBeNull();
	});

	it("boxes an item by its extent", () => {
		expect(itemBox(spec, 0)).toEqual({
			minX: 1.5,
			maxX: 2.5,
			minY: -0.5,
			maxY: 0.5,
		});
	});
});

describe("stepItem on an image", () => {
	const image: ImageSpec = {
		kind: "image",
		id: 2,
		zIndex: 0,
		pixels: { width: 3, height: 2, data: new Uint8ClampedArray(24) },
		// Row 0 at the top of a y-up scene: rows run down the screen.
		origin: { x: 0, y: 2 },
		xAxis: { x: 3, y: 0 },
		yAxis: { x: 0, y: -2 },
		smoothing: false,
		opacity: 1,
		progress: 1,
	};

	it("moves by column and row as the image is drawn", () => {
		expect(stepItem(image, null, "ArrowRight", yUp)).toBe(0);
		expect(stepItem(image, 0, "ArrowRight", yUp)).toBe(1);
		expect(stepItem(image, 2, "ArrowRight", yUp)).toBe(2);
		expect(stepItem(image, 1, "ArrowDown", yUp)).toBe(4);
		expect(stepItem(image, 4, "ArrowUp", yUp)).toBe(1);
		expect(stepItem(image, 4, "End", yUp)).toBe(5);
	});

	it("boxes a pixel", () => {
		expect(itemBox(image, 4)).toEqual({
			minX: 1,
			maxX: 2,
			minY: 0,
			maxY: 1,
		});
	});
});
