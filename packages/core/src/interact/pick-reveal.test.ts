/**
 * Picking partly revealed items: an item at `0 < progress < 1` is picked as
 * a single shape at that progress is (`hitSpec`): its stroke only where it
 * has been drawn, its fill whole. Each case builds the item and the
 * equivalent shape and asserts both answer alike over a grid of points.
 */

import { describe, expect, it } from "vitest";
import type { Polyline } from "../geometry";
import type {
	MarkOutline,
	MarksSpec,
	ShapeSpec,
	StrokeStyle,
} from "../spec/types";
import { hitSpec } from "./hit";
import { pickMark } from "./pick-items";

const base: StrokeStyle = {
	stroke: "#fff",
	strokeWidth: 0.2,
	fill: null,
	along: null,
	opacity: 1,
	fillOpacity: 1,
	lineCap: "round",
	lineJoin: "round",
	dash: null,
	dashOffset: 0,
};

/** An open L: along x for 4 units, then up for 4. */
const corner: Polyline = [
	{ x: 0, y: 0 },
	{ x: 4, y: 0 },
	{ x: 4, y: 4 },
];
/** A closed square ring (first point repeated, as a shape's ring is). */
const square: Polyline = [
	{ x: 0, y: 0 },
	{ x: 4, y: 0 },
	{ x: 4, y: 4 },
	{ x: 0, y: 4 },
	{ x: 0, y: 0 },
];

/** The same outline as one item at `centre`, revealed to `progress`. */
function item(
	outline: MarkOutline,
	centre: { x: number; y: number },
	progress: number,
	style: StrokeStyle,
): MarksSpec {
	return {
		kind: "marks",
		id: 1,
		zIndex: 0,
		shape: { kind: "outline", ...outline },
		count: 1,
		centers: new Float64Array([centre.x, centre.y]),
		extents: new Float64Array([8]),
		fills: typeof style.fill === "string" ? style.fill : "none",
		alphas: null,
		style,
		progress: 1,
		progresses: new Float32Array([progress]),
		bounds: null,
	};
}

/** The shape a single node of that outline would be, drawn to `progress`. */
function shape(
	outline: MarkOutline,
	centre: { x: number; y: number },
	progress: number,
	style: StrokeStyle,
): ShapeSpec {
	return {
		kind: "shape",
		id: 1,
		zIndex: 0,
		polylines: outline.polylines.map((line) =>
			line.map((p) => ({ x: p.x + centre.x, y: p.y + centre.y })),
		),
		closed: outline.closed,
		fillFrom: 0,
		style,
		progress,
	};
}

/** Every point of a grid over the outline's box, as pick answers. */
function compare(
	outline: MarkOutline,
	progress: number,
	style: StrokeStyle,
	centre = { x: 10, y: -3 },
): { agree: boolean; hits: number } {
	const marks = item(outline, centre, progress, style);
	const single = shape(outline, centre, progress, style);
	let hits = 0;
	for (let gx = -1; gx <= 5; gx += 0.25) {
		for (let gy = -1; gy <= 5; gy += 0.25) {
			const at = { x: centre.x + gx, y: centre.y + gy };
			const expected = hitSpec(
				single,
				{ id: 1, pointerEvents: "painted", hitArea: null },
				at,
			);
			const actual = pickMark(marks, at) !== null;
			if (expected !== actual) return { agree: false, hits };
			if (expected) hits++;
		}
	}
	return { agree: true, hits };
}

describe("a partly revealed item picks as a shape at that progress", () => {
	const open: MarkOutline = { polylines: [corner], closed: false };
	const ring: MarkOutline = { polylines: [square], closed: true };

	it("an open stroke is pickable only where it has been drawn", () => {
		// Half of the 8 units: the whole horizontal run, none of the vertical.
		const { agree, hits } = compare(open, 0.5, base);
		expect(agree).toBe(true);
		expect(hits).toBeGreaterThan(0);
		const marks = item(open, { x: 0, y: 0 }, 0.5, base);
		expect(pickMark(marks, { x: 2, y: 0 })).toBe(0);
		expect(pickMark(marks, { x: 4, y: 3 })).toBeNull();
	});

	it("matches at several progresses, including one ending mid-segment", () => {
		for (const progress of [0.1, 0.3, 0.62, 0.9])
			expect(compare(open, progress, base).agree).toBe(true);
	});

	it("a filled closed outline picks its whole fill, its stroke only as drawn", () => {
		const filled = { ...base, fill: "#f00" };
		for (const progress of [0.2, 0.55, 0.95])
			expect(compare(ring, progress, filled).agree).toBe(true);
		// The fill is whole at any progress above 0.
		const marks = item(ring, { x: 0, y: 0 }, 0.2, filled);
		expect(pickMark(marks, { x: 2, y: 2 })).toBe(0);
	});

	it("an unstroked closed outline picks its fill but not the slop around it", () => {
		const fillOnly = { ...base, stroke: "none", strokeWidth: 0, fill: "#f00" };
		expect(compare(ring, 0.4, fillOnly).agree).toBe(true);
		const marks = item(ring, { x: 0, y: 0 }, 0.4, fillOnly);
		expect(pickMark(marks, { x: 4.1, y: 2 }, 0.3)).toBeNull();
	});

	it("a fully revealed item is unchanged, and an unrevealed one picks nothing", () => {
		expect(compare(open, 1, base).agree).toBe(true);
		const marks = item(open, { x: 0, y: 0 }, 0, base);
		expect(pickMark(marks, { x: 2, y: 0 })).toBeNull();
	});

	it("places the drawn part by the item's linear part", () => {
		const marks = item(open, { x: 0, y: 0 }, 0.5, base);
		// Swap the axes: the drawn horizontal run now runs up the y axis.
		marks.transforms = new Float64Array([0, 1, 1, 0]);
		expect(pickMark(marks, { x: 0, y: 2 })).toBe(0);
		expect(pickMark(marks, { x: 3, y: 4 })).toBeNull();
	});
});
