import { describe, expect, it } from "vitest";
import { implicitCurve } from "./implicit";
import type { Point } from "./path/types";

/** Twice the signed area: positive for a counter-clockwise loop. */
function signedArea(points: Point[]): number {
	let sum = 0;
	for (let k = 0; k < points.length; k++) {
		const a = points[k];
		const b = points[(k + 1) % points.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum;
}

describe("implicitCurve", () => {
	it("traces x² + y² − 1 = 0 as one closed, counter-clockwise loop on the unit circle", () => {
		const pieces = implicitCurve((x, y) => x * x + y * y - 1, [-2, 2], [-2, 2]);
		expect(pieces).toHaveLength(1);
		const [circle] = pieces;
		expect(circle.closed).toBe(true);
		expect(circle.points.length).toBeGreaterThan(100);
		for (const p of circle.points) {
			expect(Math.abs(Math.hypot(p.x, p.y) - 1)).toBeLessThan(1e-3);
		}
		expect(signedArea(circle.points)).toBeGreaterThan(0);
		// A loop doesn't repeat its first point.
		expect(circle.points[0]).not.toEqual(circle.points.at(-1));
	});

	it("refines: a larger budget is more accurate than none", () => {
		const f = (x: number, y: number) => x * x + y * y - 1;
		const error = (maxQuads: number) =>
			Math.max(
				...implicitCurve(f, [-2, 2], [-2, 2], { maxQuads })[0].points.map((p) =>
					Math.abs(Math.hypot(p.x, p.y) - 1),
				),
			);
		const coarse = error(0);
		const fine = error(5000);
		expect(fine).toBeLessThan(coarse / 4);
	});

	it("finds every component, each closed", () => {
		// Two unit circles, centred at (±2, 0).
		const f = (x: number, y: number) =>
			Math.min((x - 2) ** 2 + y * y - 1, (x + 2) ** 2 + y * y - 1);
		const pieces = implicitCurve(f, [-4, 4], [-2, 2]);
		expect(pieces).toHaveLength(2);
		const centres = pieces
			.map(({ points }) => points.reduce((s, p) => s + p.x, 0) / points.length)
			.sort((a, b) => a - b);
		expect(centres[0]).toBeCloseTo(-2, 2);
		expect(centres[1]).toBeCloseTo(2, 2);
		for (const piece of pieces) expect(piece.closed).toBe(true);
	});

	it("leaves a curve that crosses the rectangle open at its edges", () => {
		// The line y = x across the square: one open piece from corner to corner.
		const pieces = implicitCurve((x, y) => y - x, [-1, 1], [-1, 1]);
		expect(pieces).toHaveLength(1);
		expect(pieces[0].closed).toBe(false);
		for (const p of pieces[0].points) expect(p.y).toBeCloseTo(p.x, 9);
	});

	it("separates the two branches of a hyperbola, saddle and all", () => {
		const pieces = implicitCurve(
			(x, y) => x * x - y * y - 0.25,
			[-2, 2],
			[-2, 2],
		);
		expect(pieces).toHaveLength(2);
		for (const { points } of pieces) {
			const side = Math.sign(points[0].x);
			for (const p of points) {
				expect(Math.sign(p.x)).toBe(side);
				expect(Math.abs(p.x * p.x - p.y * p.y - 0.25)).toBeLessThan(1e-2);
			}
		}
	});

	it("returns nothing when f has no root, or the rectangle is degenerate", () => {
		expect(
			implicitCurve((x, y) => x * x + y * y + 1, [-2, 2], [-2, 2]),
		).toEqual([]);
		expect(implicitCurve((x, y) => x - y, [0, 0], [-1, 1])).toEqual([]);
	});

	it("breaks the curve at non-finite values instead of joining across them", () => {
		const pieces = implicitCurve(
			(x, y) => (x > 0.5 ? Number.NaN : x * x + y * y - 1),
			[-2, 2],
			[-2, 2],
		);
		expect(pieces).toHaveLength(1);
		expect(pieces[0].closed).toBe(false);
		for (const p of pieces[0].points) expect(p.x).toBeLessThanOrEqual(0.5);
	});
});
