import { describe, expect, it } from "vitest";
import type { Point } from "./path/types.js";
import {
	arcPolyline,
	arrowHead,
	arrowHeadAt,
	circlePolyline,
	ellipsePolyline,
	linePolyline,
	plotPolyline,
	rectPolyline,
	regularPolygon,
	segmentsForRadius,
} from "./shapes.js";

function expectPointClose(a: Point, b: Point, digits = 6) {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
}

describe("segmentsForRadius", () => {
	it("is clamped between 12 and 512", () => {
		expect(segmentsForRadius(0)).toBeGreaterThanOrEqual(12);
		expect(segmentsForRadius(1e9)).toBeLessThanOrEqual(512);
	});

	it("grows with radius", () => {
		expect(segmentsForRadius(100)).toBeGreaterThan(segmentsForRadius(1));
	});

	it("handles negative radius via abs", () => {
		expect(segmentsForRadius(-10)).toBe(segmentsForRadius(10));
	});
});

describe("circlePolyline / ellipsePolyline", () => {
	it("circle starts and ends at the same point (theta 0 and 2pi)", () => {
		const points = circlePolyline(0, 0, 5, 8);
		expectPointClose(points[0], points[points.length - 1]);
	});

	it("circle radius is honored at theta=0", () => {
		const points = circlePolyline(1, 2, 3, 16);
		expectPointClose(points[0], { x: 4, y: 2 });
	});

	it("ellipse without rotation matches independent radii on axes", () => {
		const points = ellipsePolyline(0, 0, 2, 5, 4);
		// theta=0 -> (2,0); theta=pi/2 -> (0,5)
		expectPointClose(points[0], { x: 2, y: 0 });
		expectPointClose(points[1], { x: 0, y: 5 });
	});

	it("produces segments+1 points", () => {
		expect(circlePolyline(0, 0, 1, 10).length).toBe(11);
	});
});

describe("arcPolyline", () => {
	it("start/end angles map to expected endpoints", () => {
		const points = arcPolyline(0, 0, 1, 0, Math.PI / 2, 4);
		expectPointClose(points[0], { x: 1, y: 0 });
		expectPointClose(points[points.length - 1], { x: 0, y: 1 });
	});

	it("zero sweep collapses to a single repeated point", () => {
		const points = arcPolyline(0, 0, 1, 0, 0, 4);
		for (const p of points) expectPointClose(p, { x: 1, y: 0 });
	});
});

describe("linePolyline", () => {
	it("returns copies of the two endpoints", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 1, y: 1 };
		const line = linePolyline(from, to);
		expect(line).toEqual([from, to]);
		expect(line[0]).not.toBe(from);
	});
});

describe("rectPolyline", () => {
	it("sharp corners (radius 0) give 5 points forming a closed box", () => {
		const points = rectPolyline(0, 0, 10, 4);
		expect(points.length).toBe(5);
		expectPointClose(points[0], points[4]);
		expect(points).toContainEqual({ x: 10, y: 4 });
	});

	it("radius is clamped to half the smaller dimension", () => {
		// requesting a huge radius on a small rect shouldn't throw or invert
		const points = rectPolyline(0, 0, 4, 2, 100, 4);
		expect(points.length).toBeGreaterThan(0);
		for (const p of points) {
			expect(Number.isFinite(p.x)).toBe(true);
			expect(Number.isFinite(p.y)).toBe(true);
		}
	});

	it("rounded rect closes back to its first point", () => {
		const points = rectPolyline(0, 0, 10, 10, 2, 4);
		expectPointClose(points[0], points[points.length - 1]);
	});
});

describe("regularPolygon", () => {
	it("produces sides+1 points, closed", () => {
		const points = regularPolygon(0, 0, 1, 5);
		expect(points.length).toBe(6);
		expectPointClose(points[0], points[5]);
	});

	it("default rotation puts the first vertex at the top", () => {
		const points = regularPolygon(0, 0, 1, 4);
		expectPointClose(points[0], { x: 0, y: 1 });
	});

	it("all vertices are equidistant from center", () => {
		const points = regularPolygon(0, 0, 3, 6);
		for (const p of points) {
			expect(Math.hypot(p.x, p.y)).toBeCloseTo(3, 9);
		}
	});
});

describe("arrowHead / arrowHeadAt", () => {
	it("tip is the middle point, pointing away from `from`", () => {
		const head = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
		expectPointClose(head[1], { x: 10, y: 0 });
	});

	it("arrowHead and arrowHeadAt agree when given the equivalent bearing", () => {
		const from = { x: 0, y: 0 };
		const tip = { x: 5, y: 5 };
		const viaFrom = arrowHead(from, tip, 1);
		const viaAngle = arrowHeadAt(tip, Math.atan2(5, 5), 1);
		for (let i = 0; i < 3; i++) expectPointClose(viaFrom[i], viaAngle[i]);
	});

	it("the two wing points are symmetric about the shaft", () => {
		const head = arrowHeadAt({ x: 0, y: 0 }, 0, 1);
		expect(head[0].y).toBeCloseTo(-head[2].y, 9);
	});
});

describe("plotPolyline", () => {
	it("samples+1 points", () => {
		const points = plotPolyline((t) => ({ x: t, y: t * t }), 0, 1, 10);
		expect(points.length).toBe(11);
	});

	it("first and last samples match the endpoints", () => {
		const points = plotPolyline((t) => ({ x: t, y: t * t }), 0, 2, 5);
		expectPointClose(points[0], { x: 0, y: 0 });
		expectPointClose(points[points.length - 1], { x: 2, y: 4 });
	});
});

describe("shape input robustness", () => {
	it("rounded rect with negative size stays inside its box", () => {
		const pts = rectPolyline(10, 10, -4, -6, 1);
		for (const p of pts) {
			expect(p.x).toBeGreaterThanOrEqual(6 - 1e-9);
			expect(p.x).toBeLessThanOrEqual(10 + 1e-9);
			expect(p.y).toBeGreaterThanOrEqual(4 - 1e-9);
			expect(p.y).toBeLessThanOrEqual(10 + 1e-9);
		}
	});

	it("zero segment/side counts never emit NaN", () => {
		const all = [
			...ellipsePolyline(0, 0, 1, 1, 0),
			...regularPolygon(0, 0, 1, 0),
			...plotPolyline((t) => ({ x: t, y: t }), 0, 1, 0),
			...arcPolyline(0, 0, 1, 0, 1, 0),
		];
		for (const p of all) {
			expect(Number.isFinite(p.x)).toBe(true);
			expect(Number.isFinite(p.y)).toBe(true);
		}
	});
});
