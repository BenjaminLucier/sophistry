/**
 * Cubic bézier math: straight-line cubics, flattening, de Casteljau
 * splitting, derivatives and arc length, and quadratic/elliptical-arc
 * conversion to cubics. Pure; `lerpPoint` comes from the sibling `../lerp`
 * (its canonical home, see that file's module doc).
 */

import { lerpPoint } from "../lerp";
import type { CurveSegment, Point, Polyline } from "./types";

/**
 * A `CurveSegment` that traces the straight line from `from` to `to` exactly
 * (control points at the thirds).
 *
 * @param from - Start of the run.
 * @param to - End of the run.
 * @returns A cubic segment.
 *
 * @category Paths
 */
export function lineSegment(from: Point, to: Point): CurveSegment {
	return {
		c1: lerpPoint(from, to, 1 / 3),
		c2: lerpPoint(from, to, 2 / 3),
		to,
	};
}

/**
 * Distance from `p` to the segment `a`-`b` (to `a` when the segment is
 * degenerate): the projection of `p` onto the line, clamped to the segment.
 * Internal — `interact/hit.ts`'s `distanceToPolyline` is the public face.
 *
 * @param p - The point to measure from.
 * @param a - Segment start.
 * @param b - Segment end.
 * @returns The shortest distance, in the inputs' units.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
	t = Math.min(1, Math.max(0, t));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Recursively subdivides a cubic until each span is flat within `tolerance`. */
export function flattenCubic(
	out: Polyline,
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	tolerance: number,
	depth: number,
): void {
	// Distance of the control points from the chord *segment* approximates the
	// error. Segment (not infinite line) distance means an overshoot along the
	// chord, or a closed loop with p0 == p3, is never judged flat.
	const d1 = distanceToSegment(p1, p0, p3);
	const d2 = distanceToSegment(p2, p0, p3);
	// A non-finite point (a NaN prop) is never judged flat, so without this the
	// recursion runs to depth 16 on every branch: 65k points per segment.
	if (!Number.isFinite(d1 + d2)) {
		out.push({ x: p3.x, y: p3.y });
		return;
	}
	const flat = (d1 + d2) ** 2 <= tolerance;

	if (flat || depth >= 16) {
		out.push({ x: p3.x, y: p3.y });
		return;
	}

	const mid = (a: Point, b: Point): Point => ({
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	});
	const p01 = mid(p0, p1);
	const p12 = mid(p1, p2);
	const p23 = mid(p2, p3);
	const p012 = mid(p01, p12);
	const p123 = mid(p12, p23);
	const center = mid(p012, p123);

	flattenCubic(out, p0, p01, p012, center, tolerance, depth + 1);
	flattenCubic(out, center, p123, p23, p3, tolerance, depth + 1);
}

/**
 * Flattens one cubic into a standalone polyline, `p0` included.
 *
 * @param p0 - Start point.
 * @param c0 - First control point.
 * @param c1 - Second control point.
 * @param p1 - End point.
 * @param tolerance - Relative flatness budget. Defaults to 0.0005.
 * @returns Points from `p0` to `p1` inclusive.
 *
 * @category Paths
 */
export function flattenCubicPolyline(
	p0: Point,
	c0: Point,
	c1: Point,
	p1: Point,
	tolerance = 0.0005,
): Polyline {
	const points: Polyline = [{ x: p0.x, y: p0.y }];
	flattenCubic(points, p0, c0, c1, p1, tolerance, 0);
	return points;
}

/**
 * De Casteljau split of a cubic at parameter `t` into two cubics that retrace it
 * exactly.
 *
 * @param p0 - Start point.
 * @param c1 - First control point.
 * @param c2 - Second control point.
 * @param p1 - End point.
 * @param t - Curve parameter in 0..1 (not arc length).
 *
 * @category Paths
 */
export function splitCubicAt(
	p0: Point,
	c1: Point,
	c2: Point,
	p1: Point,
	t: number,
): {
	left: [Point, Point, Point, Point];
	right: [Point, Point, Point, Point];
} {
	const p01 = lerpPoint(p0, c1, t);
	const p12 = lerpPoint(c1, c2, t);
	const p23 = lerpPoint(c2, p1, t);
	const p012 = lerpPoint(p01, p12, t);
	const p123 = lerpPoint(p12, p23, t);
	const split = lerpPoint(p012, p123, t);
	return {
		left: [p0, p01, p012, split],
		right: [split, p123, p23, p1],
	};
}

// 5-point Gauss-Legendre quadrature on [-1, 1]: exact for the smooth,
// low-degree speed curve a cubic bézier's derivative traces, and the same
// order used by other bézier-length implementations (e.g. Pomax's bezier.js).
const GAUSS_LEGENDRE_5_X = [
	-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831,
	0.906179845938664,
];

const GAUSS_LEGENDRE_5_W = [
	0.23692688505618908, 0.4786286704993665, 0.5688888888888889,
	0.4786286704993665, 0.23692688505618908,
];

/**
 * Raw (non-unit) derivative `B'(t)` of a cubic at local parameter `t` — the
 * shared core `cubicSpeedAt` and `tangentAtT` both evaluate, one taking its
 * magnitude, the other its direction.
 */
function cubicDerivativeAt(
	p0: Point,
	c1: Point,
	c2: Point,
	p1: Point,
	t: number,
): Point {
	const mt = 1 - t;
	return {
		x:
			3 * mt * mt * (c1.x - p0.x) +
			6 * mt * t * (c2.x - c1.x) +
			3 * t * t * (p1.x - c2.x),
		y:
			3 * mt * mt * (c1.y - p0.y) +
			6 * mt * t * (c2.y - c1.y) +
			3 * t * t * (p1.y - c2.y),
	};
}

/**
 * Like {@link cubicDerivativeAt}, but at an endpoint where the derivative
 * vanishes because a control point sits on the anchor, returns the limiting
 * direction: toward the next distinct control point (or the far anchor).
 */
export function cubicDirectionAt(
	p0: Point,
	c1: Point,
	c2: Point,
	p1: Point,
	t: number,
): Point {
	const d = cubicDerivativeAt(p0, c1, c2, p1, t);
	if (d.x !== 0 || d.y !== 0 || (t > 0 && t < 1)) return d;
	const chain = t <= 0 ? [c1, c2, p1] : [c2, c1, p0];
	const anchor = t <= 0 ? p0 : p1;
	for (const q of chain) {
		const v =
			t <= 0
				? { x: q.x - anchor.x, y: q.y - anchor.y }
				: { x: anchor.x - q.x, y: anchor.y - q.y };
		if (v.x !== 0 || v.y !== 0) return v;
	}
	return d;
}

/** Speed of the cubic at `t` — the magnitude of its derivative, `|B'(t)|`. */
function cubicSpeedAt(
	p0: Point,
	c1: Point,
	c2: Point,
	p1: Point,
	t: number,
): number {
	const d = cubicDerivativeAt(p0, c1, c2, p1, t);
	return Math.hypot(d.x, d.y);
}

/**
 * Arc length of a cubic bézier, via Gauss-Legendre quadrature.
 *
 * @param p0 - Start point.
 * @param c1 - First control point.
 * @param c2 - Second control point.
 * @param p1 - End point.
 * @returns Length in the same units as the points.
 *
 * @category Paths
 */
export function cubicArcLength(
	p0: Point,
	c1: Point,
	c2: Point,
	p1: Point,
): number {
	let sum = 0;
	for (let i = 0; i < GAUSS_LEGENDRE_5_X.length; i++) {
		const t = 0.5 * (GAUSS_LEGENDRE_5_X[i] + 1);
		sum += GAUSS_LEGENDRE_5_W[i] * cubicSpeedAt(p0, c1, c2, p1, t);
	}
	return 0.5 * sum;
}

/**
 * Elevates a quadratic to a cubic so both share one flattening path.
 *
 * @param p0 - Start point.
 * @param c - The quadratic's single control point.
 * @param p1 - End point.
 * @returns The four cubic points `[p0, c1, c2, p1]`.
 *
 * @category Paths
 */
export function quadraticToCubic(
	p0: Point,
	c: Point,
	p1: Point,
): [Point, Point, Point, Point] {
	return [
		p0,
		{ x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) },
		{ x: p1.x + (2 / 3) * (c.x - p1.x), y: p1.y + (2 / 3) * (c.y - p1.y) },
		p1,
	];
}

/**
 * A centre-parameterised elliptical arc as cubics, each at most a quarter turn
 * (the kappa approximation).
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param rx - Radius along the ellipse's own x axis.
 * @param ry - Radius along the ellipse's own y axis.
 * @param rotationDeg - Rotation of the ellipse's axes, in degrees.
 * @param theta1 - Start angle, in radians.
 * @param deltaTheta - Signed sweep in radians.
 * @returns One `[p0, c1, c2, p1]` cubic per piece.
 *
 * @category Paths
 */
export function arcCubics(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	rotationDeg: number,
	theta1: number,
	deltaTheta: number,
): [Point, Point, Point, Point][] {
	const phi = (rotationDeg * Math.PI) / 180;
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);

	// A cubic approximates at most a quarter turn accurately.
	const count = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
	const step = deltaTheta / count;
	const alpha = (4 / 3) * Math.tan(step / 4);

	const onArc = (theta: number): Point => ({
		x: cx + rx * Math.cos(theta) * cosPhi - ry * Math.sin(theta) * sinPhi,
		y: cy + rx * Math.cos(theta) * sinPhi + ry * Math.sin(theta) * cosPhi,
	});
	const tangent = (theta: number): Point => ({
		x: -rx * Math.sin(theta) * cosPhi - ry * Math.cos(theta) * sinPhi,
		y: -rx * Math.sin(theta) * sinPhi + ry * Math.cos(theta) * cosPhi,
	});

	const cubics: [Point, Point, Point, Point][] = [];
	for (let i = 0; i < count; i++) {
		const t0 = theta1 + i * step;
		const t1 = t0 + step;
		const start = onArc(t0);
		const end = onArc(t1);
		const d0 = tangent(t0);
		const d1 = tangent(t1);
		cubics.push([
			start,
			{ x: start.x + alpha * d0.x, y: start.y + alpha * d0.y },
			{ x: end.x - alpha * d1.x, y: end.y - alpha * d1.y },
			end,
		]);
	}
	return cubics;
}

/**
 * Converts an SVG endpoint-parameterized arc into a list of cubics, following
 * the implementation notes in the SVG 1.1 spec (F.6.5): derive the ellipse's
 * center and start/sweep angles from the two endpoints, then delegate the
 * actual cubic emission to `arcCubics`.
 */
export function arcToCubics(
	p0: Point,
	rxIn: number,
	ryIn: number,
	rotationDeg: number,
	largeArc: boolean,
	sweep: boolean,
	p1: Point,
): [Point, Point, Point, Point][] {
	if (p0.x === p1.x && p0.y === p1.y) return [];

	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	if (rx === 0 || ry === 0) {
		// Degenerate radii: the spec says treat the arc as a straight line.
		return [[p0, p0, p1, p1]];
	}

	const phi = (rotationDeg * Math.PI) / 180;
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);

	const dx2 = (p0.x - p1.x) / 2;
	const dy2 = (p0.y - p1.y) / 2;
	const x1p = cosPhi * dx2 + sinPhi * dy2;
	const y1p = -sinPhi * dx2 + cosPhi * dy2;

	// Scale the radii up if they are too small to span the endpoints.
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) {
		const scale = Math.sqrt(lambda);
		rx *= scale;
		ry *= scale;
	}

	const sign = largeArc === sweep ? -1 : 1;
	const numerator =
		rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
	const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));

	const cxp = (coefficient * (rx * y1p)) / ry;
	const cyp = (coefficient * -(ry * x1p)) / rx;
	const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
	const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

	const angleOf = (ux: number, uy: number) => Math.atan2(uy, ux);
	const theta1 = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry);
	let deltaTheta = angleOf((-x1p - cxp) / rx, (-y1p - cyp) / ry) - theta1;

	if (!sweep && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
	if (sweep && deltaTheta < 0) deltaTheta += 2 * Math.PI;

	return arcCubics(cx, cy, rx, ry, rotationDeg, theta1, deltaTheta);
}
