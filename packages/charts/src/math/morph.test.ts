import { describe, expect, it } from "vitest";
import {
	morphArea,
	morphAreaRuns,
	morphPolyline,
	morphRuns,
	morphSteps,
} from "./morph";

const pts = (...xy: [number, number][]) => xy.map(([x, y]) => ({ x, y }));

describe("morphPolyline", () => {
	it("returns the ends exactly at t = 0 and t = 1", () => {
		const a = pts([0, 0], [1, 1], [2, 0]);
		const b = pts([0, 2], [2, 2]);
		expect(morphPolyline(a, b, 0)).toEqual(a);
		expect(morphPolyline(a, b, 1)).toEqual(b);
	});

	it("blends y per x on the union of both x grids", () => {
		const a = pts([0, 0], [2, 2]);
		const b = pts([0, 4], [1, 0], [2, 4]);
		expect(morphPolyline(a, b, 0.5)).toEqual(pts([0, 2], [1, 0.5], [2, 3]));
	});

	it("moves points vertically only: every x on the result is one of the inputs'", () => {
		const a = pts([0, 1], [1, 5], [3, 2]);
		const b = pts([0, 3], [2, 1], [3, 4]);
		const xs = morphPolyline(a, b, 0.3).map((p) => p.x);
		expect(xs).toEqual([0, 1, 2, 3]);
	});

	it("extends or retreats the line's ends along x", () => {
		const a = pts([0, 1], [10, 1]);
		const b = pts([0, 1], [10, 1], [20, 3]);
		const mid = morphPolyline(a, b, 0.5);
		expect(mid[0].x).toBe(0);
		expect(mid[mid.length - 1].x).toBe(15);
		// Beyond its own data the old line is held at its last value.
		expect(mid[mid.length - 1].y).toBeCloseTo(1 + (2 - 1) * 0.5);
	});

	it("falls back to resampling by length for lines that are not functions of x", () => {
		const loop = pts([0, 0], [1, 1], [0, 2]);
		const line = pts([0, 0], [1, 0], [2, 0]);
		const mid = morphPolyline(loop, line, 0.5);
		expect(mid.length).toBe(3);
		expect(mid[0]).toEqual({ x: 0, y: 0 });
		expect(mid[2].x).toBeCloseTo(1);
		expect(mid[2].y).toBeCloseTo(1);
	});
});

describe("morphRuns", () => {
	it("morphs run by run when the counts match, and as one line otherwise", () => {
		const a = [pts([0, 0], [1, 0]), pts([2, 0], [3, 0])];
		const b = [pts([0, 2], [1, 2]), pts([2, 2], [3, 2])];
		expect(morphRuns(a, b, 0.5)).toEqual([
			pts([0, 1], [1, 1]),
			pts([2, 1], [3, 1]),
		]);
		const one = [pts([0, 0], [3, 0])];
		expect(morphRuns(a, one, 0.5)).toHaveLength(1);
		expect(morphRuns(a, one, 1)).toEqual(one);
		expect(morphRuns(a, one, 0)).toEqual(a);
	});
});

const area = (...xyy: [number, number, number][]) =>
	xyy.map(([x, y1, y2]) => ({ x, y1, y2 }));

describe("morphArea", () => {
	it("returns the ends exactly at t = 0 and t = 1", () => {
		const a = area([0, 1, 0], [1, 2, 0], [2, 1, 0]);
		const b = area([0, 3, 1], [2, 3, 1]);
		expect(morphArea(a, b, 0)).toEqual(a);
		expect(morphArea(a, b, 1)).toEqual(b);
	});

	it("blends both bounds per x on the union of both x grids", () => {
		const a = area([0, 2, 0], [2, 2, 0]);
		const b = area([0, 4, 2], [1, 6, 2], [2, 4, 2]);
		expect(morphArea(a, b, 0.5)).toEqual(area([0, 3, 1], [1, 4, 1], [2, 3, 1]));
	});

	it("keeps a shared edge shared: adjacent stack layers stay adjacent", () => {
		// Two layers of a stack at each end, on different x grids.
		const lowA = area([0, 1, 0], [2, 3, 0]);
		const highA = area([0, 2, 1], [2, 4, 3]);
		const lowB = area([0, 2, 0], [1, 1, 0], [3, 2, 0]);
		const highB = area([0, 5, 2], [1, 2, 1], [3, 4, 2]);
		for (const t of [0.2, 0.5, 0.8]) {
			const low = morphArea(lowA, lowB, t);
			const high = morphArea(highA, highB, t);
			expect(low.map((p) => p.x)).toEqual(high.map((p) => p.x));
			low.forEach((p, i) => {
				expect(high[i].y2).toBeCloseTo(p.y1, 12);
			});
		}
	});

	it("extends or retreats the area's ends along x, held at its end bounds", () => {
		const a = area([0, 1, 0], [10, 1, 0]);
		const b = area([0, 1, 0], [10, 1, 0], [20, 3, 2]);
		const mid = morphArea(a, b, 0.5);
		expect(mid[0].x).toBe(0);
		expect(mid[mid.length - 1].x).toBe(15);
		expect(mid[mid.length - 1].y1).toBeCloseTo(1 + (2 - 1) * 0.5);
		expect(mid[mid.length - 1].y2).toBeCloseTo(0 + (1 - 0) * 0.5);
	});

	it("falls back to resampling by point fraction when x is not ascending", () => {
		const a = area([0, 1, 0], [2, 1, 0], [1, 1, 0]);
		const b = area([0, 3, 2], [2, 3, 2]);
		const mid = morphArea(a, b, 0.5);
		expect(mid).toHaveLength(3);
		expect(mid[0]).toEqual({ x: 0, y1: 2, y2: 1 });
		expect(mid[2]).toEqual({ x: 1.5, y1: 2, y2: 1 });
	});
});

describe("morphAreaRuns", () => {
	it("morphs run by run when the counts match, and as one area otherwise", () => {
		const a = [area([0, 1, 0], [1, 1, 0]), area([2, 1, 0], [3, 1, 0])];
		const b = [area([0, 3, 0], [1, 3, 0]), area([2, 3, 0], [3, 3, 0])];
		expect(morphAreaRuns(a, b, 0.5)).toEqual([
			area([0, 2, 0], [1, 2, 0]),
			area([2, 2, 0], [3, 2, 0]),
		]);
		const one = [area([0, 1, 0], [3, 1, 0])];
		expect(morphAreaRuns(a, one, 0.5)).toHaveLength(1);
		expect(morphAreaRuns(a, one, 0)).toEqual(a);
		expect(morphAreaRuns(a, one, 1)).toEqual(one);
	});
});

describe("morphSteps", () => {
	it("returns the ends exactly at t = 0 and t = 1", () => {
		const a = { edges: [0, 1, 2], values: [1, 2] };
		const b = { edges: [0, 3], values: [5] };
		expect(morphSteps(a, b, 0)).toEqual(a);
		expect(morphSteps(a, b, 1)).toEqual(b);
	});

	it("blends each interval's height on the union of both ends' edges", () => {
		expect(
			morphSteps(
				{ edges: [0, 2], values: [4] },
				{ edges: [0, 1, 2], values: [0, 2] },
				0.5,
			),
		).toEqual({ edges: [0, 1, 2], values: [2, 3] });
	});

	it("stays a step function: one more edge than values, edges ascending", () => {
		// Two ECDFs of different samples, as `ecdfSteps` builds them.
		const a = { edges: [0.5, 1, 2, 3, 3.5], values: [0, 1 / 3, 2 / 3, 1] };
		const b = { edges: [1.75, 2, 4, 4.25], values: [0, 0.5, 1] };
		for (const t of [0.1, 0.5, 0.9]) {
			const mid = morphSteps(a, b, t);
			expect(mid.edges.length).toBe(mid.values.length + 1);
			for (let i = 1; i < mid.edges.length; i++)
				expect(mid.edges[i]).toBeGreaterThan(mid.edges[i - 1]);
			// The blend of two CDFs is a CDF: rising, within 0..1.
			for (let i = 1; i < mid.values.length; i++)
				expect(mid.values[i]).toBeGreaterThanOrEqual(mid.values[i - 1]);
			expect(Math.min(...mid.values)).toBeGreaterThanOrEqual(0);
			expect(Math.max(...mid.values)).toBeLessThanOrEqual(1);
		}
		const mid = morphSteps(a, b, 0.5);
		expect(mid.edges[0]).toBe((0.5 + 1.75) / 2);
		expect(mid.edges[mid.edges.length - 1]).toBe((3.5 + 4.25) / 2);
		// On [2, 3): the old CDF is 2/3, the new one 0.5.
		const at = mid.edges.indexOf(2);
		expect(mid.values[at]).toBeCloseTo((2 / 3 + 0.5) / 2);
	});

	it("takes the other end whole when one side is empty, and cuts at 0.5 when edges are not ascending", () => {
		const a = { edges: [0, 1], values: [1] };
		const none = { edges: [], values: [] };
		expect(morphSteps(a, none, 0.5)).toEqual(a);
		expect(morphSteps(none, a, 0.5)).toEqual(a);
		const bad = { edges: [2, 1], values: [3] };
		expect(morphSteps(a, bad, 0.4)).toEqual(a);
		expect(morphSteps(a, bad, 0.6)).toEqual(bad);
	});
});
