import { describe, expect, it } from "vitest";
import { boundsOf, curvePathToPolyline } from "./index.js";
import { resolveCornerRadii, roundedRectCurvePath } from "./rounded-rect.js";

/** Signed area of a closed ring: positive when counter-clockwise (y-up). */
function signedArea(points: { x: number; y: number }[]): number {
	let area = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i] as { x: number; y: number };
		const b = points[(i + 1) % points.length] as { x: number; y: number };
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

describe("resolveCornerRadii", () => {
	it("spreads one radius to every corner", () => {
		expect(resolveCornerRadii(10, 10, 2)).toEqual([
			{ x: 2, y: 2 },
			{ x: 2, y: 2 },
			{ x: 2, y: 2 },
			{ x: 2, y: 2 },
		]);
	});

	it("scales every radius down together when a side overflows", () => {
		// The top's radii (6 + 6) overflow its width of 8: factor 8 / 12.
		const radii = resolveCornerRadii(8, 20, [6, 6, 1, 1]);
		expect(radii[0].x).toBeCloseTo(4);
		expect(radii[1].x).toBeCloseTo(4);
		expect(radii[2].x).toBeCloseTo(2 / 3);
	});

	it("keeps elliptical radii and floors negatives at 0", () => {
		expect(resolveCornerRadii(10, 10, [{ x: 3, y: 1 }, -2, 0, 0])).toEqual([
			{ x: 3, y: 1 },
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
		]);
	});
});

describe("roundedRectCurvePath", () => {
	it("is the plain box when every corner is sharp", () => {
		const path = roundedRectCurvePath(0, 0, 4, 2);
		expect(path.start).toEqual({ x: 0, y: 0 });
		// Three edges; closePath draws the fourth.
		expect(path.segments.map((s) => s.to)).toEqual([
			{ x: 4, y: 0 },
			{ x: 4, y: 2 },
			{ x: 0, y: 2 },
		]);
		expect(path.closed).toBe(true);
	});

	it("rounds each corner by its own radius and stays inside the box", () => {
		const path = roundedRectCurvePath(-2, -1, 4, 2, [0.5, 0, 0.25, 0]);
		const points = curvePathToPolyline(path);
		const bounds = boundsOf([points]);
		expect(bounds.minX).toBeCloseTo(-2);
		expect(bounds.maxX).toBeCloseTo(2);
		expect(bounds.minY).toBeCloseTo(-1);
		expect(bounds.maxY).toBeCloseTo(1);
		// The rounded top-left corner cuts the sharp corner off.
		expect(points.some((p) => p.x === -2 && p.y === 1)).toBe(false);
		// The sharp top-right corner is kept.
		expect(points.some((p) => p.x === 2 && p.y === 1)).toBe(true);
	});

	it("winds counter-clockwise, or clockwise when reversed", () => {
		const forward = curvePathToPolyline(roundedRectCurvePath(0, 0, 4, 2, 0.5));
		const backward = curvePathToPolyline(
			roundedRectCurvePath(0, 0, 4, 2, 0.5, { reverse: true }),
		);
		expect(signedArea(forward)).toBeGreaterThan(0);
		expect(signedArea(backward)).toBeLessThan(0);
	});

	it("encloses nearly the area of the true rounded rectangle", () => {
		const r = 0.5;
		const points = curvePathToPolyline(roundedRectCurvePath(0, 0, 4, 2, r));
		const exact = 4 * 2 - (4 - Math.PI) * r * r;
		expect(Math.abs(signedArea(points) - exact)).toBeLessThan(0.01);
	});
});
