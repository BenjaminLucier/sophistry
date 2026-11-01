/**
 * `pick-items.ts`: which item of a batched node is under a point. Marks are
 * found through a uniform grid over their centres; an image's pixel by
 * solving its affine frame.
 */

import { describe, expect, it } from "vitest";
import type { ImageSpec, MarksSpec, StrokeStyle } from "../spec/types.js";
import { pickMark, pickPixel } from "./pick-items.js";

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

function marks(points: [number, number][], radius = 0.5): MarksSpec {
	return {
		kind: "marks",
		id: 1,
		zIndex: 0,
		shape: { kind: "circle" },
		count: points.length,
		centers: new Float64Array(points.flat()),
		extents: new Float64Array(points.length).fill(radius),
		fills: "red",
		alphas: null,
		style,
		progress: 1,
		bounds: null,
	};
}

describe("pickMark", () => {
	const spec = marks([
		[0, 0],
		[3, 0],
		[0.6, 0],
	]);

	it("finds the item under the point, and nothing between items", () => {
		expect(pickMark(spec, { x: 3.2, y: 0.1 })).toBe(1);
		expect(pickMark(spec, { x: 1.8, y: 0 })).toBeNull();
	});

	it("overlapping items resolve to the one painted last (highest index)", () => {
		expect(pickMark(spec, { x: 0.3, y: 0 })).toBe(2);
	});

	it("slop widens every item by the same distance", () => {
		expect(pickMark(spec, { x: 3.7, y: 0 })).toBeNull();
		expect(pickMark(spec, { x: 3.7, y: 0 }, 0.3)).toBe(1);
	});

	it("an empty layer picks nothing", () => {
		expect(pickMark(marks([]), { x: 0, y: 0 })).toBeNull();
	});
});

describe("pickPixel", () => {
	const image: ImageSpec = {
		kind: "image",
		id: 2,
		zIndex: 0,
		pixels: { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4) },
		origin: { x: 0, y: 0 },
		xAxis: { x: 4, y: 0 },
		yAxis: { x: 0, y: 2 },
		smoothing: false,
		opacity: 1,
		progress: 1,
	};

	it("returns row * width + column under the point", () => {
		expect(pickPixel(image, { x: 0.5, y: 0.5 })).toBe(0);
		expect(pickPixel(image, { x: 2.5, y: 1.5 })).toBe(6);
	});

	it("misses outside the frame", () => {
		expect(pickPixel(image, { x: -0.1, y: 0.5 })).toBeNull();
		expect(pickPixel(image, { x: 4.1, y: 0.5 })).toBeNull();
	});
});
