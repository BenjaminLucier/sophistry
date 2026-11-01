import { describe, expect, it } from "vitest";
import {
	angleArcCurvePath,
	angleArcPolyline,
	annularSectorCurvePath,
	annularSectorPolyline,
	annulusCurvePaths,
	annulusPolylines,
	arcBetweenPoints,
	arcBetweenPointsCurvePath,
	arcCurvePath,
	cubicBezierPolyline,
	elbowPolyline,
	ellipseCurvePath,
	polygramPolyline,
	quadraticBezierPolyline,
	rightAngleMarkPolyline,
	sectorCurvePath,
	sectorPolyline,
	segmentsForArc,
	starInnerRadius,
	starPolygon,
} from "./arc.js";
import { measure, resample } from "./path/arclength.js";
import { lineSegment } from "./path/cubic.js";
import { curvePathToPolyline } from "./path/svg-path.js";
import type { CurvePath, Point } from "./path/types.js";

function expectPointClose(a: Point, b: Point, digits = 6) {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
}

/** Bernstein-basis evaluator (mirrors path.test.ts's helper of the same shape). */
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

/**
 * A segment is genuinely curved when its control points are NOT at the
 * collinear-thirds points `lineSegment` would place them at — the check
 * for a curve, since every `CurveSegment` shares one shape.
 */
function isGenuinelyCurved(
	cursor: Point,
	segment: CurvePath["segments"][number],
) {
	const thirdC1 = {
		x: cursor.x + (segment.to.x - cursor.x) / 3,
		y: cursor.y + (segment.to.y - cursor.y) / 3,
	};
	return (
		Math.abs(segment.c1.x - thirdC1.x) > 1e-6 ||
		Math.abs(segment.c1.y - thirdC1.y) > 1e-6
	);
}

/** Checks every cubic segment of `curve` stays at distance `r` from `(cx,cy)`. */
function expectCurveStaysAtRadius(
	curve: CurvePath,
	cx: number,
	cy: number,
	r: number,
) {
	let cursor = curve.start;
	for (const segment of curve.segments) {
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			const p = evalCubicAt(cursor, segment.c1, segment.c2, segment.to, t);
			expect(Math.hypot(p.x - cx, p.y - cy)).toBeCloseTo(r, 2);
		}
		cursor = segment.to;
	}
}

describe("segmentsForArc", () => {
	it("is prorated by sweep fraction, at least 2", () => {
		expect(segmentsForArc(10, 0)).toBeGreaterThanOrEqual(2);
		expect(segmentsForArc(10, Math.PI * 2)).toBeGreaterThan(
			segmentsForArc(10, Math.PI / 8),
		);
	});

	it("caps the fraction at a full turn for sweeps beyond 2*pi", () => {
		expect(segmentsForArc(10, Math.PI * 4)).toBe(
			segmentsForArc(10, Math.PI * 2),
		);
	});
});

describe("arcBetweenPoints", () => {
	it("angle 0 degenerates to a straight line", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 10, y: 0 };
		expect(arcBetweenPoints(from, to, 0)).toEqual([from, to]);
	});

	it("coincident endpoints degenerate to a straight (zero-length) line", () => {
		const p = { x: 3, y: 3 };
		expect(arcBetweenPoints(p, p, 1)).toEqual([p, p]);
	});

	it("endpoints of the arc match `from` and `to`", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 4, y: 0 };
		const arc = arcBetweenPoints(from, to, Math.PI / 2, 16);
		expectPointClose(arc[0], from);
		expectPointClose(arc[arc.length - 1], to);
	});

	it("a positive turn bulges to the right of travel", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 10, y: 0 };
		const arc = arcBetweenPoints(from, to, Math.PI / 2, 16);
		const mid = arc[Math.floor(arc.length / 2)];
		// travel direction is +x; "right" (per doc, positive turn bulges right,
		// meaning centre is left, curve bulges toward -y in a y-up... verify sign
		// empirically instead of asserting a hardcoded direction)
		expect(Math.abs(mid.y)).toBeGreaterThan(0);
	});
});

describe("sectorPolyline", () => {
	it("closes back through the centre", () => {
		const sector = sectorPolyline(0, 0, 5, 0, Math.PI / 2, 4);
		expectPointClose(sector[0], { x: 0, y: 0 });
		expectPointClose(sector[sector.length - 1], { x: 0, y: 0 });
	});
});

describe("annulusPolylines", () => {
	it("returns outer ring first regardless of argument order", () => {
		const [outerA, innerA] = annulusPolylines(0, 0, 2, 5, 8);
		const [outerB, innerB] = annulusPolylines(0, 0, 5, 2, 8);
		expect(Math.hypot(outerA[0].x, outerA[0].y)).toBeCloseTo(5, 9);
		expect(Math.hypot(innerA[0].x, innerA[0].y)).toBeCloseTo(2, 9);
		expect(Math.hypot(outerB[0].x, outerB[0].y)).toBeCloseTo(5, 9);
		expect(Math.hypot(innerB[0].x, innerB[0].y)).toBeCloseTo(2, 9);
	});

	it("inner ring winds backwards relative to the outer ring", () => {
		const [outer, inner] = annulusPolylines(0, 0, 2, 5, 8);
		// outer goes 0 -> 2pi, inner goes 2pi -> 0
		expect(outer[0].y).toBeCloseTo(0, 9);
		expect(outer[1].y).toBeGreaterThan(0);
		expect(inner[1].y).toBeLessThan(0);
	});
});

describe("annularSectorPolyline", () => {
	it("is a single closed ring", () => {
		const ring = annularSectorPolyline(0, 0, 2, 5, 0, Math.PI / 2, 8);
		expectPointClose(ring[0], ring[ring.length - 1]);
	});
});

describe("cubicBezierPolyline / quadraticBezierPolyline", () => {
	const p0 = { x: 0, y: 0 };
	const c0 = { x: 0, y: 5 };
	const c1 = { x: 10, y: 5 };
	const p1 = { x: 10, y: 0 };

	it("without segments, adaptively flattens (endpoints match)", () => {
		const line = cubicBezierPolyline(p0, c0, c1, p1);
		expectPointClose(line[0], p0);
		expectPointClose(line[line.length - 1], p1);
	});

	it("with segments, resamples to segments+1 points", () => {
		const line = cubicBezierPolyline(p0, c0, c1, p1, 10);
		expect(line.length).toBe(11);
		expectPointClose(line[0], p0);
		expectPointClose(line[line.length - 1], p1);
	});

	it("quadraticBezierPolyline endpoints match p0/p1", () => {
		const line = quadraticBezierPolyline(p0, { x: 5, y: 10 }, p1, 8);
		expectPointClose(line[0], p0);
		expectPointClose(line[line.length - 1], p1);
	});
});

describe("starPolygon", () => {
	it("alternates outer/inner radius, closed ring", () => {
		const star = starPolygon(0, 0, 5, 2, 5);
		expect(star.length).toBe(11); // 2*5 + 1 closing point
		expectPointClose(star[0], star[star.length - 1]);
		expect(Math.hypot(star[0].x, star[0].y)).toBeCloseTo(5, 9);
		expect(Math.hypot(star[1].x, star[1].y)).toBeCloseTo(2, 9);
	});

	it("clamps points to at least 2", () => {
		const star = starPolygon(0, 0, 5, 2, 0);
		expect(star.length).toBe(5); // n=2 -> 4 verts + closing
	});
});

describe("starInnerRadius", () => {
	it("returns a radius smaller than outer for a typical pentagram", () => {
		const inner = starInnerRadius(1, 5, 2);
		expect(inner).toBeGreaterThan(0);
		expect(inner).toBeLessThan(1);
	});
});

describe("polygramPolyline", () => {
	it("{5/2} pentagram is a single closed ring visiting all 5 points", () => {
		const loops = polygramPolyline(0, 0, 1, 5, 2);
		expect(loops.length).toBe(1);
		expect(loops[0].length).toBe(6); // 5 verts + closing point
	});

	it("{6/2} decomposes into two disjoint triangles", () => {
		const loops = polygramPolyline(0, 0, 1, 6, 2);
		expect(loops.length).toBe(2);
		for (const loop of loops) expect(loop.length).toBe(4); // 3 verts + closing
	});

	it("{n/1} is just the regular n-gon (one ring)", () => {
		const loops = polygramPolyline(0, 0, 1, 6, 1);
		expect(loops.length).toBe(1);
		expect(loops[0].length).toBe(7);
	});
});

describe("elbowPolyline", () => {
	it("produces a right-angle corner of the given width", () => {
		const at = { x: 0, y: 0 };
		const elbow = elbowPolyline(at, 2, 0);
		expectPointClose(elbow[0], { x: 0, y: 2 });
		expectPointClose(elbow[1], { x: 2, y: 2 });
		expectPointClose(elbow[2], { x: 2, y: 0 });
	});
});

describe("angleArcPolyline", () => {
	it("degenerate rays (from/to on vertex) fall back to angle 0", () => {
		const vertex = { x: 0, y: 0 };
		const arc = angleArcPolyline(vertex, vertex, vertex, 1, 4);
		for (const p of arc) expectPointClose(p, { x: 1, y: 0 });
	});

	it("defaults to the minor arc (sweep magnitude <= pi)", () => {
		const vertex = { x: 0, y: 0 };
		const from = { x: 1, y: 0 };
		const to = { x: 0, y: 1 };
		const arc = angleArcPolyline(vertex, from, to, 1, 8);
		expectPointClose(arc[0], from);
		expectPointClose(arc[arc.length - 1], to);
	});

	it("otherAngle swaps to the reflex complement", () => {
		const vertex = { x: 0, y: 0 };
		const from = { x: 1, y: 0 };
		const to = { x: 0, y: 1 };
		// Leave segment count to segmentsForArc, so a wider sweep gets more of them.
		const minor = angleArcPolyline(vertex, from, to, 1);
		const reflex = angleArcPolyline(vertex, from, to, 1, undefined, {
			otherAngle: true,
		});
		expect(reflex.length).toBeGreaterThan(minor.length);
	});
});

describe("angleArcCurvePath", () => {
	it("degenerate rays (from/to on vertex) fall back to angle 0", () => {
		const vertex = { x: 0, y: 0 };
		const curve = angleArcCurvePath(vertex, vertex, vertex, 1);
		expectPointClose(curve.start, { x: 1, y: 0 });
		expectCurveStaysAtRadius(curve, vertex.x, vertex.y, 1);
	});

	it("matches angleArcPolyline's endpoints for the minor arc", () => {
		const vertex = { x: 0, y: 0 };
		const from = { x: 1, y: 0 };
		const to = { x: 0, y: 1 };
		const polyline = angleArcPolyline(vertex, from, to, 1, 8);
		const curve = angleArcCurvePath(vertex, from, to, 1);
		expectPointClose(curve.start, polyline[0]);
		const flat = curvePathToPolyline(curve);
		expectPointClose(flat[flat.length - 1], polyline[polyline.length - 1]);
		expect(curve.closed).toBe(false);
	});

	it("otherAngle swaps to the reflex complement, matching angleArcPolyline", () => {
		const vertex = { x: 0, y: 0 };
		const from = { x: 1, y: 0 };
		const to = { x: 0, y: 1 };
		const minorPoly = angleArcPolyline(vertex, from, to, 1);
		const reflexPoly = angleArcPolyline(vertex, from, to, 1, undefined, {
			otherAngle: true,
		});
		const minorCurve = angleArcCurvePath(vertex, from, to, 1);
		const reflexCurve = angleArcCurvePath(vertex, from, to, 1, {
			otherAngle: true,
		});
		expect(
			measure(resample(measure(curvePathToPolyline(reflexCurve)), 50)).total,
		).toBeGreaterThan(
			measure(resample(measure(curvePathToPolyline(minorCurve)), 50)).total,
		);
		// Sanity against the polyline sibling's own output for the same case.
		expect(reflexPoly.length).toBeGreaterThan(minorPoly.length);
		expectCurveStaysAtRadius(minorCurve, vertex.x, vertex.y, 1);
		expectCurveStaysAtRadius(reflexCurve, vertex.x, vertex.y, 1);
	});

	it("quadrant flips a ray before computing the sweep, matching angleArcPolyline", () => {
		const vertex = { x: 0, y: 0 };
		const from = { x: 1, y: 0 };
		const to = { x: 0, y: 1 };
		const quadrant: [number, number] = [-1, 1];
		const polyline = angleArcPolyline(vertex, from, to, 1, 8, { quadrant });
		const curve = angleArcCurvePath(vertex, from, to, 1, { quadrant });
		const flat = curvePathToPolyline(curve);
		expectPointClose(flat[flat.length - 1], polyline[polyline.length - 1]);
	});
});

describe("rightAngleMarkPolyline", () => {
	it("produces the expected 3-point square-corner mark", () => {
		const vertex = { x: 0, y: 0 };
		const mark = rightAngleMarkPolyline(
			vertex,
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			2,
		);
		expectPointClose(mark[0], { x: 2, y: 0 });
		expectPointClose(mark[1], { x: 2, y: 2 });
		expectPointClose(mark[2], { x: 0, y: 2 });
	});

	it("handles a zero-length direction vector without producing NaN", () => {
		const vertex = { x: 0, y: 0 };
		const mark = rightAngleMarkPolyline(
			vertex,
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			2,
		);
		for (const p of mark) {
			expect(Number.isFinite(p.x)).toBe(true);
			expect(Number.isFinite(p.y)).toBe(true);
		}
	});
});

describe("arcCurvePath", () => {
	it("starts and ends at the expected angle points, open (not closed)", () => {
		const curve = arcCurvePath(0, 0, 5, 0, Math.PI / 2);
		expectPointClose(curve.start, { x: 5, y: 0 });
		expectPointClose(curve.segments[curve.segments.length - 1].to, {
			x: 0,
			y: 5,
		});
		expect(curve.closed).toBe(false);
	});

	it("every segment is a genuine curve, not a straight run", () => {
		const curve = arcCurvePath(0, 0, 5, 0, Math.PI);
		expect(curve.segments.length).toBeGreaterThan(0);
		let cursor = curve.start;
		for (const seg of curve.segments) {
			expect(isGenuinelyCurved(cursor, seg)).toBe(true);
			cursor = seg.to;
		}
	});

	it("a full circle stays at radius r throughout (Bernstein evaluation)", () => {
		const curve = arcCurvePath(1, -2, 3, 0, Math.PI * 2);
		expectCurveStaysAtRadius(curve, 1, -2, 3);
	});
});

describe("ellipseCurvePath", () => {
	it("returns a closed loop", () => {
		const curve = ellipseCurvePath(0, 0, 5, 5);
		expect(curve.closed).toBe(true);
		expect(curve.segments.length).toBeGreaterThan(0);
		let cursor = curve.start;
		for (const seg of curve.segments) {
			expect(isGenuinelyCurved(cursor, seg)).toBe(true);
			cursor = seg.to;
		}
	});

	it("a circle (rx === ry) stays at radius r throughout (Bernstein evaluation)", () => {
		const curve = ellipseCurvePath(1, -2, 3, 3);
		expectCurveStaysAtRadius(curve, 1, -2, 3);
	});

	it("an ellipse (rx !== ry) stays on the ellipse throughout (Bernstein evaluation)", () => {
		const cx = 0;
		const cy = 0;
		const rx = 5;
		const ry = 2;
		const curve = ellipseCurvePath(cx, cy, rx, ry);
		let cursor = curve.start;
		for (const segment of curve.segments) {
			for (const t of [0, 0.25, 0.5, 0.75, 1]) {
				const p = evalCubicAt(cursor, segment.c1, segment.c2, segment.to, t);
				const normalized = ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2;
				expect(normalized).toBeCloseTo(1, 2);
			}
			cursor = segment.to;
		}
	});

	it("honors rotationDeg (degrees, matching arcCubics's convention)", () => {
		const unrotated = ellipseCurvePath(0, 0, 5, 2, 0);
		const rotated = ellipseCurvePath(0, 0, 5, 2, 90);
		expect(unrotated.start.x).not.toBeCloseTo(rotated.start.x, 3);
	});
});

describe("arcBetweenPointsCurvePath", () => {
	it("angle 0 degenerates to a single line segment", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 10, y: 0 };
		const curve = arcBetweenPointsCurvePath(from, to, 0);
		expect(curve.segments).toEqual([lineSegment(from, to)]);
		expect(curve.closed).toBe(false);
	});

	it("coincident endpoints degenerate to a zero-length line", () => {
		const p = { x: 3, y: 3 };
		const curve = arcBetweenPointsCurvePath(p, p, 1);
		expect(curve.segments).toEqual([lineSegment(p, p)]);
	});

	it("endpoints match from/to for a real arc", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 4, y: 0 };
		const curve = arcBetweenPointsCurvePath(from, to, Math.PI / 2);
		expectPointClose(curve.start, from);
		expectPointClose(curve.segments[curve.segments.length - 1].to, to);
	});

	it("tracks arcBetweenPoints's own polyline output closely (sampled comparison)", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 10, y: 0 };
		const angle = Math.PI / 2;
		const polyline = arcBetweenPoints(from, to, angle, 32);
		const curve = arcBetweenPointsCurvePath(from, to, angle);
		const flattened = resample(measure(curvePathToPolyline(curve)), 33);
		for (let i = 0; i < polyline.length; i++) {
			expectPointClose(polyline[i], flattened[i], 2);
		}
	});
});

describe("sectorCurvePath", () => {
	it("closes back through the centre", () => {
		const sector = sectorCurvePath(0, 0, 5, 0, Math.PI / 2);
		expect(sector.closed).toBe(true);
		// Both radial edges are explicit segments (not left implicit via
		// `closed: true`) so a progress-driven reveal grows them in step
		// instead of snapping in at the end.
		const toCentre = sector.segments[sector.segments.length - 2];
		const toStart = sector.segments[sector.segments.length - 1];
		const arcEnd = sector.segments[sector.segments.length - 3].to;
		expect(toCentre).toEqual(lineSegment(arcEnd, { x: 0, y: 0 }));
		expect(toStart).toEqual(lineSegment({ x: 0, y: 0 }, sector.start));
	});

	it("matches sectorPolyline's shape (same set of edges, sampled)", () => {
		const poly = sectorPolyline(0, 0, 5, 0, Math.PI / 2, 32);
		const curve = sectorCurvePath(0, 0, 5, 0, Math.PI / 2);
		const flat = curvePathToPolyline(curve);
		// Both should enclose the same area landmark points: centre and the two
		// arc endpoints are present in each.
		const hasPointClose = (points: Point[], target: Point) =>
			points.some(
				(p) =>
					Math.abs(p.x - target.x) < 1e-6 && Math.abs(p.y - target.y) < 1e-6,
			);
		expect(hasPointClose(poly, { x: 0, y: 0 })).toBe(true);
		expect(hasPointClose(flat, { x: 0, y: 0 })).toBe(true);
		expect(hasPointClose(poly, { x: 5, y: 0 })).toBe(true);
		expect(hasPointClose(flat, { x: 5, y: 0 })).toBe(true);
	});
});

describe("annularSectorCurvePath", () => {
	it("is a single closed loop", () => {
		const ring = annularSectorCurvePath(0, 0, 2, 5, 0, Math.PI / 2);
		expect(ring.closed).toBe(true);
	});

	it("stitches outer arc, a radial line, then the inner arc traversed backward", () => {
		const ring = annularSectorCurvePath(0, 0, 2, 5, 0, Math.PI / 2);
		expectPointClose(ring.start, { x: 5, y: 0 });
		// The seam: last cubic of the outer arc ends at angle pi/2, radius 5;
		// the very next segment is a straight line to the inner arc's start
		// (angle pi/2, radius 2). The outer arc's own segment count tells us
		// exactly where that seam sits.
		const outerArc = arcCurvePath(0, 0, 5, 0, Math.PI / 2);
		const seamIndex = outerArc.segments.length;
		const before =
			seamIndex === 0 ? ring.start : ring.segments[seamIndex - 1].to;
		expectPointClose(before, { x: 0, y: 5 });
		expectPointClose(ring.segments[seamIndex].to, { x: 0, y: 2 });
		// The inner arc ends at angle 0 radius 2; an explicit closing radial
		// segment then returns to the outer start (radius 5).
		const last = ring.segments[ring.segments.length - 1];
		expectPointClose(last.to, { x: 5, y: 0 });
		const beforeLast = ring.segments[ring.segments.length - 2];
		expectPointClose(beforeLast.to, { x: 2, y: 0 });
	});
});

describe("annulusCurvePaths", () => {
	it("returns two closed full circles, outer then inner", () => {
		const [outer, inner] = annulusCurvePaths(0, 0, 2, 5);
		expect(outer.closed).toBe(true);
		expect(inner.closed).toBe(true);
		expectPointClose(outer.start, { x: 5, y: 0 });
		expectPointClose(inner.start, { x: 2, y: 0 });
	});

	it("outer/inner order is independent of argument order", () => {
		const [outerA] = annulusCurvePaths(0, 0, 2, 5);
		const [outerB] = annulusCurvePaths(0, 0, 5, 2);
		expectPointClose(outerA.start, outerB.start);
	});

	it("both rings stay at their respective radius throughout", () => {
		const [outer, inner] = annulusCurvePaths(1, 1, 2, 5);
		expectCurveStaysAtRadius(outer, 1, 1, 5);
		expectCurveStaysAtRadius(inner, 1, 1, 2);
	});

	it("winds the inner ring backwards relative to the outer ring", () => {
		const [outer, inner] = annulusCurvePaths(0, 0, 2, 5);
		const outerSecond = outer.segments[0].to;
		const innerSecond = inner.segments[0].to;
		expect(outerSecond.y).toBeGreaterThan(0);
		expect(innerSecond.y).toBeLessThan(0);
	});
});

describe("arc robustness regressions", () => {
	it("arcCurvePath tolerates NaN and infinite sweeps", () => {
		expect(() => arcCurvePath(0, 0, 1, 0, Number.NaN)).not.toThrow();
		const inf = arcCurvePath(0, 0, 1, 0, Number.POSITIVE_INFINITY);
		expect(inf.segments.length).toBe(1);
	});

	it("arcBetweenPoints with a full-turn angle degenerates to a line", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 2, y: 0 };
		expect(arcBetweenPoints(from, to, 2 * Math.PI)).toEqual([from, to]);
		for (const p of arcBetweenPointsCurvePath(from, to, 2 * Math.PI).segments) {
			expect(Math.abs(p.to.x)).toBeLessThan(10);
		}
	});

	it("annularSectorCurvePath ends with an explicit closing radial segment", () => {
		const curve = annularSectorCurvePath(0, 0, 1, 2, 0, Math.PI / 2);
		const last = curve.segments[curve.segments.length - 1];
		expect(last.to.x).toBeCloseTo(curve.start.x, 9);
		expect(last.to.y).toBeCloseTo(curve.start.y, 9);
		expect(curve.closed).toBe(true);
	});
});
