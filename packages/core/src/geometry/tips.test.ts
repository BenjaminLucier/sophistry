import { describe, expect, it } from "vitest";
import { curvePathToPolyline } from "./path/svg-path.js";
import type { Point } from "./path/types.js";
import type { TipShape } from "./tips.js";
import { tipIsClosed, tipPolylines } from "./tips.js";

function expectPointClose(a: Point, b: Point, digits = 6) {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
}

const ALL_SHAPES: TipShape[] = [
	"vee",
	"triangle",
	"stealth",
	"circle",
	"square",
];

describe("tipIsClosed", () => {
	it("everything but vee is closed", () => {
		for (const shape of ALL_SHAPES) {
			expect(tipIsClosed(shape)).toBe(shape !== "vee");
		}
	});
});

describe("tipPolylines", () => {
	it("closed flag matches tipIsClosed for every shape", () => {
		for (const shape of ALL_SHAPES) {
			const geo = tipPolylines(shape, { x: 0, y: 0 }, 0, 5);
			expect(geo.closed).toBe(tipIsClosed(shape));
		}
	});

	it("vee's first polyline point is the tip itself", () => {
		const tip = { x: 3, y: 4 };
		const geo = tipPolylines("vee", tip, 0, 2);
		expectPointClose(geo.polylines[0][1], tip);
	});

	it("triangle starts at the tip and returns to it (closed)", () => {
		const tip = { x: 0, y: 0 };
		const geo = tipPolylines("triangle", tip, Math.PI / 2, 3);
		const ring = geo.polylines[0];
		expectPointClose(ring[1], tip);
	});

	it("stealth's outline starts at the tip", () => {
		const tip = { x: 1, y: 1 };
		const geo = tipPolylines("stealth", tip, 0, 4);
		expectPointClose(geo.polylines[0][0], tip);
	});

	it("circle tip geometry is centred length/2 back from the tip", () => {
		const tip = { x: 0, y: 0 };
		const length = 4;
		const geo = tipPolylines("circle", tip, 0, length);
		const points = geo.polylines[0];
		// Bounding-box centre of the circle polyline is its true centre.
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const p of points) {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		}
		// direction 0 => back = (-1, 0); centre = tip + back*0.5*length
		expectPointClose(
			{ x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
			{ x: -2, y: 0 },
		);
	});

	it("square tip has 4 corners forming a closed rectangle back from the tip", () => {
		const tip = { x: 0, y: 0 };
		const geo = tipPolylines("square", tip, 0, 2);
		const ring = geo.polylines[0];
		expect(ring.length).toBe(5); // closePolyline repeats first point
		expectPointClose(ring[0], ring[4]);
	});

	it("all produced coordinates are finite for every shape/direction", () => {
		for (const shape of ALL_SHAPES) {
			for (const direction of [0, Math.PI / 4, Math.PI, -Math.PI / 2]) {
				const geo = tipPolylines(shape, { x: 5, y: -3 }, direction, 1.5);
				for (const line of geo.polylines) {
					for (const p of line) {
						expect(Number.isFinite(p.x)).toBe(true);
						expect(Number.isFinite(p.y)).toBe(true);
					}
				}
			}
		}
	});

	it("every shape returns a non-empty curvePaths", () => {
		for (const shape of ALL_SHAPES) {
			const geo = tipPolylines(shape, { x: 0, y: 0 }, 0, 5);
			expect(geo.curvePaths.length).toBeGreaterThan(0);
			for (const curve of geo.curvePaths) {
				expect(curve.segments.length).toBeGreaterThan(0);
			}
		}
	});

	it("curvePaths' closed flag matches the polylines' implied closure", () => {
		for (const shape of ALL_SHAPES) {
			const geo = tipPolylines(shape, { x: 0, y: 0 }, 0, 5);
			for (const curve of geo.curvePaths) {
				expect(curve.closed).toBe(geo.closed);
			}
		}
	});

	it("circle produces a genuinely curved curvePath, not a degenerate straight-run one", () => {
		const geo = tipPolylines("circle", { x: 0, y: 0 }, 0, 4);
		expect(geo.curvePaths.length).toBe(1);
		const curve = geo.curvePaths[0];
		expect(curve.segments.length).toBeGreaterThan(0);
		// A straight run's control points sit at the collinear-thirds points a
		// `lineSegment` would use; a genuine curve's don't.
		let cursor = curve.start;
		for (const segment of curve.segments) {
			const thirdC1 = {
				x: cursor.x + (segment.to.x - cursor.x) / 3,
				y: cursor.y + (segment.to.y - cursor.y) / 3,
			};
			const isStraight =
				Math.abs(segment.c1.x - thirdC1.x) < 1e-6 &&
				Math.abs(segment.c1.y - thirdC1.y) < 1e-6;
			expect(isStraight).toBe(false);
			cursor = segment.to;
		}
	});

	it("circle's curvePath flattens to the same bounding box as its polyline", () => {
		const tip = { x: 1, y: 2 };
		const length = 3;
		const geo = tipPolylines("circle", tip, 0, length);
		const flattened = curvePathToPolyline(geo.curvePaths[0]);
		const bbox = (points: Point[]) => {
			let minX = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			let minY = Number.POSITIVE_INFINITY;
			let maxY = Number.NEGATIVE_INFINITY;
			for (const p of points) {
				minX = Math.min(minX, p.x);
				maxX = Math.max(maxX, p.x);
				minY = Math.min(minY, p.y);
				maxY = Math.max(maxY, p.y);
			}
			return { minX, maxX, minY, maxY };
		};
		const a = bbox(geo.polylines[0]);
		const b = bbox(flattened);
		expect(a.minX).toBeCloseTo(b.minX, 3);
		expect(a.maxX).toBeCloseTo(b.maxX, 3);
		expect(a.minY).toBeCloseTo(b.minY, 3);
		expect(a.maxY).toBeCloseTo(b.maxY, 3);
	});

	it("non-circle curvePaths flatten to the same points as the polylines", () => {
		for (const shape of ALL_SHAPES) {
			if (shape === "circle") continue;
			const geo = tipPolylines(shape, { x: 2, y: -1 }, Math.PI / 3, 2.5);
			for (let i = 0; i < geo.polylines.length; i++) {
				const flattened = curvePathToPolyline(geo.curvePaths[i]);
				const poly = geo.polylines[i];
				expect(flattened.length).toBe(poly.length);
				for (let j = 0; j < poly.length; j++) {
					expect(flattened[j].x).toBeCloseTo(poly[j].x, 6);
					expect(flattened[j].y).toBeCloseTo(poly[j].y, 6);
				}
			}
		}
	});
});
