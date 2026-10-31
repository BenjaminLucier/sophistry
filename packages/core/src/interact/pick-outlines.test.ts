/**
 * Picking `outline` and `paths` marks exactly: inside a closed filled
 * outline through the item's inverse transform, near the outline within half
 * its own stroke width plus slop otherwise; and the focus ring's item box.
 */

import { describe, expect, it } from "vitest";
import type { MarkOutline, MarksSpec, StrokeStyle } from "../spec/types";
import { itemAt } from "./hit";
import { itemBox } from "./item-order";
import { pickMark } from "./pick-items";

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

const square: MarkOutline = {
	polylines: [
		[
			{ x: -1, y: -1 },
			{ x: 1, y: -1 },
			{ x: 1, y: 1 },
			{ x: -1, y: 1 },
		],
	],
	closed: true,
};

function spec(extra: Partial<MarksSpec>): MarksSpec {
	return {
		kind: "marks",
		id: 1,
		zIndex: 0,
		shape: { kind: "outline", ...square },
		count: 2,
		centers: new Float64Array([0, 0, 10, 0]),
		// Item 1 is sheared: x' = x + y.
		transforms: new Float64Array([1, 0, 0, 1, 1, 0, 1, 1]),
		extents: new Float64Array([Math.SQRT2, Math.SQRT2 * 2]),
		fills: "#f00",
		alphas: null,
		style,
		progress: 1,
		bounds: { minX: -2, minY: -3, maxX: 13, maxY: 3 },
		...extra,
	};
}

describe("picking outline marks", () => {
	it("hits inside a filled outline, through the item's transform", () => {
		const layer = spec({});
		expect(pickMark(layer, { x: 0.9, y: 0.9 })).toBe(0);
		// The sheared square at 10: corner (1, 1) lands at (12, 1).
		expect(pickMark(layer, { x: 11.8, y: 0.9 })).toBe(1);
		// Inside its disc of reach but outside the parallelogram.
		expect(pickMark(layer, { x: 8.2, y: 0.9 })).toBeNull();
		expect(itemAt(layer, { x: 11.8, y: 0.9 })).toBe(1);
	});

	it("hits an unfilled outline only near its stroke", () => {
		const layer = spec({
			fills: "none",
			style: { ...style, stroke: "#000", strokeWidth: 0.2 },
		});
		expect(pickMark(layer, { x: 0, y: 0 })).toBeNull();
		expect(pickMark(layer, { x: 1.05, y: 0 })).toBe(0);
		expect(pickMark(layer, { x: 1.2, y: 0 })).toBeNull();
		expect(pickMark(layer, { x: 1.2, y: 0 }, 0.15)).toBe(0);
	});

	it("uses each item's own stroke width", () => {
		const layer = spec({
			fills: "none",
			style: { ...style, stroke: "#000", strokeWidth: 1 },
			strokeWidths: new Float32Array([0.1, 1]),
		});
		expect(pickMark(layer, { x: 1.3, y: 0 })).toBeNull();
		expect(pickMark(layer, { x: 11.3 + 0, y: 0 })).toBe(1);
	});

	it("picks paths items by their own outlines and skips hidden ones", () => {
		const triangle: MarkOutline = {
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 2, y: 0 },
					{ x: 0, y: 2 },
				],
			],
			closed: true,
		};
		const layer = spec({
			shape: { kind: "paths", outlines: [triangle, square] },
			transforms: null,
			extents: new Float64Array([2, Math.SQRT2]),
		});
		expect(pickMark(layer, { x: 0.5, y: 0.5 })).toBe(0);
		expect(pickMark(layer, { x: 1.5, y: 1.5 })).toBeNull();
		expect(pickMark(layer, { x: 10, y: 0 })).toBe(1);
		const hidden = { ...layer, alphas: new Float32Array([1, 0]) };
		expect(pickMark(hidden, { x: 10, y: 0 })).toBeNull();
	});

	it("boxes an outline item by its placed outline", () => {
		const box = itemBox(spec({}), 1);
		expect(box).toEqual({ minX: 8, minY: -1, maxX: 12, maxY: 1 });
	});
});
