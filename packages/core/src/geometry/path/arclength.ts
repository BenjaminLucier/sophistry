/**
 * Arc-length machinery that progressive reveals sample: cumulative tables over
 * polylines and curve paths, point/slice lookup by fraction of length,
 * tangents and normals, even resampling, and the signed ring area.
 */

import { lerpPoint } from "../lerp";
import { clamp01 } from "../num";
import {
	cubicArcLength,
	cubicDirectionAt,
	lineSegment,
	splitCubicAt,
} from "./cubic";
import type { CurvePath, CurveSegment, Point, Polyline } from "./types";

/**
 * Cumulative arc-length table over a polyline. Built once per drawn shape and
 * then sampled by reveal animations; `lengths[i]` is the distance from the
 * start of the polyline to `points[i]`.
 *
 * @category Paths
 */
export interface ArcTable {
	points: Polyline;
	lengths: number[];
	total: number;
}

/**
 * Builds the arc-length table for a polyline. Do this once per shape and reuse
 * it with {@link pointAtT}, {@link sliceAtT} and {@link resample}.
 *
 * @param points - The polyline.
 * @returns The table; `total` is the polyline's length.
 *
 * @category Paths
 */
export function measure(points: Polyline): ArcTable {
	const lengths = new Array<number>(points.length);
	let total = 0;
	if (points.length > 0) lengths[0] = 0;
	for (let i = 1; i < points.length; i++) {
		total += Math.hypot(
			points[i].x - points[i - 1].x,
			points[i].y - points[i - 1].y,
		);
		lengths[i] = total;
	}
	return { points, lengths, total };
}

/** Index of the last entry at or before `distance` — shared by both arc-table shapes below. */
function locateInLengths(lengths: number[], distance: number): number {
	let lo = 0;
	let hi = lengths.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lengths[mid] <= distance) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** Index of the last table entry at or before `distance`. */
function locate(table: ArcTable, distance: number): number {
	return locateInLengths(table.lengths, distance);
}

/** The point `distance` along the table, given the index `locate` found. */
function pointAtIndex(table: ArcTable, i: number, distance: number): Point {
	const points = table.points;
	if (i >= points.length - 1) return { ...points[points.length - 1] };
	const span = table.lengths[i + 1] - table.lengths[i];
	const local = span === 0 ? 0 : (distance - table.lengths[i]) / span;
	return lerpPoint(points[i], points[i + 1], local);
}

/**
 * Point at normalized arc-length position `t` (0..1) along the polyline.
 *
 * @param table - From {@link measure}.
 * @param t - Fraction of total length, clamped to 0..1.
 * @returns The point, or the origin for an empty polyline.
 *
 * @category Paths
 */
export function pointAtT(table: ArcTable, t: number): Point {
	const points = table.points;
	if (points.length === 0) return { x: 0, y: 0 };
	if (points.length === 1 || table.total === 0) return { ...points[0] };

	const clamped = Math.min(1, Math.max(0, t));
	const distance = clamped * table.total;
	return pointAtIndex(table, locate(table, distance), distance);
}

/**
 * The leading `t` fraction of a polyline, by arc length — the primitive behind
 * `draw`/`write`. The final point is interpolated so the tip advances
 * smoothly rather than snapping between vertices.
 *
 * @param table - From {@link measure}.
 * @param t - Fraction of total length. At or above 1 returns all points; at or below 0 returns none.
 * @returns The visible part of the polyline.
 *
 * @category Paths
 */
export function sliceAtT(table: ArcTable, t: number): Polyline {
	const points = table.points;
	if (t >= 1) return points;
	if (t <= 0 || points.length < 2) return [];
	if (table.total === 0) return points;

	const distance = t * table.total;
	const i = locate(table, distance);
	const head = points.slice(0, i + 1);
	const span = table.lengths[i + 1] - table.lengths[i];
	const local = span === 0 ? 0 : (distance - table.lengths[i]) / span;
	head.push(lerpPoint(points[i], points[i + 1], local));
	return head;
}

/**
 * The stretch of a polyline between two arc-length fractions, both endpoints
 * interpolated, so adjacent `[a, b]` and `[b, c]` slices share their seam point.
 *
 * @param table - From {@link measure}.
 * @param from - Start fraction of total length (clamped to 0..1).
 * @param to - End fraction (clamped); swapped with `from` if smaller.
 * @returns The stretch between them, or none if the window is empty.
 *
 * @category Paths
 */
export function sliceBetween(
	table: ArcTable,
	from: number,
	to: number,
): Polyline {
	const points = table.points;
	if (points.length < 2) return [];
	if (table.total === 0) return points;

	const start = clamp01(Math.min(from, to));
	const end = clamp01(Math.max(from, to));
	if (end <= start) return [];

	const d0 = start * table.total;
	const d1 = end * table.total;
	const i = locate(table, d0);
	const j = locate(table, d1);

	const out: Polyline = [pointAtIndex(table, i, d0)];
	for (let k = i + 1; k <= j; k++) out.push(points[k]);
	const last = pointAtIndex(table, j, d1);
	const tail = out[out.length - 1];
	if (tail.x !== last.x || tail.y !== last.y) out.push(last);
	return out;
}

/**
 * The polylines a `progress` reveal draws: one arc-length budget spent across
 * the tables in order, the last cut short. The renderer and hit testing share
 * it, so they agree on what is drawn.
 *
 * @param tables - Arc tables, in draw order.
 * @param total - Sum of the tables' lengths.
 * @param progress - Fraction of `total` to draw, 0..1.
 * @returns The visible polylines.
 *
 * @category Paths
 */
export function revealedPolylines(
	tables: ArcTable[],
	total: number,
	progress: number,
): Polyline[] {
	if (progress <= 0 || total <= 0) return [];
	let budget = total * progress;
	const drawn: Polyline[] = [];
	for (const table of tables) {
		if (budget <= 0) break;
		if (budget >= table.total) {
			drawn.push(table.points);
			budget -= table.total;
			continue;
		}
		const piece = sliceAtT(table, table.total === 0 ? 1 : budget / table.total);
		if (piece.length > 1) drawn.push(piece);
		budget = 0;
	}
	return drawn;
}

/**
 * Exact cumulative arc-length table over a `CurvePath` (the curve form of
 * `ArcTable`): `lengths[i]` is the distance from `curve.start` to the end of
 * segment `i - 1`.
 *
 * @category Paths
 */
export interface CurveArcTable {
	curve: CurvePath;
	lengths: number[];
	total: number;
}

/**
 * Builds the exact arc-length table for a curve path, the {@link CurvePath}
 * counterpart of {@link measure}. A closed curve's implicit closing edge becomes
 * an explicit segment in `table.curve`, so a reveal draws it.
 *
 * @param input - The curve path.
 * @returns A table for {@link sliceCurveAtT}, {@link tangentAtT} and friends.
 *
 * @category Paths
 */
export function measureCurve(input: CurvePath): CurveArcTable {
	const curve = withExplicitClosingEdge(input);
	const lengths = new Array<number>(curve.segments.length + 1);
	lengths[0] = 0;
	let total = 0;
	let cursor = curve.start;
	for (let i = 0; i < curve.segments.length; i++) {
		const seg = curve.segments[i];
		total += cubicArcLength(cursor, seg.c1, seg.c2, seg.to);
		lengths[i + 1] = total;
		cursor = seg.to;
	}
	return { curve, lengths, total };
}

/** `curve` with its implicit closing edge appended as a real line segment. */
function withExplicitClosingEdge(curve: CurvePath): CurvePath {
	if (!curve.closed || curve.segments.length === 0) return curve;
	const end = curve.segments[curve.segments.length - 1].to;
	if (end.x === curve.start.x && end.y === curve.start.y) return curve;
	return {
		...curve,
		segments: [...curve.segments, lineSegment(end, { ...curve.start })],
	};
}

/**
 * The Bézier parameter at which the cubic's arc length reaches `fraction` of
 * its total — arc length is not linear in `t`, so segment-relative length
 * fractions must be inverted (bisection on the split cubic's length).
 */
function localParameter(
	cursor: Point,
	segment: CurveSegment,
	fraction: number,
): number {
	if (!(fraction > 0)) return 0;
	if (fraction >= 1) return 1;
	const total = cubicArcLength(cursor, segment.c1, segment.c2, segment.to);
	if (total === 0) return fraction;
	const target = fraction * total;
	let lo = 0;
	let hi = 1;
	for (let k = 0; k < 40; k++) {
		const mid = (lo + hi) / 2;
		const { left } = splitCubicAt(
			cursor,
			segment.c1,
			segment.c2,
			segment.to,
			mid,
		);
		if (cubicArcLength(left[0], left[1], left[2], left[3]) < target) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

function anchorBefore(curve: CurvePath, index: number): Point {
	return index === 0 ? curve.start : curve.segments[index - 1].to;
}

/** The segment index `distance` falls in, clamped to a real segment. */
function locateSegment(table: CurveArcTable, distance: number): number {
	return Math.min(
		locateInLengths(table.lengths, distance),
		table.curve.segments.length - 1,
	);
}

/** `segment` cut at the local (segment-relative) parameter `t`; both halves. */
function splitSegmentAt(
	cursor: Point,
	segment: CurveSegment,
	t: number,
): {
	left: CurveSegment;
	right: CurveSegment;
	splitPoint: Point;
} {
	const { left, right } = splitCubicAt(
		cursor,
		segment.c1,
		segment.c2,
		segment.to,
		t,
	);
	return {
		left: { c1: left[1], c2: left[2], to: left[3] },
		right: { c1: right[1], c2: right[2], to: right[3] },
		splitPoint: left[3],
	};
}

/**
 * The leading `t` fraction of a curve, by arc length, with the cut segment split
 * exactly.
 *
 * @param table - From {@link measureCurve}.
 * @param t - Fraction of total length. At or above 1 returns the whole curve.
 * @returns The leading part, never closed.
 *
 * @category Paths
 */
export function sliceCurveAtT(table: CurveArcTable, t: number): CurvePath {
	const { curve } = table;
	if (t >= 1) return curve;
	if (t <= 0 || curve.segments.length === 0 || table.total === 0) {
		return { start: curve.start, segments: [], closed: false };
	}

	const distance = t * table.total;
	const i = locateSegment(table, distance);
	const span = table.lengths[i + 1] - table.lengths[i];
	const cursor = anchorBefore(curve, i);
	const local = localParameter(
		cursor,
		curve.segments[i],
		span === 0 ? 0 : (distance - table.lengths[i]) / span,
	);
	const { left } = splitSegmentAt(cursor, curve.segments[i], local);

	return {
		start: curve.start,
		segments: [...curve.segments.slice(0, i), left],
		closed: false,
	};
}

/**
 * The stretch of a curve between two arc-length fractions, both endpoints split
 * exactly so adjacent slices share their seam.
 *
 * @param table - From {@link measureCurve}.
 * @param from - Start fraction of total length.
 * @param to - End fraction.
 * @returns The stretch between them.
 *
 * @category Paths
 */
export function sliceCurveBetween(
	table: CurveArcTable,
	from: number,
	to: number,
): CurvePath {
	const { curve } = table;
	if (curve.segments.length === 0 || table.total === 0) {
		return { start: curve.start, segments: [], closed: false };
	}

	const start = clamp01(Math.min(from, to));
	const end = clamp01(Math.max(from, to));
	if (end <= start) return { start: curve.start, segments: [], closed: false };

	const d0 = start * table.total;
	const d1 = end * table.total;
	const i = locateSegment(table, d0);
	const j = locateSegment(table, d1);

	if (i === j) {
		const cursor = anchorBefore(curve, i);
		const span = table.lengths[i + 1] - table.lengths[i];
		const t0 = localParameter(
			cursor,
			curve.segments[i],
			span === 0 ? 0 : (d0 - table.lengths[i]) / span,
		);
		const t1 = localParameter(
			cursor,
			curve.segments[i],
			span === 0 ? 0 : (d1 - table.lengths[i]) / span,
		);
		const { right, splitPoint: newStart } = splitSegmentAt(
			cursor,
			curve.segments[i],
			t0,
		);
		// `right` still spans [t0, 1] of the original segment; re-parametrize
		// t1 into that remaining stretch before cutting it again.
		const remainingT1 = t0 >= 1 ? 0 : (t1 - t0) / (1 - t0);
		const { left } = splitSegmentAt(newStart, right, remainingT1);
		return { start: newStart, segments: [left], closed: false };
	}

	const spanI = table.lengths[i + 1] - table.lengths[i];
	const cursorI = anchorBefore(curve, i);
	const t0 = localParameter(
		cursorI,
		curve.segments[i],
		spanI === 0 ? 0 : (d0 - table.lengths[i]) / spanI,
	);
	const { right: headSegment, splitPoint: newStart } = splitSegmentAt(
		cursorI,
		curve.segments[i],
		t0,
	);

	const spanJ = table.lengths[j + 1] - table.lengths[j];
	const cursorJ = anchorBefore(curve, j);
	const t1 = localParameter(
		cursorJ,
		curve.segments[j],
		spanJ === 0 ? 0 : (d1 - table.lengths[j]) / spanJ,
	);
	const { left: tailSegment } = splitSegmentAt(cursorJ, curve.segments[j], t1);

	return {
		start: newStart,
		segments: [headSegment, ...curve.segments.slice(i + 1, j), tailSegment],
		closed: false,
	};
}

/** Unit vector of `v`, or `fallback` when `v` has no length to point in. */
function unit(v: Point, fallback: Point): Point {
	const magnitude = Math.hypot(v.x, v.y);
	if (magnitude === 0) return { ...fallback };
	return { x: v.x / magnitude, y: v.y / magnitude };
}

/**
 * The unit tangent to a `CurvePath` at arc-length fraction `t`, from the cubic's
 * exact derivative. An empty curve or a zero-length segment returns `fallback`.
 *
 * @param table - From {@link measureCurve}.
 * @param t - Fraction of total length, clamped to 0..1.
 * @param fallback - Direction to report when there is none. Defaults to +x.
 * @returns A unit vector.
 *
 * @category Paths
 */
export function tangentAtT(
	table: CurveArcTable,
	t: number,
	fallback: Point = { x: 1, y: 0 },
): Point {
	const { curve } = table;
	if (curve.segments.length === 0) return { ...fallback };

	const clamped = Math.min(1, Math.max(0, t));
	if (table.total === 0) {
		// Every segment collapses to a single point by arc length; there is no
		// distance to locate by, so fall back to the raw parametric derivative
		// of the first segment (itself zero unless the *control points* still
		// splay away from the shared point, e.g. a degenerate-but-not-fully-
		// collapsed cubic) rather than picking a segment arbitrarily.
		const seg = curve.segments[0];
		return unit(
			cubicDirectionAt(curve.start, seg.c1, seg.c2, seg.to, clamped),
			fallback,
		);
	}

	const distance = clamped * table.total;
	const i = locateSegment(table, distance);
	const span = table.lengths[i + 1] - table.lengths[i];
	const seg = curve.segments[i];
	const cursor = anchorBefore(curve, i);
	const local = localParameter(
		cursor,
		seg,
		span === 0 ? 0 : (distance - table.lengths[i]) / span,
	);
	return unit(
		cubicDirectionAt(cursor, seg.c1, seg.c2, seg.to, local),
		fallback,
	);
}

/**
 * The unit normal to a `CurvePath` at `t`: {@link tangentAtT} turned a quarter
 * turn counter-clockwise (to the left of travel).
 *
 * @param table - From {@link measureCurve}.
 * @param t - Fraction of total length, clamped to 0..1.
 * @param fallback - Tangent to rotate when there is none. Defaults to +x.
 * @returns A unit vector pointing to the left of the direction of travel.
 *
 * @category Paths
 */
export function normalAtT(
	table: CurveArcTable,
	t: number,
	fallback: Point = { x: 1, y: 0 },
): Point {
	const tangent = tangentAtT(table, t, fallback);
	return { x: -tangent.y, y: tangent.x };
}

/**
 * Resamples to `count` points spaced evenly by arc length.
 *
 * @param table - From {@link measure}.
 * @param count - Number of output points, including both ends.
 * @returns The new polyline; for `count` below 2 a prefix of the original.
 *
 * @category Paths
 */
export function resample(table: ArcTable, count: number): Polyline {
	// Non-finite counts resample to nothing; fractions floor (no RangeError).
	const n = Number.isFinite(count) ? Math.floor(count) : 0;
	if (n < 2) return table.points.slice(0, Math.max(0, n));
	count = n;
	const out: Polyline = new Array(count);
	for (let i = 0; i < count; i++) out[i] = pointAtT(table, i / (count - 1));
	return out;
}

/**
 * Signed area of a closed ring by the shoelace formula; the sign is the
 * winding direction (positive counter-clockwise with y up). The ring needs no
 * closing repeat — the last vertex joins the first. Internal.
 *
 * @param line - The ring's vertices.
 * @returns The signed area; 0 for fewer than three points.
 */
export function ringArea(line: Polyline): number {
	let area = 0;
	for (let i = 0; i < line.length; i++) {
		const a = line[i];
		const b = line[(i + 1) % line.length];
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}
