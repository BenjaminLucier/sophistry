import { describe, expect, it } from "vitest";
import { boundsOf, centerOf, pointOnBounds } from "../bounds.js";
import {
	measure,
	measureCurve,
	normalAtT,
	pointAtT,
	resample,
	revealedPolylines,
	sliceAtT,
	sliceBetween,
	sliceCurveAtT,
	sliceCurveBetween,
	tangentAtT,
} from "./arclength.js";
import {
	arcCubics,
	cubicArcLength,
	flattenCubicPolyline,
	lineSegment,
	quadraticToCubic,
	splitCubicAt,
} from "./cubic.js";
import {
	closePolyline,
	curvePathToPolyline,
	flattenPath,
	parsePathData,
	pathDataToCurvePath,
	polylineToCurvePath,
	toPathData,
} from "./svg-path.js";
import type { CurvePath, Point, Polyline } from "./types.js";

function expectPointClose(a: Point, b: Point, digits = 6) {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
}

describe("parsePathData", () => {
	it("expands implicit repeats of a command", () => {
		const segments = parsePathData("M0 0 1 1 2 2");
		expect(segments).toEqual([
			{ command: "M", args: [0, 0] },
			{ command: "L", args: [1, 1] },
			{ command: "L", args: [2, 2] },
		]);
	});

	it("handles lowercase relative implicit repeats", () => {
		const segments = parsePathData("m0 0 1 1");
		expect(segments).toEqual([
			{ command: "m", args: [0, 0] },
			{ command: "l", args: [1, 1] },
		]);
	});

	it("parses Z with no args", () => {
		const segments = parsePathData("M0 0L1 1Z");
		expect(segments[segments.length - 1]).toEqual({ command: "Z", args: [] });
	});

	it("handles scientific notation numbers", () => {
		const segments = parsePathData("M1e2 -2.5e-1");
		expect(segments[0].args).toEqual([100, -0.25]);
	});

	it("returns empty array for empty string", () => {
		expect(parsePathData("")).toEqual([]);
	});
});

describe("flattenCubicPolyline", () => {
	it("includes p0 as the first point", () => {
		const p0 = { x: 0, y: 0 };
		const line = flattenCubicPolyline(
			p0,
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 3, y: 0 },
		);
		expectPointClose(line[0], p0);
	});

	it("ends exactly at p1", () => {
		const p1 = { x: 3, y: 4 };
		const line = flattenCubicPolyline(
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 4 },
			p1,
		);
		expectPointClose(line[line.length - 1], p1);
	});

	it("a straight-line cubic (colinear controls) flattens to just the two endpoints", () => {
		const p0 = { x: 0, y: 0 };
		const p1 = { x: 10, y: 0 };
		const line = flattenCubicPolyline(p0, { x: 3, y: 0 }, { x: 7, y: 0 }, p1);
		expect(line.length).toBe(2);
	});

	it("a cubic with a NaN point stops at once rather than subdividing to the depth cap", () => {
		const line = flattenCubicPolyline(
			{ x: 0, y: 0 },
			{ x: Number.NaN, y: 1 },
			{ x: 2, y: 1 },
			{ x: 3, y: 0 },
		);
		expect(line.length).toBe(2);
	});
});

describe("quadraticToCubic", () => {
	it("degree-elevates without moving the endpoints", () => {
		const p0 = { x: 0, y: 0 };
		const p1 = { x: 4, y: 0 };
		const [q0, , , q1] = quadraticToCubic(p0, { x: 2, y: 4 }, p1);
		expectPointClose(q0, p0);
		expectPointClose(q1, p1);
	});

	it("produces control points at 2/3 along the way to the quad control", () => {
		const [, c0, c1] = quadraticToCubic(
			{ x: 0, y: 0 },
			{ x: 3, y: 0 },
			{ x: 6, y: 0 },
		);
		expectPointClose(c0, { x: 2, y: 0 });
		expectPointClose(c1, { x: 4, y: 0 });
	});
});

describe("flattenPath", () => {
	it("flattens a simple M/L path into one open subpath", () => {
		const subpaths = flattenPath("M0 0 L10 0 L10 10");
		expect(subpaths.length).toBe(1);
		expect(subpaths[0].closed).toBe(false);
		expectPointClose(subpaths[0].points[0], { x: 0, y: 0 });
		expectPointClose(subpaths[0].points[subpaths[0].points.length - 1], {
			x: 10,
			y: 10,
		});
	});

	it("Z closes the subpath geometrically (repeats the first point)", () => {
		const subpaths = flattenPath("M0 0 L10 0 L10 10 Z");
		expect(subpaths[0].closed).toBe(true);
		const points = subpaths[0].points;
		expectPointClose(points[0], points[points.length - 1]);
	});

	it("handles H and V commands", () => {
		const subpaths = flattenPath("M0 0 H5 V5");
		const points = subpaths[0].points;
		expectPointClose(points[0], { x: 0, y: 0 });
		expectPointClose(points[1], { x: 5, y: 0 });
		expectPointClose(points[2], { x: 5, y: 5 });
	});

	it("relative commands accumulate on the cursor", () => {
		const subpaths = flattenPath("m1 1 l2 2 l-1 0");
		const points = subpaths[0].points;
		expectPointClose(points[0], { x: 1, y: 1 });
		expectPointClose(points[1], { x: 3, y: 3 });
		expectPointClose(points[2], { x: 2, y: 3 });
	});

	it("handles multiple subpaths", () => {
		const subpaths = flattenPath("M0 0 L1 1 M5 5 L6 6");
		expect(subpaths.length).toBe(2);
	});

	it("drops single-point subpaths", () => {
		// A lone M with nothing following produces a subpath of length 1, filtered out.
		const subpaths = flattenPath("M0 0 M5 5 L6 6");
		expect(subpaths.length).toBe(1);
	});

	it("empty path data returns no subpaths", () => {
		expect(flattenPath("")).toEqual([]);
	});

	it("S without a preceding C reflects off the current point", () => {
		// Just check it doesn't throw and produces a sensible curve endpoint.
		const subpaths = flattenPath("M0 0 S5 5 10 0");
		const points = subpaths[0].points;
		expectPointClose(points[points.length - 1], { x: 10, y: 0 });
	});

	it("degenerate arc radius (rx=0) is treated as a straight line", () => {
		const subpaths = flattenPath("M0 0 A0 5 0 0 1 10 0");
		const points = subpaths[0].points;
		expectPointClose(points[0], { x: 0, y: 0 });
		expectPointClose(points[points.length - 1], { x: 10, y: 0 });
	});

	it("A full-circle-ish arc round trips endpoints", () => {
		const subpaths = flattenPath("M10 0 A10 10 0 1 1 -10 0");
		const points = subpaths[0].points;
		expectPointClose(points[0], { x: 10, y: 0 });
		expectPointClose(points[points.length - 1], { x: -10, y: 0 });
	});

	it("an elliptical arc (rx != ry) round trips its endpoints", () => {
		const subpaths = flattenPath("M0 0 A5 2 0 0 1 10 0");
		const points = subpaths[0].points;
		expectPointClose(points[0], { x: 0, y: 0 });
		expectPointClose(points[points.length - 1], { x: 10, y: 0 });
		// The ellipse should bulge (not stay on the chord), proving both radii
		// actually took effect rather than collapsing to a circle or a line.
		const maxDeviation = Math.max(...points.map((p) => Math.abs(p.y)));
		expect(maxDeviation).toBeGreaterThan(0);
	});

	it("a rotated arc (rotationDeg != 0) still round trips its endpoints", () => {
		const subpaths = flattenPath("M0 0 A5 2 45 0 1 10 0");
		const points = subpaths[0].points;
		expectPointClose(points[0], { x: 0, y: 0 });
		expectPointClose(points[points.length - 1], { x: 10, y: 0 });
	});

	it("a rotated ellipse traces a visibly different path than the unrotated one", () => {
		const unrotated = flattenPath("M0 0 A5 2 0 0 1 10 0")[0].points;
		const rotated = flattenPath("M0 0 A5 2 45 0 1 10 0")[0].points;
		// Compare the midpoint-ish sample of each; a 45 degree rotation of a
		// non-circular ellipse should move the arc's belly to a different y.
		const midOf = (pts: Polyline) => pts[Math.floor(pts.length / 2)];
		const a = midOf(unrotated);
		const b = midOf(rotated);
		expect(Math.abs(a.y - b.y)).toBeGreaterThan(0.05);
	});

	it("all four largeArc/sweep flag combinations produce finite, endpoint-correct arcs", () => {
		const p0 = { x: 10, y: 0 };
		const p1 = { x: -10, y: 0 };
		for (const largeArc of [0, 1]) {
			for (const sweep of [0, 1]) {
				const subpaths = flattenPath(
					`M${p0.x} ${p0.y} A10 10 0 ${largeArc} ${sweep} ${p1.x} ${p1.y}`,
				);
				const points = subpaths[0].points;
				expectPointClose(points[0], p0);
				expectPointClose(points[points.length - 1], p1);
				for (const p of points) {
					expect(Number.isFinite(p.x)).toBe(true);
					expect(Number.isFinite(p.y)).toBe(true);
				}
			}
		}
	});

	it("largeArc=1 sweeps the long way around (bigger bounding box) than largeArc=0", () => {
		// Radius 15 with endpoints 20 apart leaves room for genuinely different
		// large/small arcs; at the maximal radius (10, == half the chord) both
		// "large" and "small" happen to be equal semicircles, which would hide
		// the distinction this test is after.
		const short = flattenPath("M10 0 A15 15 0 0 1 -10 0")[0].points;
		const long = flattenPath("M10 0 A15 15 0 1 1 -10 0")[0].points;
		const spanY = (pts: Polyline) =>
			Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
		expect(spanY(long)).toBeGreaterThan(spanY(short));
	});

	it("sweep flips which side of the chord the arc bulges toward", () => {
		const sweepOff = flattenPath("M10 0 A10 10 0 0 0 -10 0")[0].points;
		const sweepOn = flattenPath("M10 0 A10 10 0 0 1 -10 0")[0].points;
		const midY = (pts: Polyline) => pts[Math.floor(pts.length / 2)].y;
		// One bulges up, the other down.
		expect(Math.sign(midY(sweepOff))).not.toBe(Math.sign(midY(sweepOn)));
	});

	it("radii too small for the endpoints are rescaled up (lambda > 1 branch)", () => {
		// Endpoints are 10 apart but the requested radius is 1 — geometrically
		// impossible for a radius-1 arc to span them, so arcToCubics must scale
		// rx/ry up rather than produce NaN or an arc that doesn't reach p1.
		const subpaths = flattenPath("M0 0 A1 1 0 0 1 10 0");
		const points = subpaths[0].points;
		expectPointClose(points[0], { x: 0, y: 0 });
		expectPointClose(points[points.length - 1], { x: 10, y: 0 });
		for (const p of points) {
			expect(Number.isFinite(p.x)).toBe(true);
			expect(Number.isFinite(p.y)).toBe(true);
		}
	});

	it("T (smooth quadratic) reflects the previous Q's control point, matching an explicit Q", () => {
		const viaT = flattenPath("M0 0 Q5 5 10 0 T20 0");
		const viaExplicitQ = flattenPath("M0 0 Q5 5 10 0 Q15 -5 20 0");
		expect(viaT[0].points.length).toBe(viaExplicitQ[0].points.length);
		for (let i = 0; i < viaT[0].points.length; i++) {
			expectPointClose(viaT[0].points[i], viaExplicitQ[0].points[i], 6);
		}
	});

	it("T without a preceding Q reflects off the current point (control == cursor)", () => {
		// With no prior quadratic, T's implicit control is the current point
		// itself, per spec — same as Q with a control equal to the cursor.
		const viaT = flattenPath("M0 0 T10 0");
		const viaExplicitQ = flattenPath("M0 0 Q0 0 10 0");
		expect(viaT[0].points).toEqual(viaExplicitQ[0].points);
	});
});

describe("pathDataToCurvePath", () => {
	it("flattens an M/L path into one open curve of line segments", () => {
		const curves = pathDataToCurvePath("M0 0 L10 0 L10 10");
		expect(curves.length).toBe(1);
		expect(curves[0].closed).toBe(false);
		expectPointClose(curves[0].start, { x: 0, y: 0 });
		expect(curves[0].segments).toEqual([
			lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }),
			lineSegment({ x: 10, y: 0 }, { x: 10, y: 10 }),
		]);
	});

	it("Z closes the curve as a flag, without duplicating a point", () => {
		const curves = pathDataToCurvePath("M0 0 L10 0 L10 10 Z");
		expect(curves[0].closed).toBe(true);
		expect(curves[0].segments.length).toBe(2);
	});

	it("handles H and V commands as line segments", () => {
		const curves = pathDataToCurvePath("M0 0 H5 V5");
		expect(curves[0].segments).toEqual([
			lineSegment({ x: 0, y: 0 }, { x: 5, y: 0 }),
			lineSegment({ x: 5, y: 0 }, { x: 5, y: 5 }),
		]);
	});

	it("relative commands accumulate on the cursor", () => {
		const curves = pathDataToCurvePath("m1 1 l2 2 l-1 0");
		expectPointClose(curves[0].start, { x: 1, y: 1 });
		expect(curves[0].segments).toEqual([
			lineSegment({ x: 1, y: 1 }, { x: 3, y: 3 }),
			lineSegment({ x: 3, y: 3 }, { x: 2, y: 3 }),
		]);
	});

	it("handles multiple subpaths", () => {
		const curves = pathDataToCurvePath("M0 0 L1 1 M5 5 L6 6");
		expect(curves.length).toBe(2);
	});

	it("drops single-point (segment-less) subpaths", () => {
		const curves = pathDataToCurvePath("M0 0 M5 5 L6 6");
		expect(curves.length).toBe(1);
	});

	it("empty path data returns no curves", () => {
		expect(pathDataToCurvePath("")).toEqual([]);
	});

	it("C produces a single cubic segment with the given control points", () => {
		const curves = pathDataToCurvePath("M0 0 C1 1 2 1 3 0");
		expect(curves[0].segments).toEqual([
			{
				c1: { x: 1, y: 1 },
				c2: { x: 2, y: 1 },
				to: { x: 3, y: 0 },
			},
		]);
	});

	it("S reflects the previous C's second control point", () => {
		const curves = pathDataToCurvePath("M0 0 C1 1 2 1 3 0 S5 -1 6 0");
		const seg = curves[0].segments[1];
		// Reflection of (2,1) through (3,0) is (4,-1).
		expectPointClose(seg.c1, { x: 4, y: -1 });
		expectPointClose(seg.c2, { x: 5, y: -1 });
		expectPointClose(seg.to, { x: 6, y: 0 });
	});

	it("S without a preceding C reflects off the current point", () => {
		const curves = pathDataToCurvePath("M0 0 S5 5 10 0");
		const seg = curves[0].segments[0];
		expectPointClose(seg.c1, { x: 0, y: 0 });
	});

	it("Q elevates to a cubic matching quadraticToCubic", () => {
		const curves = pathDataToCurvePath("M0 0 Q3 0 6 0");
		const [, c1, c2] = quadraticToCubic(
			{ x: 0, y: 0 },
			{ x: 3, y: 0 },
			{ x: 6, y: 0 },
		);
		const seg = curves[0].segments[0];
		expectPointClose(seg.c1, c1);
		expectPointClose(seg.c2, c2);
		expectPointClose(seg.to, { x: 6, y: 0 });
	});

	it("T reflects the previous Q's control point, matching an explicit Q", () => {
		const viaT = pathDataToCurvePath("M0 0 Q5 5 10 0 T20 0");
		const viaExplicitQ = pathDataToCurvePath("M0 0 Q5 5 10 0 Q15 -5 20 0");
		expect(viaT[0].segments.length).toBe(viaExplicitQ[0].segments.length);
		const a = viaT[0].segments[1];
		const b = viaExplicitQ[0].segments[1];
		expectPointClose(a.c1, b.c1);
		expectPointClose(a.c2, b.c2);
		expectPointClose(a.to, b.to);
	});

	it("T without a preceding Q reflects off the current point (control == cursor)", () => {
		const viaT = pathDataToCurvePath("M0 0 T10 0");
		const viaExplicitQ = pathDataToCurvePath("M0 0 Q0 0 10 0");
		expect(viaT).toEqual(viaExplicitQ);
	});

	it("degenerate arc radius (rx=0) is treated as a straight line", () => {
		const curves = pathDataToCurvePath("M0 0 A0 5 0 0 1 10 0");
		expect(curves[0].segments.length).toBe(1);
		expectPointClose(endPoint(curves[0]), { x: 10, y: 0 });
	});

	it("a full-circle-ish arc round trips endpoints across several genuinely-curved segments", () => {
		const curves = pathDataToCurvePath("M10 0 A10 10 0 1 1 -10 0");
		expectPointClose(curves[0].start, { x: 10, y: 0 });
		expectPointClose(endPoint(curves[0]), { x: -10, y: 0 });
		expect(curves[0].segments.length).toBeGreaterThan(1);
		// Every segment should be a real curve, not a straight run in cubic
		// clothing: its control points must NOT sit at the collinear-thirds
		// points `lineSegment` would put them at.
		let cursor = curves[0].start;
		for (const seg of curves[0].segments) {
			const thirdC1 = {
				x: cursor.x + (seg.to.x - cursor.x) / 3,
				y: cursor.y + (seg.to.y - cursor.y) / 3,
			};
			const isCollinearThirds =
				Math.abs(seg.c1.x - thirdC1.x) < 1e-6 &&
				Math.abs(seg.c1.y - thirdC1.y) < 1e-6;
			expect(isCollinearThirds).toBe(false);
			cursor = seg.to;
		}
	});

	it("an elliptical, rotated arc round trips its endpoints", () => {
		const curves = pathDataToCurvePath("M0 0 A5 2 45 0 1 10 0");
		expectPointClose(curves[0].start, { x: 0, y: 0 });
		expectPointClose(endPoint(curves[0]), { x: 10, y: 0 });
	});

	it("cross-check: segments reproduce the same endpoints flattenPath's flattener visits", () => {
		const samples = [
			"M0 0 L10 0 L10 10 Z",
			"M0 0 C1 1 2 1 3 0 S5 -1 6 0",
			"M0 0 Q3 4 6 0 T12 0",
			"M10 0 A10 10 0 1 1 -10 0",
			"M0 0 L5 5 M10 10 C11 11 12 11 13 10",
		];
		for (const d of samples) {
			const curves = pathDataToCurvePath(d);
			const subpaths = flattenPath(d);
			expect(curves.length).toBe(subpaths.length);
			for (let i = 0; i < curves.length; i++) {
				const curve = curves[i];
				const sub = subpaths[i];
				expectPointClose(curve.start, sub.points[0]);
				// Walk the curve, evaluating each cubic at t=1 (or using `to`
				// directly for lines), and confirm it lands on the flattened
				// polyline's last point for that same command.
				let cursor = curve.start;
				const visited: Point[] = [cursor];
				for (const seg of curve.segments) {
					visited.push(evalCubicAt(cursor, seg.c1, seg.c2, seg.to, 1));
					cursor = seg.to;
				}
				// `flattenPath` closes a `Z` subpath geometrically (repeats the
				// first point); `pathDataToCurvePath` closes it as a flag instead,
				// with no synthetic closing segment — so compare against the last
				// *drawn* point, before that geometric repeat.
				const expectedEnd = curve.closed
					? sub.points[sub.points.length - 2]
					: sub.points[sub.points.length - 1];
				expectPointClose(visited[visited.length - 1], expectedEnd, 6);
			}
		}
	});
});

describe("curvePathToPolyline", () => {
	it("a pure-line curve flattens to exactly its anchor points", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 1, y: 0 }),
				lineSegment({ x: 1, y: 0 }, { x: 1, y: 1 }),
			],
			closed: false,
		};
		const polyline = curvePathToPolyline(curve);
		expect(polyline).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		]);
	});

	it("a curve with a cubic segment subdivides and preserves the endpoints", () => {
		const p0 = { x: 0, y: 0 };
		const p1 = { x: 10, y: 0 };
		const curve: CurvePath = {
			start: p0,
			segments: [{ c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: p1 }],
			closed: false,
		};
		const polyline = curvePathToPolyline(curve);
		expect(polyline.length).toBeGreaterThan(2);
		expectPointClose(polyline[0], p0);
		expectPointClose(polyline[polyline.length - 1], p1);
	});

	it("a closed curve repeats its first point at the end", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 1, y: 0 }),
				lineSegment({ x: 1, y: 0 }, { x: 1, y: 1 }),
			],
			closed: true,
		};
		const polyline = curvePathToPolyline(curve);
		expectPointClose(polyline[polyline.length - 1], curve.start);
	});

	it("agrees with flattenCubicPolyline for a single-cubic-segment curve", () => {
		const p0 = { x: 0, y: 0 };
		const c1 = { x: 0, y: 10 };
		const c2 = { x: 10, y: 10 };
		const p1 = { x: 10, y: 0 };
		const curve: CurvePath = {
			start: p0,
			segments: [{ c1, c2, to: p1 }],
			closed: false,
		};
		const fromCurve = curvePathToPolyline(curve);
		const fromCubic = flattenCubicPolyline(p0, c1, c2, p1);
		expect(fromCurve).toEqual(fromCubic);
	});

	it("passes tolerance through to the cubic flattener", () => {
		const p0 = { x: 0, y: 0 };
		const c1 = { x: 0, y: 10 };
		const c2 = { x: 10, y: 10 };
		const p1 = { x: 10, y: 0 };
		const curve: CurvePath = {
			start: p0,
			segments: [{ c1, c2, to: p1 }],
			closed: false,
		};
		const coarse = curvePathToPolyline(curve, 0.5);
		const fine = curvePathToPolyline(curve, 0.00001);
		expect(fine.length).toBeGreaterThan(coarse.length);
	});
});

describe("closePolyline", () => {
	it("appends a copy of the first point when not already closed", () => {
		const points: Polyline = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		];
		const closed = closePolyline(points);
		expect(closed.length).toBe(4);
		expectPointClose(closed[3], points[0]);
	});

	it("is a no-op when already closed", () => {
		const points: Polyline = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 0 },
		];
		expect(closePolyline(points)).toBe(points);
	});

	it("returns input unchanged for fewer than 2 points", () => {
		const one: Polyline = [{ x: 1, y: 1 }];
		expect(closePolyline(one)).toBe(one);
		expect(closePolyline([])).toEqual([]);
	});
});

describe("toPathData", () => {
	it("empty polyline produces empty string", () => {
		expect(toPathData([])).toBe("");
	});

	it("builds an M...L... string, optionally closed", () => {
		const points: Polyline = [
			{ x: 0, y: 0 },
			{ x: 1, y: 2 },
		];
		expect(toPathData(points)).toBe("M0 0L1 2");
		expect(toPathData(points, true)).toBe("M0 0L1 2Z");
	});
});

describe("measure", () => {
	it("total length of a straight segment equals its distance", () => {
		const table = measure([
			{ x: 0, y: 0 },
			{ x: 3, y: 4 },
		]);
		expect(table.total).toBeCloseTo(5, 9);
		expect(table.lengths).toEqual([0, 5]);
	});

	it("a single-point polyline has zero total length", () => {
		const table = measure([{ x: 1, y: 1 }]);
		expect(table.total).toBe(0);
		expect(table.lengths).toEqual([0]);
	});

	it("an empty polyline has empty lengths and zero total", () => {
		const table = measure([]);
		expect(table.total).toBe(0);
		expect(table.lengths.length).toBe(0);
	});

	it("repeated coincident points contribute zero length", () => {
		const table = measure([
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		]);
		expect(table.lengths).toEqual([0, 0, 1]);
		expect(table.total).toBe(1);
	});
});

describe("pointAtT", () => {
	const table = measure([
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
	]);

	it("t=0 is the start", () => {
		expectPointClose(pointAtT(table, 0), { x: 0, y: 0 });
	});

	it("t=1 is the end", () => {
		expectPointClose(pointAtT(table, 1), { x: 10, y: 0 });
	});

	it("t=0.5 is the midpoint", () => {
		expectPointClose(pointAtT(table, 0.5), { x: 5, y: 0 });
	});

	it("clamps t outside [0,1]", () => {
		expectPointClose(pointAtT(table, -1), { x: 0, y: 0 });
		expectPointClose(pointAtT(table, 2), { x: 10, y: 0 });
	});

	it("empty table returns origin", () => {
		expectPointClose(pointAtT(measure([]), 0.5), { x: 0, y: 0 });
	});

	it("single-point table returns that point regardless of t", () => {
		const single = measure([{ x: 3, y: 4 }]);
		expectPointClose(pointAtT(single, 0.5), { x: 3, y: 4 });
	});

	it("zero-length (all coincident) table returns the point", () => {
		const zero = measure([
			{ x: 2, y: 2 },
			{ x: 2, y: 2 },
		]);
		expectPointClose(pointAtT(zero, 0.7), { x: 2, y: 2 });
	});
});

describe("sliceAtT", () => {
	const points: Polyline = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
	];
	const table = measure(points);

	it("t<=0 returns empty", () => {
		expect(sliceAtT(table, 0)).toEqual([]);
		expect(sliceAtT(table, -1)).toEqual([]);
	});

	it("t>=1 returns the full polyline", () => {
		expect(sliceAtT(table, 1)).toBe(points);
		expect(sliceAtT(table, 1.5)).toBe(points);
	});

	it("t in between returns a prefix with an interpolated tip", () => {
		// total length = 10 + 10 = 20; t=0.25 -> distance 5, halfway along first segment
		const slice = sliceAtT(table, 0.25);
		expect(slice.length).toBe(2);
		expectPointClose(slice[0], { x: 0, y: 0 });
		expectPointClose(slice[1], { x: 5, y: 0 });
	});

	it("fewer than 2 points returns empty", () => {
		expect(sliceAtT(measure([{ x: 0, y: 0 }]), 0.5)).toEqual([]);
	});

	it("zero-length polyline (all coincident) at 0<t<1 returns the full points", () => {
		const zeroTable = measure([
			{ x: 1, y: 1 },
			{ x: 1, y: 1 },
		]);
		expect(sliceAtT(zeroTable, 0.5)).toBe(zeroTable.points);
	});
});

describe("sliceBetween", () => {
	const points: Polyline = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 20, y: 0 },
	];
	const table = measure(points);

	it("[0,1] covers the whole polyline endpoints", () => {
		const slice = sliceBetween(table, 0, 1);
		expectPointClose(slice[0], { x: 0, y: 0 });
		expectPointClose(slice[slice.length - 1], { x: 20, y: 0 });
	});

	it("adjacent slices share their boundary point exactly", () => {
		const a = sliceBetween(table, 0, 0.3);
		const b = sliceBetween(table, 0.3, 1);
		expect(a[a.length - 1]).toEqual(b[0]);
	});

	it("from > to is handled the same as to > from (order-independent)", () => {
		const forward = sliceBetween(table, 0.2, 0.6);
		const backward = sliceBetween(table, 0.6, 0.2);
		expect(forward).toEqual(backward);
	});

	it("degenerate window (from===to) returns empty", () => {
		expect(sliceBetween(table, 0.5, 0.5)).toEqual([]);
	});

	it("a NaN bound degrades to an empty slice rather than throwing or emitting NaN points", () => {
		// Math.min/Math.max propagate NaN through *both* endpoints before `clamp`
		// ever sees them, so a single NaN bound collapses the window to [0,0] and
		// this returns [] rather than treating the other bound as meaningful. That
		// matches this module's habit of failing safe on non-finite input.
		expect(sliceBetween(table, Number.NaN, 0.5)).toEqual([]);
	});

	it("fewer than 2 points returns empty", () => {
		expect(sliceBetween(measure([{ x: 0, y: 0 }]), 0, 1)).toEqual([]);
	});
});

describe("revealedPolylines", () => {
	const a: Polyline = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
	];
	const b: Polyline = [
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
	];
	const tables = [measure(a), measure(b)];
	const total = tables.reduce((sum, t) => sum + t.total, 0);

	it("progress <= 0 draws nothing", () => {
		expect(revealedPolylines(tables, total, 0)).toEqual([]);
	});

	it("progress >= 1 draws every table's points in full", () => {
		const drawn = revealedPolylines(tables, total, 1);
		expect(drawn).toEqual([a, b]);
	});

	it("spends the budget on the first table before touching the second", () => {
		const drawn = revealedPolylines(tables, total, 0.25); // 5 of 20 units
		expect(drawn).toHaveLength(1);
		expectPointClose(drawn[0][drawn[0].length - 1], { x: 5, y: 0 });
	});

	it("exhausts the first table and trims into the second", () => {
		const drawn = revealedPolylines(tables, total, 0.75); // 15 of 20 units
		expect(drawn).toHaveLength(2);
		expect(drawn[0]).toEqual(a);
		expectPointClose(drawn[1][drawn[1].length - 1], { x: 10, y: 5 });
	});

	it("total <= 0 (every table zero-length) draws nothing", () => {
		const zero = [measure([{ x: 0, y: 0 }]), measure([{ x: 5, y: 5 }])];
		expect(revealedPolylines(zero, 0, 0.5)).toEqual([]);
	});

	it("agrees with the renderer and hit-tester's own budget math at the boundary", () => {
		// Same math as `sliceBetween`'s seam-continuity guarantee, one layer up:
		// the tail of a partial reveal must match `sliceAtT` on the same table.
		const partial = revealedPolylines(tables, total, 0.25);
		const expected = sliceAtT(tables[0], 0.5); // table 0 alone is half of `total`
		expect(partial[0]).toEqual(expected);
	});
});

describe("resample", () => {
	const points: Polyline = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
	];
	const table = measure(points);

	it("count < 2 returns a slice of the raw points", () => {
		expect(resample(table, 0)).toEqual([]);
		expect(resample(table, 1)).toEqual(points.slice(0, 1));
	});

	it("resamples evenly by arc length", () => {
		const out = resample(table, 3);
		expectPointClose(out[0], { x: 0, y: 0 });
		expectPointClose(out[1], { x: 5, y: 0 });
		expectPointClose(out[2], { x: 10, y: 0 });
	});

	it("first and last resampled points match table endpoints", () => {
		const out = resample(table, 11);
		expectPointClose(out[0], points[0]);
		expectPointClose(out[out.length - 1], points[points.length - 1]);
	});
});

describe("boundsOf / centerOf / pointOnBounds", () => {
	it("computes tight bounds over multiple polylines", () => {
		const bounds = boundsOf([
			[
				{ x: -1, y: 0 },
				{ x: 5, y: 2 },
			],
			[
				{ x: 0, y: -3 },
				{ x: 1, y: 1 },
			],
		]);
		expect(bounds).toEqual({ minX: -1, minY: -3, maxX: 5, maxY: 2 });
	});

	it("empty input gives inverted infinite bounds", () => {
		const bounds = boundsOf([]);
		expect(bounds.minX).toBe(Number.POSITIVE_INFINITY);
		expect(bounds.maxX).toBe(Number.NEGATIVE_INFINITY);
	});

	it("centerOf is the midpoint of the box", () => {
		const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
		expect(centerOf(bounds)).toEqual({ x: 5, y: 2 });
	});

	it("pointOnBounds({0,0}) is the centre", () => {
		const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
		expect(pointOnBounds(bounds, { x: 0, y: 0 })).toEqual({ x: 5, y: 2 });
	});

	it("pointOnBounds({1,1}) is the top-right corner", () => {
		const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
		expectPointClose(pointOnBounds(bounds, { x: 1, y: 1 }), { x: 10, y: 4 });
	});

	it("clamps directions beyond +-1", () => {
		const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
		expectPointClose(pointOnBounds(bounds, { x: 5, y: -5 }), { x: 10, y: 0 });
	});
});

/** Bernstein-basis evaluator, kept independent of `splitCubicAt`'s De Casteljau path. */
function evalCubicAt(
	p0: Point,
	c1: Point,
	c2: Point,
	p1: Point,
	t: number,
): Point {
	const mt = 1 - t;
	const w0 = mt * mt * mt;
	const w1 = 3 * mt * mt * t;
	const w2 = 3 * mt * t * t;
	const w3 = t * t * t;
	return {
		x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
		y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
	};
}

function endPoint(curve: CurvePath): Point {
	if (curve.segments.length === 0) return curve.start;
	return curve.segments[curve.segments.length - 1].to;
}

describe("splitCubicAt", () => {
	const p0 = { x: 0, y: 0 };
	const c1 = { x: 0, y: 10 };
	const c2 = { x: 10, y: 10 };
	const p1 = { x: 10, y: 0 };

	it("both halves start/end where the original curve does", () => {
		const { left, right } = splitCubicAt(p0, c1, c2, p1, 0.5);
		expectPointClose(left[0], p0);
		expectPointClose(right[3], p1);
	});

	it("the halves meet exactly at the split point", () => {
		const { left, right } = splitCubicAt(p0, c1, c2, p1, 0.5);
		expectPointClose(left[3], right[0]);
	});

	it("the split point matches direct Bernstein evaluation at t", () => {
		for (const t of [0.25, 0.5, 0.75]) {
			const { left } = splitCubicAt(p0, c1, c2, p1, t);
			expectPointClose(left[3], evalCubicAt(p0, c1, c2, p1, t));
		}
	});

	it("each half retraces the corresponding portion of the original curve", () => {
		const t = 0.3;
		const { left, right } = splitCubicAt(p0, c1, c2, p1, t);
		// Left half at its local s should match the original at t*s.
		const s = 0.6;
		expectPointClose(
			evalCubicAt(left[0], left[1], left[2], left[3], s),
			evalCubicAt(p0, c1, c2, p1, t * s),
		);
		// Right half at its local s should match the original at t + (1-t)*s.
		expectPointClose(
			evalCubicAt(right[0], right[1], right[2], right[3], s),
			evalCubicAt(p0, c1, c2, p1, t + (1 - t) * s),
		);
	});
});

describe("cubicArcLength", () => {
	it("matches the chord length for a straight (control-collinear) cubic", () => {
		const p0 = { x: 0, y: 0 };
		const p1 = { x: 12, y: 0 };
		const c1 = { x: 4, y: 0 };
		const c2 = { x: 8, y: 0 };
		expect(cubicArcLength(p0, c1, c2, p1)).toBeCloseTo(12, 6);
	});

	it("approximates a quarter circle of radius 1 within 1%", () => {
		// Standard cubic approximation of a quarter circle, kappa = 0.5522847498.
		const k = 0.5522847498;
		const p0 = { x: 1, y: 0 };
		const c1 = { x: 1, y: k };
		const c2 = { x: k, y: 1 };
		const p1 = { x: 0, y: 1 };
		const length = cubicArcLength(p0, c1, c2, p1);
		expect(length).toBeCloseTo(Math.PI / 2, 2);
	});
});

describe("measureCurve", () => {
	it("sums straight-line and cubic segment lengths", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }),
				{
					c1: { x: 40 / 3, y: 0 },
					c2: { x: 50 / 3, y: 0 },
					to: { x: 20, y: 0 },
				},
			],
			closed: false,
		};
		const table = measureCurve(curve);
		expect(table.lengths[0]).toBeCloseTo(0, 6);
		expect(table.lengths[1]).toBeCloseTo(10, 6);
		expect(table.lengths[2]).toBeCloseTo(20, 6);
		expect(table.total).toBeCloseTo(20, 6);
	});

	it("empty curve measures to zero", () => {
		const table = measureCurve({
			start: { x: 0, y: 0 },
			segments: [],
			closed: false,
		});
		expect(table.total).toBe(0);
		expect(table.lengths).toEqual([0]);
	});
});

describe("sliceCurveAtT", () => {
	const curve: CurvePath = {
		start: { x: 0, y: 0 },
		segments: [
			lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }),
			lineSegment({ x: 10, y: 0 }, { x: 20, y: 0 }),
		],
		closed: false,
	};
	const table = measureCurve(curve);

	it("t <= 0 returns an empty path at the start point", () => {
		const sliced = sliceCurveAtT(table, 0);
		expect(sliced.segments).toEqual([]);
		expectPointClose(sliced.start, curve.start);
	});

	it("t >= 1 returns the whole curve", () => {
		expect(sliceCurveAtT(table, 1)).toBe(curve);
	});

	it("mid-fraction cuts partway through the containing segment", () => {
		const sliced = sliceCurveAtT(table, 0.25); // 5 of 20 units in
		expectPointClose(endPoint(sliced), { x: 5, y: 0 });
	});

	it("cuts a cubic segment into a true partial bézier, not a chord", () => {
		const curved: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				{
					c1: { x: 0, y: 10 },
					c2: { x: 10, y: 10 },
					to: { x: 10, y: 0 },
				},
			],
			closed: false,
		};
		const curvedTable = measureCurve(curved);
		const sliced = sliceCurveAtT(curvedTable, 0.5);
		const seg = sliced.segments[0];
		// A true partial bézier's tip departs from the straight chord to `to`.
		expect(Math.abs(seg.to.y - 0)).toBeGreaterThan(0);
	});
});

describe("sliceCurveBetween", () => {
	const curve: CurvePath = {
		start: { x: 0, y: 0 },
		segments: [
			lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }),
			lineSegment({ x: 10, y: 0 }, { x: 20, y: 0 }),
		],
		closed: false,
	};
	const table = measureCurve(curve);

	it("both cuts inside the same segment", () => {
		const sliced = sliceCurveBetween(table, 0.1, 0.3); // distances 2..6
		expectPointClose(sliced.start, { x: 2, y: 0 });
		expectPointClose(endPoint(sliced), { x: 6, y: 0 });
	});

	it("cuts spanning a segment boundary", () => {
		const sliced = sliceCurveBetween(table, 0.25, 0.75); // distances 5..15
		expectPointClose(sliced.start, { x: 5, y: 0 });
		expectPointClose(endPoint(sliced), { x: 15, y: 0 });
	});

	it("empty when the window is inverted to nothing", () => {
		expect(sliceCurveBetween(table, 0.5, 0.5).segments).toEqual([]);
	});

	it("adjacent windows share their boundary point exactly (seam continuity)", () => {
		const first = sliceCurveBetween(table, 0.1, 0.4);
		const second = sliceCurveBetween(table, 0.4, 0.9);
		expectPointClose(endPoint(first), second.start, 9);
	});

	it("agrees with sliceCurveAtT at the shared boundary", () => {
		const whole = sliceCurveAtT(table, 0.4);
		const window = sliceCurveBetween(table, 0, 0.4);
		expectPointClose(endPoint(whole), endPoint(window), 9);
	});
});

describe("tangentAtT / normalAtT", () => {
	it("a straight segment's tangent is constant along its whole length", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 })],
			closed: false,
		};
		const table = measureCurve(curve);
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			expectPointClose(tangentAtT(table, t), { x: 1, y: 0 });
		}
	});

	it("normal is the tangent rotated a quarter turn counter-clockwise", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 })],
			closed: false,
		};
		const table = measureCurve(curve);
		expectPointClose(normalAtT(table, 0.5), { x: 0, y: 1 });
	});

	it("both vectors are unit length on a curved segment", () => {
		// A quarter-circle arc from (10,0) to (0,10), centred at the origin.
		const [[, c1, c2, to]] = arcCubics(0, 0, 10, 10, 0, 0, Math.PI / 2);
		const curve: CurvePath = {
			start: { x: 10, y: 0 },
			segments: [{ c1, c2, to }],
			closed: false,
		};
		const table = measureCurve(curve);
		for (const t of [0, 0.3, 0.5, 0.8, 1]) {
			const tangent = tangentAtT(table, t);
			const normal = normalAtT(table, t);
			expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(1, 6);
			expect(Math.hypot(normal.x, normal.y)).toBeCloseTo(1, 6);
			// Tangent and normal stay perpendicular at every point along the curve.
			expect(tangent.x * normal.x + tangent.y * normal.y).toBeCloseTo(0, 6);
		}
	});

	it("tangent direction at the endpoints of a known curve matches its analytic derivative", () => {
		// A cubic that starts moving straight up (+y) and ends moving straight
		// right (+x) — the classic S-shape control layout.
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				{
					c1: { x: 0, y: 10 },
					c2: { x: 10, y: 10 },
					to: { x: 10, y: 0 },
				},
			],
			closed: false,
		};
		const table = measureCurve(curve);
		expectPointClose(tangentAtT(table, 0), { x: 0, y: 1 });
		expectPointClose(tangentAtT(table, 1), { x: 0, y: -1 });
	});

	it("spans a segment boundary continuously (no jump at the seam of two collinear lines)", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }),
				lineSegment({ x: 10, y: 0 }, { x: 20, y: 0 }),
			],
			closed: false,
		};
		const table = measureCurve(curve);
		expectPointClose(tangentAtT(table, 0.5), { x: 1, y: 0 });
	});

	it("a closed path's tangent at t=1 is the exit direction of the last segment", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }),
				lineSegment({ x: 10, y: 0 }, { x: 10, y: 10 }),
				lineSegment({ x: 10, y: 10 }, { x: 0, y: 0 }),
			],
			closed: true,
		};
		const table = measureCurve(curve);
		const tangent = tangentAtT(table, 1);
		const expected = { x: -10, y: -10 };
		const magnitude = Math.hypot(expected.x, expected.y);
		expectPointClose(tangent, {
			x: expected.x / magnitude,
			y: expected.y / magnitude,
		});
	});

	it("an empty curve falls back rather than throwing or emitting NaN", () => {
		const table = measureCurve({
			start: { x: 0, y: 0 },
			segments: [],
			closed: false,
		});
		expectPointClose(tangentAtT(table, 0.5), { x: 1, y: 0 });
		expectPointClose(normalAtT(table, 0.5), { x: 0, y: 1 });
	});

	it("a degenerate zero-length segment falls back to the caller's direction rather than NaN", () => {
		const curve: CurvePath = {
			start: { x: 5, y: 5 },
			segments: [lineSegment({ x: 5, y: 5 }, { x: 5, y: 5 })],
			closed: false,
		};
		const table = measureCurve(curve);
		expect(table.total).toBe(0);
		const fallback = { x: 0, y: -1 };
		expectPointClose(tangentAtT(table, 0.5, fallback), fallback);
		expectPointClose(normalAtT(table, 0.5, fallback), { x: 1, y: 0 });
	});

	it("respects a custom fallback direction on a degenerate curve", () => {
		const table = measureCurve({
			start: { x: 0, y: 0 },
			segments: [],
			closed: false,
		});
		const fallback = { x: 0, y: 1 };
		expectPointClose(tangentAtT(table, 0, fallback), fallback);
	});

	it("t is clamped to [0, 1] like the other CurveArcTable primitives", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 })],
			closed: false,
		};
		const table = measureCurve(curve);
		expectPointClose(tangentAtT(table, -5), tangentAtT(table, 0));
		expectPointClose(tangentAtT(table, 5), tangentAtT(table, 1));
	});
});

describe("arcCubics", () => {
	it("a quarter turn is a single cubic", () => {
		const cubics = arcCubics(0, 0, 5, 5, 0, 0, Math.PI / 2);
		expect(cubics.length).toBe(1);
		const [p0, , , p1] = cubics[0];
		expectPointClose(p0, { x: 5, y: 0 });
		expectPointClose(p1, { x: 0, y: 5 });
	});

	it("splits sweeps over a quarter turn into multiple cubics", () => {
		const cubics = arcCubics(0, 0, 5, 5, 0, 0, Math.PI);
		expect(cubics.length).toBe(2);
		expectPointClose(cubics[0][0], { x: 5, y: 0 });
		expectPointClose(cubics[cubics.length - 1][3], { x: -5, y: 0 });
		// Consecutive cubics must share their seam exactly.
		expectPointClose(cubics[0][3], cubics[1][0]);
	});

	it("stays at radius r along the curve (Bernstein evaluation)", () => {
		const cx = 2;
		const cy = -3;
		const r = 4;
		const cubics = arcCubics(cx, cy, r, r, 0, 0, Math.PI * 2);
		for (const [p0, c1, c2, p1] of cubics) {
			for (const t of [0, 0.25, 0.5, 0.75, 1]) {
				const p = evalCubicAt(p0, c1, c2, p1, t);
				const dist = Math.hypot(p.x - cx, p.y - cy);
				// Kappa approximation, not an exact circle: allow ~0.03% of r.
				expect(Math.abs(dist - r)).toBeLessThan(r * 0.0003);
			}
		}
	});

	it("honors rotationDeg for an elliptical arc", () => {
		const unrotated = arcCubics(0, 0, 5, 2, 0, 0, Math.PI / 2)[0];
		const rotated = arcCubics(0, 0, 5, 2, 90, 0, Math.PI / 2)[0];
		expect(unrotated[0].x).not.toBeCloseTo(rotated[0].x, 3);
	});
});

describe("polylineToCurvePath", () => {
	it("turns an open polyline into all-line segments, in order", () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 2 },
			{ x: 3, y: 4 },
		];
		const curve = polylineToCurvePath(points, false);
		expect(curve.start).toEqual(points[0]);
		expect(curve.segments).toEqual([
			lineSegment(points[0], points[1]),
			lineSegment(points[1], points[2]),
		]);
		expect(curve.closed).toBe(false);
	});

	it("passes through the closed flag without adding a synthetic closing point", () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		];
		const curve = polylineToCurvePath(points, true);
		expect(curve.closed).toBe(true);
		// Three input points, so exactly two line segments — no extra segment
		// closing back to the start (that's what `closed: true` is for).
		expect(curve.segments.length).toBe(2);
		expect(curve.segments[curve.segments.length - 1].to).toEqual(points[2]);
	});

	it("empty input doesn't throw and returns a degenerate curve", () => {
		expect(() => polylineToCurvePath([], false)).not.toThrow();
		const curve = polylineToCurvePath([], true);
		expect(curve).toEqual({
			start: { x: 0, y: 0 },
			segments: [],
			closed: true,
		});
	});
});

describe("path robustness regressions", () => {
	it("flattens a closed loop cubic (p0 == p3) into a real loop", () => {
		const [sub] = flattenPath("M0 0 C10 10 -10 10 0 0");
		expect(sub.points.length).toBeGreaterThan(4);
		expect(Math.max(...sub.points.map((p) => p.y))).toBeGreaterThan(5);
	});

	it("keeps overshoot of a collinear cubic", () => {
		const pts = flattenCubicPolyline(
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: -10, y: 0 },
			{ x: 1, y: 0 },
		);
		expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(2);
	});

	it("parses compact arc flags", () => {
		const segs = parsePathData("M0 0a1 1 0 011 1");
		expect(segs[1]).toEqual({ command: "a", args: [1, 1, 0, 0, 1, 1, 1] });
	});

	it("inverts arc length (not t) when slicing a segment", () => {
		const p = { x: 0, y: 0 };
		const curve: CurvePath = {
			start: p,
			segments: [{ c1: p, c2: p, to: { x: 10, y: 0 } }],
			closed: false,
		};
		const table = measureCurve(curve);
		const half = sliceCurveAtT(table, 0.5);
		expect(half.segments[0].to.x).toBeCloseTo(5, 3);
		const mid = sliceCurveBetween(table, 0.25, 0.75);
		expect(mid.start.x).toBeCloseTo(2.5, 3);
		expect(mid.segments[0].to.x).toBeCloseTo(7.5, 3);
	});

	it("uses the next distinct control point for endpoint tangents", () => {
		const p = { x: 0, y: 0 };
		const curve: CurvePath = {
			start: p,
			segments: [{ c1: p, c2: p, to: { x: 0, y: 10 } }],
			closed: false,
		};
		const table = measureCurve(curve);
		expectPointClose(tangentAtT(table, 0), { x: 0, y: 1 });
		expectPointClose(tangentAtT(table, 1), { x: 0, y: 1 });
	});

	it("resample tolerates negative, fractional and NaN counts", () => {
		const table = measure([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
		]);
		expect(resample(table, -1)).toEqual([]);
		expect(resample(table, Number.NaN)).toEqual([]);
		expect(resample(table, 1)).toHaveLength(1);
		expect(resample(table, 3.7)).toHaveLength(3);
	});
});

describe("measureCurve on a closed curve with an implicit closing edge", () => {
	const square = polylineToCurvePath(
		[
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 1 },
		],
		true,
	);

	it("counts the closing edge toward total length", () => {
		expect(measureCurve(square).total).toBeCloseTo(4, 6);
	});

	it("reveals the closing edge progressively instead of snapping it in", () => {
		const piece = sliceCurveAtT(measureCurve(square), 0.875);
		const tip = piece.segments[piece.segments.length - 1].to;
		expect(tip.x).toBeCloseTo(0, 6);
		expect(tip.y).toBeCloseTo(0.5, 6);
	});
});
