import { describe, expect, it } from "vitest";
import {
	clipPolylineToX,
	clipRingToX,
	revealClipAlongX,
	revealCutoff,
	revealPolylinesAlongX,
	revealRingsAlongX,
	xExtent,
} from "./reveal.js";

const p = (x: number, y: number) => ({ x, y });

describe("xExtent", () => {
	it("spans every polyline, skipping non-finite x", () => {
		expect(
			xExtent([
				[p(2, 0), p(5, 1)],
				[p(-1, 0), p(Number.NaN, 3)],
			]),
		).toEqual([-1, 5]);
	});

	it("is undefined with no points", () => {
		expect(xExtent([])).toBeUndefined();
		expect(xExtent([[]])).toBeUndefined();
	});
});

describe("clipPolylineToX", () => {
	it("cuts the crossing segment at the cutoff", () => {
		expect(clipPolylineToX([p(0, 0), p(2, 2), p(4, 0)], 3)).toEqual([
			[p(0, 0), p(2, 2), p(3, 1)],
		]);
	});

	it("keeps a line that doubles back as separate pieces", () => {
		// Out past the cut and back: two pieces, as a clip would show.
		const pieces = clipPolylineToX([p(0, 0), p(4, 0), p(0, 2)], 2);
		expect(pieces).toEqual([
			[p(0, 0), p(2, 0)],
			[p(2, 1), p(0, 2)],
		]);
	});

	it("drops a line entirely right of the cut", () => {
		expect(clipPolylineToX([p(3, 0), p(4, 1)], 2)).toEqual([]);
	});
});

describe("clipRingToX", () => {
	const square = [p(0, 0), p(4, 0), p(4, 2), p(0, 2)];

	it("cuts a ring to a straight front", () => {
		const ring = clipRingToX(square, 1);
		const xs = ring.map((q) => q.x);
		expect(Math.max(...xs)).toBe(1);
		expect(Math.min(...xs)).toBe(0);
		expect(ring).toHaveLength(4);
	});

	it("keeps a closed ring closed", () => {
		const ring = clipRingToX([...square, square[0]], 1);
		expect(ring[ring.length - 1]).toEqual(ring[0]);
	});

	it("is empty when nothing is left of the cut", () => {
		expect(clipRingToX(square, -1)).toEqual([]);
	});
});

describe("revealPolylinesAlongX", () => {
	const line = [p(0, 0), p(1, 5), p(2, -5), p(10, 0)];

	it("is nothing at 0 and everything at 1", () => {
		expect(revealPolylinesAlongX([line], 0)).toEqual([]);
		expect(revealPolylinesAlongX([line], 1)).toEqual([line]);
	});

	it("advances linearly in x, however long the line is there", () => {
		// The busy stretch (x 0..2) is most of the arc length but 20% of x.
		const [piece] = revealPolylinesAlongX([line], 0.2);
		expect(piece[piece.length - 1].x).toBeCloseTo(2);
		expect(revealCutoff(0.5, [0, 10])).toBe(5);
	});

	it("cuts every line at the same x", () => {
		const pieces = revealPolylinesAlongX(
			[
				[p(0, 0), p(10, 0)],
				[p(5, 1), p(10, 1)],
			],
			0.4,
		);
		expect(pieces).toEqual([[p(0, 0), p(4, 0)]]);
	});
});

describe("revealRingsAlongX", () => {
	it("reveals a filled area up to the cut, all of it at 1", () => {
		const ring = [p(0, 0), p(10, 0), p(10, 1), p(0, 1)];
		const [half] = revealRingsAlongX([ring], 0.5);
		expect(Math.max(...half.map((q) => q.x))).toBeCloseTo(5);
		expect(revealRingsAlongX([ring], 1)).toEqual([ring]);
		expect(revealRingsAlongX([ring], 0)).toEqual([]);
	});
});

describe("revealClipAlongX", () => {
	const ring = [
		{ x: 0, y: 0 },
		{ x: 4, y: 0 },
		{ x: 4, y: 2 },
		{ x: 0, y: 2 },
	];

	it("ends at the cutoff and reaches well past the geometry elsewhere", () => {
		const box = revealClipAlongX([ring], 0.5);
		expect(box?.maxX).toBe(2);
		expect(box?.minX).toBeLessThan(0);
		expect(box?.minY).toBeLessThan(0);
		expect(box?.maxY).toBeGreaterThan(2);
	});

	it("clips nothing once complete, everything before it starts", () => {
		expect(revealClipAlongX([ring], 1)).toBeUndefined();
		const empty = revealClipAlongX([ring], 0);
		expect(empty && empty.maxX <= empty.minX).toBe(true);
		expect(revealClipAlongX([], 0.5)).toBeUndefined();
	});
});
