import { describe, expect, it } from "vitest";
import { delaunayTriangleIndices } from "./delaunay";

/** Shoelace area of a convex hull given as ordered vertices. */
function polygonArea(points: { x: number; y: number }[]): number {
	let sum = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[i + 1] ?? points[0];
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

function triangleArea(
	a: { x: number; y: number },
	b: { x: number; y: number },
	c: { x: number; y: number },
): number {
	return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

describe("delaunayTriangleIndices", () => {
	it("returns [] for fewer than 3 points", () => {
		expect(delaunayTriangleIndices([0, 1], [0, 1])).toEqual([]);
		expect(delaunayTriangleIndices([], [])).toEqual([]);
	});

	it("returns [] for collinear points", () => {
		expect(delaunayTriangleIndices([0, 1, 2, 3], [0, 1, 2, 3])).toEqual([]);
	});

	it("every triangle has 3 distinct, in-range indices", () => {
		const xs = [0, 1, 0, 1, 0.5];
		const ys = [0, 0, 1, 1, 0.5];
		const triangles = delaunayTriangleIndices(xs, ys);
		expect(triangles.length).toBeGreaterThan(0);
		for (const [a, b, c] of triangles) {
			expect(new Set([a, b, c]).size).toBe(3);
			for (const i of [a, b, c]) {
				expect(i).toBeGreaterThanOrEqual(0);
				expect(i).toBeLessThan(xs.length);
			}
		}
	});

	it("triangulates a square plus centre point (5 points) into 4 triangles covering the square's area", () => {
		const xs = [0, 1, 0, 1, 0.5];
		const ys = [0, 0, 1, 1, 0.5];
		const triangles = delaunayTriangleIndices(xs, ys);
		expect(triangles).toHaveLength(4);

		const totalArea = triangles.reduce(
			(sum, [a, b, c]) =>
				sum +
				triangleArea(
					{ x: xs[a], y: ys[a] },
					{ x: xs[b], y: ys[b] },
					{ x: xs[c], y: ys[c] },
				),
			0,
		);
		expect(totalArea).toBeCloseTo(1); // the unit square's area
	});

	it("triangulates a 3x3 grid into triangles whose total area equals the hull's area", () => {
		const xs: number[] = [];
		const ys: number[] = [];
		for (let r = 0; r < 3; r++) {
			for (let c = 0; c < 3; c++) {
				xs.push(c);
				ys.push(r);
			}
		}
		const triangles = delaunayTriangleIndices(xs, ys);
		expect(triangles.length).toBeGreaterThan(0);

		const totalArea = triangles.reduce(
			(sum, [a, b, c]) =>
				sum +
				triangleArea(
					{ x: xs[a], y: ys[a] },
					{ x: xs[b], y: ys[b] },
					{ x: xs[c], y: ys[c] },
				),
			0,
		);
		const hullArea = polygonArea([
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 2 },
			{ x: 0, y: 2 },
		]);
		expect(totalArea).toBeCloseTo(hullArea);
	});

	it("does not crash on duplicate/near-duplicate points", () => {
		const xs = [0, 1, 0, 1, 0.5, 0.5 + 1e-12];
		const ys = [0, 0, 1, 1, 0.5, 0.5 + 1e-12];
		expect(() => delaunayTriangleIndices(xs, ys)).not.toThrow();
	});
});
