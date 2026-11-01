/**
 * Curve interpolation: smooth cubic `CurvePath`s through or along points (d3-shape
 * style curve factories), painted natively. Curves are computed in whatever space
 * the points are given in.
 */

import { lineSegment, splitCubicAt } from "./path/cubic.js";
import { polylineToCurvePath } from "./path/svg-path.js";
import type { CurvePath, CurveSegment, Point } from "./path/types.js";

/**
 * How a line or area's boundary runs between its points:
 *
 * - `"linear"` — straight segments (the default everywhere).
 * - `"monotone"` — a cubic that keeps the data's shape in y: it never
 *   overshoots a point, so each segment stays within its two ends' y and a
 *   monotone run stays monotone (Steffen's method, as d3's
 *   `curveMonotoneX`). Assumes the points run along x.
 * - `"natural"` — a natural cubic spline (second derivative zero at the
 *   ends, as d3's `curveNatural`): the smoothest curve through the points,
 *   which can overshoot between them.
 * - `"catmull-rom"` — a centripetal Catmull–Rom spline (α = 0.5, as d3's
 *   `curveCatmullRom`): smooth through every point, without the cusps and
 *   self-intersections of the uniform spline.
 * - `"step"` — a step at the midpoint between points (d3's `curveStep`).
 * - `"step-before"` — the step at the start: each y begins at the previous
 *   x (matplotlib's `drawstyle="steps-pre"`, d3's `curveStepBefore`).
 * - `"step-after"` — the step at the end: each y holds until the next x
 *   (`"steps-post"`, `curveStepAfter`).
 *
 * @category Paths
 */
export type CurveKind =
	| "linear"
	| "monotone"
	| "natural"
	| "catmull-rom"
	| "step"
	| "step-before"
	| "step-after";

/**
 * The curve kinds a closed ring takes (a radar polygon): straight or a
 * closed centripetal Catmull–Rom spline.
 *
 * @category Paths
 */
export type ClosedCurveKind = "linear" | "catmull-rom";

/** The step polyline: two corners per gap between points. */
function stepPoints(points: readonly Point[], at: number): Point[] {
	const out: Point[] = [points[0]];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (at <= 0) out.push({ x: a.x, y: b.y });
		else if (at >= 1) out.push({ x: b.x, y: a.y });
		else {
			const x = a.x + (b.x - a.x) * at;
			out.push({ x, y: a.y }, { x, y: b.y });
		}
		out.push(b);
	}
	return out;
}

/** 1 for non-negative, −1 for negative (d3-shape's `sign`, so 0 counts as up). */
function sign(x: number): number {
	return x < 0 ? -1 : 1;
}

/** Steffen's tangent at the middle of three points (d3-shape's `slope3`). */
function slope3(a: Point, b: Point, c: Point): number {
	const h0 = b.x - a.x;
	const h1 = c.x - b.x;
	const s0 = (b.y - a.y) / (h0 || (h1 < 0 ? -0 : 0));
	const s1 = (c.y - b.y) / (h1 || (h0 < 0 ? -0 : 0));
	const p = (s0 * h1 + s1 * h0) / (h0 + h1);
	return (
		(sign(s0) + sign(s1)) *
			Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
	);
}

/** The end tangent from a segment and its inner end's tangent (d3-shape's `slope2`). */
function slope2(a: Point, b: Point, t: number): number {
	const h = b.x - a.x;
	return h ? ((3 * (b.y - a.y)) / h - t) / 2 : t;
}

/** Monotone (Steffen) segments: tangents per point, Hermite to Bézier. */
function monotoneSegments(points: readonly Point[]): CurveSegment[] {
	const n = points.length;
	const tangents = new Array<number>(n);
	for (let i = 1; i < n - 1; i++)
		tangents[i] = slope3(points[i - 1], points[i], points[i + 1]);
	tangents[0] = slope2(points[0], points[1], tangents[1]);
	tangents[n - 1] = slope2(points[n - 2], points[n - 1], tangents[n - 2]);
	const segments: CurveSegment[] = [];
	for (let i = 0; i < n - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const dx = (b.x - a.x) / 3;
		segments.push({
			c1: { x: a.x + dx, y: a.y + dx * tangents[i] },
			c2: { x: b.x - dx, y: b.y - dx * tangents[i + 1] },
			to: b,
		});
	}
	return segments;
}

/** The natural spline's Bézier control values along one coordinate (d3-shape's `controlPoints`). */
function naturalControls(v: readonly number[]): [number[], number[]] {
	const n = v.length - 1;
	const a = new Array<number>(n);
	const b = new Array<number>(n);
	const r = new Array<number>(n);
	a[0] = 0;
	b[0] = 2;
	r[0] = v[0] + 2 * v[1];
	for (let i = 1; i < n - 1; i++) {
		a[i] = 1;
		b[i] = 4;
		r[i] = 4 * v[i] + 2 * v[i + 1];
	}
	a[n - 1] = 2;
	b[n - 1] = 7;
	r[n - 1] = 8 * v[n - 1] + v[n];
	for (let i = 1; i < n; i++) {
		const m = a[i] / b[i - 1];
		b[i] -= m;
		r[i] -= m * r[i - 1];
	}
	a[n - 1] = r[n - 1] / b[n - 1];
	for (let i = n - 2; i >= 0; i--) a[i] = (r[i] - a[i + 1]) / b[i];
	b[n - 1] = (v[n] + a[n - 1]) / 2;
	for (let i = 0; i < n - 1; i++) b[i] = 2 * v[i + 1] - a[i + 1];
	return [a, b];
}

function naturalSegments(points: readonly Point[]): CurveSegment[] {
	const [ax, bx] = naturalControls(points.map((p) => p.x));
	const [ay, by] = naturalControls(points.map((p) => p.y));
	return points.slice(1).map((to, i) => ({
		c1: { x: ax[i], y: ay[i] },
		c2: { x: bx[i], y: by[i] },
		to,
	}));
}

const EPSILON = 1e-12;

/**
 * One centripetal Catmull–Rom segment `p1 → p2` as a cubic, with neighbours
 * `p0` and `p3` (undefined at an open end, which then gets a zero tangent,
 * as d3's `curveCatmullRom` does).
 */
function catmullRomSegment(
	p0: Point | undefined,
	p1: Point,
	p2: Point,
	p3: Point | undefined,
): CurveSegment {
	const alpha = 0.5;
	const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
	const l12a = d12 ** alpha;
	const l12a2 = d12 ** (2 * alpha);
	let c1 = p1;
	let c2 = p2;
	if (p0) {
		const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
		const l01a = d01 ** alpha;
		if (l01a > EPSILON) {
			const l01a2 = d01 ** (2 * alpha);
			const a = 2 * l01a2 + 3 * l01a * l12a + l12a2;
			const n = 3 * l01a * (l01a + l12a);
			c1 = {
				x: (p1.x * a - p0.x * l12a2 + p2.x * l01a2) / n,
				y: (p1.y * a - p0.y * l12a2 + p2.y * l01a2) / n,
			};
		}
	}
	if (p3) {
		const d23 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
		const l23a = d23 ** alpha;
		if (l23a > EPSILON) {
			const l23a2 = d23 ** (2 * alpha);
			const b = 2 * l23a2 + 3 * l23a * l12a + l12a2;
			const m = 3 * l23a * (l23a + l12a);
			c2 = {
				x: (p2.x * b + p1.x * l23a2 - p3.x * l12a2) / m,
				y: (p2.y * b + p1.y * l23a2 - p3.y * l12a2) / m,
			};
		}
	}
	return { c1: { ...c1 }, c2: { ...c2 }, to: p2 };
}

function catmullRomSegments(points: readonly Point[]): CurveSegment[] {
	const segments: CurveSegment[] = [];
	for (let i = 0; i < points.length - 1; i++)
		segments.push(
			catmullRomSegment(points[i - 1], points[i], points[i + 1], points[i + 2]),
		);
	return segments;
}

/**
 * The open curve of kind `curve` through `points`, in their order: a
 * `CurvePath` of cubic segments (`"linear"` gives exactly
 * `polylineToCurvePath(points, false)`). Every kind but the steps passes
 * through every point; the steps add their corners. Fewer than three points
 * draw straight under every smooth kind; no points give an empty path.
 *
 * Points are not checked for finiteness: split a run at its gaps first and
 * curve each defined run on its own, so a missing value lifts the pen.
 *
 * @param points - The vertices, in order.
 * @param curve - See {@link CurveKind}. Defaults to `"linear"`.
 * @returns An open curve path.
 * @example
 * ```ts
 * import { createScene, path } from "@sophistry/core";
 * import { curvePath } from "@sophistry/core/geometry";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * const points = [0, 2, 1.5, 3, 0.5].map((y, x) => ({ x: x - 2, y }));
 *
 * // Smooth through every point, never overshooting one.
 * scene.add(path.create({ curvePoints: curvePath(points, "monotone") }));
 * ```
 *
 * @category Paths
 */
export function curvePath(
	points: readonly Point[],
	curve: CurveKind = "linear",
): CurvePath {
	const n = points.length;
	if (curve === "step")
		return polylineToCurvePath(stepPoints(points, 0.5), false);
	if (curve === "step-before")
		return n === 0
			? polylineToCurvePath([], false)
			: polylineToCurvePath(stepPoints(points, 0), false);
	if (curve === "step-after")
		return n === 0
			? polylineToCurvePath([], false)
			: polylineToCurvePath(stepPoints(points, 1), false);
	if (curve === "linear" || n < 3)
		return polylineToCurvePath([...points], false);
	const segments =
		curve === "monotone"
			? monotoneSegments(points)
			: curve === "natural"
				? naturalSegments(points)
				: catmullRomSegments(points);
	return {
		start: { ...points[0] },
		segments: segments.map((s) => ({ ...s, to: { ...s.to } })),
		closed: false,
	};
}

/**
 * The closed curve of kind `curve` through a ring's `points` (not repeating
 * the first at the end): straight, or a closed centripetal Catmull–Rom
 * spline (d3's `curveCatmullRomClosed`), smooth at every vertex including
 * the first.
 *
 * @param points - The ring's vertices, in order; a repeated first point at the end is ignored.
 * @param curve - See {@link ClosedCurveKind}. Defaults to `"linear"`.
 * @returns A closed curve path (its last segment returns to `start`).
 *
 * @category Paths
 */
export function closedCurvePath(
	points: readonly Point[],
	curve: ClosedCurveKind = "linear",
): CurvePath {
	const last = points[points.length - 1];
	const ring =
		points.length > 1 && last.x === points[0].x && last.y === points[0].y
			? points.slice(0, -1)
			: points;
	const n = ring.length;
	if (curve === "linear" || n < 3) return polylineToCurvePath([...ring], true);
	const segments: CurveSegment[] = [];
	for (let i = 0; i < n; i++)
		segments.push(
			catmullRomSegment(
				ring[(i + n - 1) % n],
				ring[i],
				ring[(i + 1) % n],
				ring[(i + 2) % n],
			),
		);
	return {
		start: { ...ring[0] },
		segments: segments.map((s) => ({ ...s, to: { ...s.to } })),
		closed: true,
	};
}

/**
 * The same open curve traced from its end back to its start: segment order
 * reversed and each segment's control points swapped. Exact — no refitting —
 * so a boundary curved once can bound an area from either side.
 *
 * @category Paths
 */
export function reverseCurvePath(path: CurvePath): CurvePath {
	const { segments } = path;
	if (segments.length === 0) return { ...path, start: { ...path.start } };
	const out: CurveSegment[] = [];
	for (let i = segments.length - 1; i >= 0; i--) {
		const from = i > 0 ? segments[i - 1].to : path.start;
		out.push({
			c1: { ...segments[i].c2 },
			c2: { ...segments[i].c1 },
			to: { ...from },
		});
	}
	return {
		start: { ...segments[segments.length - 1].to },
		segments: out,
		closed: path.closed,
	};
}

/**
 * The closed area between two boundaries over the same run: `upper` curved
 * forward, a straight edge to `lower`'s end, `lower` curved forward and
 * traced back, then closed. Each boundary is curved from its own points
 * alone, so two areas that share a boundary (adjacent bands of a stack)
 * share the exact same curve along it.
 *
 * @param upper - One boundary's points, in order.
 * @param lower - The other's, in the same order (the same xs, for a band).
 * @param curve - See {@link CurveKind}. Defaults to `"linear"`.
 * @returns A closed curve path.
 *
 * @category Paths
 */
export function areaCurvePath(
	upper: readonly Point[],
	lower: readonly Point[],
	curve: CurveKind = "linear",
): CurvePath {
	const top = curvePath(upper, curve);
	if (lower.length === 0) return { ...top, closed: true };
	const bottom = reverseCurvePath(curvePath(lower, curve));
	const end = top.segments.length
		? top.segments[top.segments.length - 1].to
		: top.start;
	return {
		start: top.start,
		segments: [
			...top.segments,
			lineSegment(end, bottom.start),
			...bottom.segments,
		],
		closed: true,
	};
}

type Cubic = [Point, Point, Point, Point];

/** One coordinate of a cubic Bézier at `t`. */
function bezier1(
	a: number,
	b: number,
	c: number,
	d: number,
	t: number,
): number {
	const s = 1 - t;
	return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

/** The parameters in (0, 1) where `x(t) = cutoff`, ascending. */
function crossings(cubic: Cubic, cutoff: number): number[] {
	const [p0, p1, p2, p3] = cubic.map((p) => p.x);
	// x'(t)/3 = A t² + B t + C: its roots split 0..1 into monotone pieces.
	const a = p1 - p0;
	const b = p2 - p1;
	const c = p3 - p2;
	const A = a - 2 * b + c;
	const B = 2 * (b - a);
	const C = a;
	const breaks = [0];
	if (Math.abs(A) < EPSILON) {
		if (Math.abs(B) > EPSILON) breaks.push(-C / B);
	} else {
		const disc = B * B - 4 * A * C;
		if (disc >= 0) {
			const root = Math.sqrt(disc);
			breaks.push((-B - root) / (2 * A), (-B + root) / (2 * A));
		}
	}
	breaks.push(1);
	const ts = breaks.filter((t) => t >= 0 && t <= 1).sort((u, v) => u - v);
	const out: number[] = [];
	const f = (t: number) => bezier1(p0, p1, p2, p3, t) - cutoff;
	for (let i = 1; i < ts.length; i++) {
		let lo = ts[i - 1];
		let hi = ts[i];
		let flo = f(lo);
		const fhi = f(hi);
		if (flo === 0 || fhi === 0 || flo * fhi > 0) continue;
		for (let k = 0; k < 60 && hi - lo > 1e-14; k++) {
			const mid = (lo + hi) / 2;
			const fm = f(mid);
			if (fm * flo > 0) {
				lo = mid;
				flo = fm;
			} else hi = mid;
		}
		out.push((lo + hi) / 2);
	}
	return out;
}

/** The piece of a cubic between parameters `t0 < t1`. */
function subCubic(cubic: Cubic, t0: number, t1: number): Cubic {
	if (t0 <= 0 && t1 >= 1) return cubic;
	const right =
		t0 > 0 ? splitCubicAt(...cubic, t0).right : ([...cubic] as Cubic);
	if (t1 >= 1) return right;
	const u = (t1 - t0) / (1 - t0);
	return splitCubicAt(...right, u).left;
}

/** Each segment's pieces left of `cutoff`, with whether each joins the one before. */
function insidePieces(
	path: CurvePath,
	cutoff: number,
): { cubic: Cubic; joined: boolean }[] {
	const out: { cubic: Cubic; joined: boolean }[] = [];
	let cursor = path.start;
	let open = false;
	const segments = path.closed
		? [...path.segments, ...closingSegment(path)]
		: path.segments;
	for (const segment of segments) {
		const cubic: Cubic = [cursor, segment.c1, segment.c2, segment.to];
		cursor = segment.to;
		const xs = cubic.map((p) => p.x);
		if (Math.max(...xs) <= cutoff) {
			out.push({ cubic, joined: open });
			open = true;
			continue;
		}
		if (Math.min(...xs) > cutoff) {
			open = false;
			continue;
		}
		const ts = [0, ...crossings(cubic, cutoff), 1];
		for (let i = 1; i < ts.length; i++) {
			const t0 = ts[i - 1];
			const t1 = ts[i];
			const mid = bezier1(xs[0], xs[1], xs[2], xs[3], (t0 + t1) / 2);
			if (mid <= cutoff && t1 > t0) {
				const piece = subCubic(cubic, t0, t1);
				if (t0 > 0) piece[0] = { x: cutoff, y: piece[0].y };
				if (t1 < 1) piece[3] = { x: cutoff, y: piece[3].y };
				out.push({ cubic: piece, joined: open && t0 === 0 });
				open = t1 === 1;
			} else open = false;
		}
	}
	return out;
}

/** A closed path's implicit closing edge, when its last segment does not already end at `start`. */
function closingSegment(path: CurvePath): CurveSegment[] {
	const end = path.segments.length
		? path.segments[path.segments.length - 1].to
		: path.start;
	return end.x === path.start.x && end.y === path.start.y
		? []
		: [lineSegment(end, path.start)];
}

/**
 * The parts of an open curve at or left of `cutoff`, each segment split
 * exactly where the curve crosses (the curve is cut, not straightened). A
 * curve that doubles back over the cut comes out as several pieces, as it
 * would under a clip.
 *
 * @param path - An open curve path.
 * @param cutoff - Keep `x <= cutoff`.
 * @returns The kept pieces, open; an empty list when nothing is left.
 *
 * @category Paths
 */
export function clipCurvePathToX(path: CurvePath, cutoff: number): CurvePath[] {
	const out: CurvePath[] = [];
	let current: CurvePath | undefined;
	for (const { cubic, joined } of insidePieces(
		{ ...path, closed: false },
		cutoff,
	)) {
		if (!current || !joined) {
			current = { start: { ...cubic[0] }, segments: [], closed: false };
			out.push(current);
		}
		current.segments.push({ c1: cubic[1], c2: cubic[2], to: cubic[3] });
	}
	return out;
}

/**
 * A closed curve (a filled area) cut to the half-plane `x <= cutoff`: the
 * curve's pieces left of the cut, joined along the cut by straight edges,
 * so the area is revealed up to a straight front with its curved edges
 * intact.
 *
 * @param path - A closed curve path.
 * @param cutoff - Keep `x <= cutoff`.
 * @returns The cut path, closed, or undefined when nothing is left of the cut.
 *
 * @category Paths
 */
export function clipClosedCurvePathToX(
	path: CurvePath,
	cutoff: number,
): CurvePath | undefined {
	const pieces = insidePieces({ ...path, closed: true }, cutoff);
	if (pieces.length === 0) return undefined;
	const start = pieces[0].cubic[0];
	const segments: CurveSegment[] = [];
	let cursor = start;
	for (const { cubic } of pieces) {
		if (cubic[0].x !== cursor.x || cubic[0].y !== cursor.y)
			segments.push(lineSegment(cursor, cubic[0]));
		segments.push({ c1: cubic[1], c2: cubic[2], to: cubic[3] });
		cursor = cubic[3];
	}
	return { start: { ...start }, segments, closed: true };
}
