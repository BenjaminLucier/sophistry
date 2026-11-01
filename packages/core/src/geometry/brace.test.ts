import { describe, expect, it } from "vitest";
import { braceRings, braceSpan, braceTip } from "./brace.js";
import type { Polyline } from "./path/types.js";

function area(ring: Polyline): number {
	let sum = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum / 2;
}

const ys = (rings: Polyline[]) => rings.flat().map((p) => p.y);
const xs = (rings: Polyline[]) => rings.flat().map((p) => p.x);

describe("braceRings", () => {
	it("spans left to right and points down, as Manim's does", () => {
		const rings = braceRings({ x: -2, y: 0 }, { x: 2, y: 0 });
		expect(rings).toHaveLength(2);
		expect(Math.min(...xs(rings))).toBeCloseTo(-2, 1);
		expect(Math.max(...xs(rings))).toBeCloseTo(2, 1);
		// The tip reaches the depth below the span; nothing rises far above it.
		expect(Math.min(...ys(rings))).toBeCloseTo(-0.25, 2);
		expect(Math.max(...ys(rings))).toBeLessThan(0.05);
	});

	it("is closed, and both arms wind the same way so the fill is one shape", () => {
		const [a, b] = braceRings({ x: 0, y: 0 }, { x: 3, y: 0 });
		for (const ring of [a, b]) {
			expect(ring[0]).toEqual(ring[ring.length - 1]);
			expect(Math.abs(area(ring))).toBeGreaterThan(0);
		}
		expect(Math.sign(area(a))).toBe(Math.sign(area(b)));
	});

	it("flips when the ends swap, and keeps its depth whatever its length", () => {
		const up = braceRings({ x: 2, y: 0 }, { x: -2, y: 0 });
		expect(Math.max(...ys(up))).toBeCloseTo(0.25, 2);
		const long = braceRings({ x: -10, y: 0 }, { x: 10, y: 0 }, { depth: 0.3 });
		expect(Math.min(...ys(long))).toBeCloseTo(-0.3, 2);
	});

	it("draws nothing for a zero-length span", () => {
		expect(braceRings({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
	});
});

describe("braceTip and braceSpan", () => {
	it("puts the tip at the middle, depth out", () => {
		expect(braceTip({ x: -1, y: 0 }, { x: 1, y: 0 })).toEqual({
			x: 0,
			y: -0.25,
		});
		const tip = braceTip({ x: 0, y: 1 }, { x: 0, y: -1 }, { depth: 0.5 });
		expect(tip.x).toBeCloseTo(-0.5, 12);
		expect(tip.y).toBeCloseTo(0, 12);
	});

	it("runs along the side a direction faces, pushed out by gap", () => {
		const box = { minX: -1, minY: -0.5, maxX: 2, maxY: 0.5 };
		const below = braceSpan(box, { x: 0, y: -1 }, 0.2);
		expect(below.from.x).toBeCloseTo(-1, 12);
		expect(below.to.x).toBeCloseTo(2, 12);
		expect(below.from.y).toBeCloseTo(-0.7, 12);
		expect(below.to.y).toBeCloseTo(-0.7, 12);
		// Its tip points away from the box.
		expect(braceTip(below.from, below.to).y).toBeLessThan(-0.7);

		const left = braceSpan(box, { x: -1, y: 0 }, 0.2);
		expect(left.from.x).toBeCloseTo(-1.2, 12);
		expect(braceTip(left.from, left.to).x).toBeLessThan(-1.2);
		expect(Math.min(left.from.y, left.to.y)).toBeCloseTo(-0.5, 12);
		expect(Math.max(left.from.y, left.to.y)).toBeCloseTo(0.5, 12);
	});
});
