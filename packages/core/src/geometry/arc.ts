/**
 * Curved and angular generators: arcs, sectors, béziers, polygrams, and the
 * marks that annotate an angle.
 *
 * Same contract as `shapes.ts` — ideal polylines in scene units, no styling, no
 * knowledge of a canvas. Anything that needs a *round* curve funnels through
 * `arcPolyline`, and anything that needs a bézier funnels through
 * `flattenCubicPolyline`, so there is exactly one subdivider of each kind.
 */

import { polarPoint } from "./num";
import { measure, resample } from "./path/arclength";
import {
	arcCubics,
	flattenCubicPolyline,
	lineSegment,
	quadraticToCubic,
} from "./path/cubic";
import { closePolyline, curvePathToPolyline } from "./path/svg-path";
import type { CurvePath, CurveSegment, Point, Polyline } from "./path/types";
import { arcPolyline, segmentsForRadius } from "./shapes";

/** `arcCubics`'s `[p0, c1, c2, p1]` tuples, minus the redundant per-cubic `p0`. */
function cubicsToSegments(
	cubics: [Point, Point, Point, Point][],
): CurveSegment[] {
	return cubics.map(([, c1, c2, to]) => ({ c1, c2, to }));
}

/**
 * Segment count for a partial turn — `segmentsForRadius` prorated by how much
 * of the circle the arc actually covers, so a 10° arc doesn't pay for 64
 * vertices and a 350° one still looks round.
 *
 * @param radius - Radius in scene units.
 * @param sweep - Angle covered, in radians (sign ignored).
 * @param pixelsPerUnit - Scene-to-pixel scale. Defaults to 1.
 * @param quality - Multiplier on the count. Defaults to 1.
 * @returns At least 2 segments.
 *
 * @category Shapes
 */
export function segmentsForArc(
	radius: number,
	sweep: number,
	pixelsPerUnit = 1,
	quality = 1,
): number {
	const fraction = Math.min(1, Math.abs(sweep) / (2 * Math.PI));
	return Math.max(
		2,
		Math.ceil(segmentsForRadius(radius, pixelsPerUnit, quality) * fraction),
	);
}

/**
 * The circular arc from `startAngle` to `endAngle` around `(cx, cy)` as exact
 * cubics: the curve form of `arcPolyline`, smooth at any zoom.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param r - Radius.
 * @param startAngle - Start angle in radians (0 along +x, counter-clockwise).
 * @param endAngle - End angle in radians.
 * @returns An open curve path.
 *
 * @category Shapes
 */
export function arcCurvePath(
	cx: number,
	cy: number,
	r: number,
	startAngle: number,
	endAngle: number,
): CurvePath {
	// A non-finite sweep has no arc to trace (and an infinite one would never
	// finish splitting into quarter turns); collapse it to a zero-length arc.
	const sweep = endAngle - startAngle;
	const cubics = arcCubics(
		cx,
		cy,
		r,
		r,
		0,
		startAngle,
		Number.isFinite(sweep) ? sweep : 0,
	);
	return {
		start: cubics[0][0],
		segments: cubicsToSegments(cubics),
		closed: false,
	};
}

/**
 * A full ellipse (or circle when `rx === ry`) as exact cubics.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param rx - Radius along the ellipse's x axis.
 * @param ry - Radius along the ellipse's y axis.
 * @param rotationDeg - Rotation of the axes, in degrees. Defaults to 0.
 * @returns A closed curve path.
 *
 * @category Shapes
 */
export function ellipseCurvePath(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	rotationDeg = 0,
): CurvePath {
	const cubics = arcCubics(cx, cy, rx, ry, rotationDeg, 0, Math.PI * 2);
	return {
		start: cubics[0][0],
		segments: cubicsToSegments(cubics),
		closed: true,
	};
}

/**
 * Manim's `ArcBetweenPoints`: the arc that leaves `from`, turns through `angle`
 * radians, and lands on `to`; a positive angle bulges to the right of the
 * travel direction. `angle` 0 is a straight line.
 *
 * @param from - Where the arc starts.
 * @param to - Where the arc ends.
 * @param angle - Total turn in radians; the sign picks the bulge side.
 * @param segments - Segment count. Chosen from the implied radius when omitted.
 * @returns The sampled arc.
 *
 * @category Shapes
 */
export function arcBetweenPoints(
	from: Point,
	to: Point,
	angle: number,
	segments?: number,
): Polyline {
	const curve = arcBetweenPointsCurvePath(from, to, angle);
	const seg0 = curve.segments[0];
	const chord = Math.hypot(to.x - from.x, to.y - from.y);
	if (curve.segments.length === 1 && isStraightTurn(angle, chord)) {
		// Degenerate case: mirror the curve-path form's own straight line
		// exactly, rather than flattening a single line segment through
		// `curvePathToPolyline` (same result, but this skips the detour).
		return [{ ...curve.start }, { ...seg0.to }];
	}
	const flat = curvePathToPolyline(curve);
	const count = segments ?? segmentsForArc(chordRadius(from, to, angle), angle);
	return resample(measure(flat), count + 1);
}

/**
 * A turn with no finite circle through the chord: no turn, no chord, a
 * non-finite angle, or a whole number of full turns (`sin(angle / 2) === 0`,
 * where the radius diverges). These degenerate to a straight line.
 */
function isStraightTurn(angle: number, chord: number): boolean {
	return (
		chord === 0 ||
		!Number.isFinite(angle) ||
		Math.abs(Math.sin(angle / 2)) < 1e-9
	);
}

/** Same radius derivation `arcBetweenPoints` needs for its default segment count. */
function chordRadius(from: Point, to: Point, angle: number): number {
	const chord = Math.hypot(to.x - from.x, to.y - from.y);
	return Math.abs(chord / 2 / Math.sin(angle / 2));
}

/**
 * The curve form of {@link arcBetweenPoints}; a single line segment when `angle` is 0.
 *
 * @param from - Where the arc starts.
 * @param to - Where the arc ends.
 * @param angle - Total turn in radians; the sign picks the bulge side.
 *
 * @category Shapes
 */
export function arcBetweenPointsCurvePath(
	from: Point,
	to: Point,
	angle: number,
): CurvePath {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const chord = Math.hypot(dx, dy);
	if (isStraightTurn(angle, chord)) {
		return {
			start: { ...from },
			segments: [lineSegment(from, to)],
			closed: false,
		};
	}

	const half = angle / 2;
	const radius = Math.abs(chord / 2 / Math.sin(half));
	// Distance from the chord's midpoint to the centre, signed by the turn.
	const offset = chord / 2 / Math.tan(half);
	const cx = (from.x + to.x) / 2 - (dy / chord) * offset;
	const cy = (from.y + to.y) / 2 + (dx / chord) * offset;

	const start = Math.atan2(from.y - cy, from.x - cx);
	return arcCurvePath(cx, cy, radius, start, start + angle);
}

/**
 * Pie slice: the arc, closed back through the centre.
 *
 * @param cx - Centre x, scene units.
 * @param cy - Centre y, scene units.
 * @param r - Radius, scene units.
 * @param startAngle - Start angle in radians.
 * @param endAngle - End angle in radians.
 * @param segments - Segments along the arc. Chosen from the radius and sweep when omitted.
 * @returns A closed ring starting at the centre.
 *
 * @category Shapes
 */
export function sectorPolyline(
	cx: number,
	cy: number,
	r: number,
	startAngle: number,
	endAngle: number,
	segments?: number,
): Polyline {
	const arc = arcPolyline(
		cx,
		cy,
		r,
		startAngle,
		endAngle,
		segments ?? segmentsForArc(r, endAngle - startAngle),
	);
	return closePolyline([{ x: cx, y: cy }, ...arc]);
}

/**
 * The curve form of {@link sectorPolyline}: the arc plus both radial edges as
 * explicit segments, so a `progress` reveal draws them in step.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param r - Radius.
 * @param startAngle - Start angle in radians.
 * @param endAngle - End angle in radians.
 *
 * @category Shapes
 */
export function sectorCurvePath(
	cx: number,
	cy: number,
	r: number,
	startAngle: number,
	endAngle: number,
): CurvePath {
	const arc = arcCurvePath(cx, cy, r, startAngle, endAngle);
	const arcEnd =
		arc.segments.length > 0
			? arc.segments[arc.segments.length - 1].to
			: arc.start;
	const center = { x: cx, y: cy };
	return {
		start: arc.start,
		segments: [
			...arc.segments,
			lineSegment(arcEnd, center),
			lineSegment(center, arc.start),
		],
		closed: true,
	};
}

/**
 * The two rings of an annulus, outer first. The inner ring winds backwards, so
 * the non-zero fill rule punches a real hole.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param innerR - Inner radius.
 * @param outerR - Outer radius (the radii are sorted, so order does not matter).
 * @param segments - Segments per ring. Chosen from the outer radius when omitted.
 * @returns `[outer, inner]` rings.
 *
 * @category Shapes
 */
export function annulusPolylines(
	cx: number,
	cy: number,
	innerR: number,
	outerR: number,
	segments?: number,
): [Polyline, Polyline] {
	const outer = Math.max(Math.abs(innerR), Math.abs(outerR));
	const inner = Math.min(Math.abs(innerR), Math.abs(outerR));
	const count = segments ?? segmentsForRadius(outer);
	return [
		arcPolyline(cx, cy, outer, 0, Math.PI * 2, count),
		arcPolyline(cx, cy, inner, Math.PI * 2, 0, count),
	];
}

/**
 * The curve form of {@link annulusPolylines}: two oppositely wound circles.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param innerR - Inner radius.
 * @param outerR - Outer radius.
 * @returns `[outer, inner]` closed curve paths.
 *
 * @category Shapes
 */
export function annulusCurvePaths(
	cx: number,
	cy: number,
	innerR: number,
	outerR: number,
): [CurvePath, CurvePath] {
	const outer = Math.max(Math.abs(innerR), Math.abs(outerR));
	const inner = Math.min(Math.abs(innerR), Math.abs(outerR));
	return [
		{ ...arcCurvePath(cx, cy, outer, 0, Math.PI * 2), closed: true },
		{ ...arcCurvePath(cx, cy, inner, Math.PI * 2, 0), closed: true },
	];
}

/**
 * A slice of an annulus: out along the outer arc, back along the inner one, as
 * one simple ring.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param innerR - Inner radius.
 * @param outerR - Outer radius (the radii are sorted).
 * @param startAngle - Start angle in radians.
 * @param endAngle - End angle in radians.
 * @param segments - Segments per arc. Chosen from the outer radius and sweep when omitted.
 * @returns A closed ring.
 *
 * @category Shapes
 */
export function annularSectorPolyline(
	cx: number,
	cy: number,
	innerR: number,
	outerR: number,
	startAngle: number,
	endAngle: number,
	segments?: number,
): Polyline {
	const outer = Math.max(Math.abs(innerR), Math.abs(outerR));
	const inner = Math.min(Math.abs(innerR), Math.abs(outerR));
	const count = segments ?? segmentsForArc(outer, endAngle - startAngle);
	return closePolyline([
		...arcPolyline(cx, cy, outer, startAngle, endAngle, count),
		...arcPolyline(cx, cy, inner, endAngle, startAngle, count),
	]);
}

/**
 * The curve form of {@link annularSectorPolyline}.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param innerR - Inner radius.
 * @param outerR - Outer radius.
 * @param startAngle - Start angle in radians.
 * @param endAngle - End angle in radians.
 *
 * @category Shapes
 */
export function annularSectorCurvePath(
	cx: number,
	cy: number,
	innerR: number,
	outerR: number,
	startAngle: number,
	endAngle: number,
): CurvePath {
	const outer = Math.max(Math.abs(innerR), Math.abs(outerR));
	const inner = Math.min(Math.abs(innerR), Math.abs(outerR));
	const outerArc = arcCurvePath(cx, cy, outer, startAngle, endAngle);
	const innerArc = arcCurvePath(cx, cy, inner, endAngle, startAngle);
	const outerArcEnd =
		outerArc.segments.length > 0
			? outerArc.segments[outerArc.segments.length - 1].to
			: outerArc.start;
	const innerArcEnd =
		innerArc.segments.length > 0
			? innerArc.segments[innerArc.segments.length - 1].to
			: innerArc.start;
	return {
		start: outerArc.start,
		segments: [
			...outerArc.segments,
			lineSegment(outerArcEnd, innerArc.start),
			...innerArc.segments,
			// Explicit closing radial edge, as `sectorCurvePath` does, so it is
			// measured and sliced rather than left to the implicit `closed` edge.
			lineSegment(innerArcEnd, outerArc.start),
		],
		closed: true,
	};
}

/**
 * Flattens a cubic. With `segments` given the curve is resampled to that many
 * evenly *arc-length* spaced spans; without it the adaptive subdivider picks a
 * count from the curve's own flatness.
 *
 * @param p0 - Start point.
 * @param c0 - First control point.
 * @param c1 - Second control point.
 * @param p1 - End point.
 * @param segments - Number of evenly spaced spans. Adaptive when omitted.
 * @returns The sampled curve.
 *
 * @category Shapes
 */
export function cubicBezierPolyline(
	p0: Point,
	c0: Point,
	c1: Point,
	p1: Point,
	segments?: number,
): Polyline {
	const flat = flattenCubicPolyline(p0, c0, c1, p1);
	if (segments === undefined) return flat;
	return resample(measure(flat), Math.max(2, segments + 1));
}

/**
 * Flattens a quadratic bézier, by elevating it to a cubic. See {@link cubicBezierPolyline}.
 *
 * @param p0 - Start point.
 * @param c - The control point.
 * @param p1 - End point.
 * @param segments - Number of evenly spaced spans. Adaptive when omitted.
 * @returns The sampled curve.
 *
 * @category Shapes
 */
export function quadraticBezierPolyline(
	p0: Point,
	c: Point,
	p1: Point,
	segments?: number,
): Polyline {
	const [, c0, c1] = quadraticToCubic(p0, c, p1);
	return cubicBezierPolyline(p0, c0, c1, p1, segments);
}

/**
 * Manim's `Star`: `points` spikes alternating between `outerR` and `innerR`.
 * The default rotation puts a spike at the top — scene space is y-up, so that's
 * +π/2, matching `regularPolygon`.
 *
 * @param cx - Centre x, scene units.
 * @param cy - Centre y, scene units.
 * @param outerR - Radius of the spike tips.
 * @param innerR - Radius of the notches between spikes.
 * @param points - Number of spikes (at least 2).
 * @param rotation - Angle of the first spike in radians. Defaults to `Math.PI / 2`.
 * @returns A closed ring.
 *
 * @category Shapes
 */
export function starPolygon(
	cx: number,
	cy: number,
	outerR: number,
	innerR: number,
	points: number,
	rotation = Math.PI / 2,
): Polyline {
	const n = Math.max(2, Math.floor(points));
	const ring: Polyline = [];
	for (let i = 0; i < n * 2; i++) {
		const r = i % 2 === 0 ? outerR : innerR;
		const theta = rotation + (i / (n * 2)) * Math.PI * 2;
		ring.push(polarPoint(cx, cy, r, theta));
	}
	return closePolyline(ring);
}

/**
 * The inner radius that makes a `{sides/density}` star's spikes meet where the
 * corresponding polygram's chords cross — Manim's default when you give `Star`
 * a density but no inner radius.
 *
 * @param outerR - Radius of the spike tips.
 * @param sides - Number of spikes.
 * @param density - Step of the matching polygram. Defaults to 2.
 * @returns The inner radius.
 *
 * @category Shapes
 */
export function starInnerRadius(
	outerR: number,
	sides: number,
	density = 2,
): number {
	const d = Math.min(Math.max(1, density), Math.floor(sides / 2));
	return (
		(outerR * Math.cos((Math.PI * d) / sides)) /
		Math.cos((Math.PI * (d - 1)) / sides)
	);
}

/**
 * Manim's `RegularPolygram`: `sides` points on a circle, joined every `density`
 * steps ({5/2} is the pentagram). Returns one ring per closed loop, since {6/2}
 * is two triangles.
 *
 * @param cx - Centre x.
 * @param cy - Centre y.
 * @param r - Circumradius.
 * @param sides - Number of points on the circle (at least 3).
 * @param density - How many points to skip between joined points. Defaults to 2.
 * @param rotation - Angle of the first point in radians. Defaults to `Math.PI / 2`.
 * @returns One closed ring per loop.
 *
 * @category Shapes
 */
export function polygramPolyline(
	cx: number,
	cy: number,
	r: number,
	sides: number,
	density = 2,
	rotation = Math.PI / 2,
): Polyline[] {
	const n = Math.max(3, Math.floor(sides));
	const step = ((Math.floor(density) % n) + n) % n || 1;

	const vertex = (i: number): Point => {
		const theta = rotation + ((i % n) / n) * Math.PI * 2;
		return polarPoint(cx, cy, r, theta);
	};

	const loops: Polyline[] = [];
	const seen = new Set<number>();
	for (let start = 0; start < n; start++) {
		if (seen.has(start)) continue;
		const ring: Polyline = [];
		let i = start;
		do {
			seen.add(i);
			ring.push(vertex(i));
			i = (i + step) % n;
		} while (i !== start);
		loops.push(closePolyline(ring));
	}
	return loops;
}

/**
 * Manim's `Elbow`: the two legs of a right-angle corner, hinged at `vertex` and
 * rotated by `angle`. `width` is the span of the mark, not a leg length.
 *
 * @param vertex - The corner (hinge) point.
 * @param width - Span of the mark, scene units.
 * @param angle - Rotation about `vertex` in radians. Defaults to 0.
 * @returns Three points forming the two legs.
 *
 * @category Shapes
 */
export function elbowPolyline(
	vertex: Point,
	width: number,
	angle = 0,
): Polyline {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const place = (x: number, y: number): Point => ({
		x: vertex.x + width * (x * cos - y * sin),
		y: vertex.y + width * (x * sin + y * cos),
	});
	return [place(0, 1), place(1, 1), place(1, 0)];
}

/**
 * How to pick between the four arcs two crossing rays admit.
 *
 * @category Shapes
 */
export interface AngleArcOptions {
	/**
	 * Manim's `quadrant`: a sign per ray, flipping it to its opposite so the
	 * mark can sit in any of the four regions two lines cut the plane into.
	 */
	quadrant?: [number, number];
	/** Take the reflex complement instead of the minor arc. */
	otherAngle?: boolean;
}

/**
 * The arc between the rays `vertex → from` and `vertex → to`.
 *
 * Defaults to the minor arc (|sweep| ≤ π) in whichever direction is shorter;
 * `otherAngle` swaps to the reflex one, and `quadrant` flips either ray first.
 * Degenerate rays (a point on top of the vertex) fall back to angle 0.
 *
 * @param vertex - Where the rays meet.
 * @param from - A point on the first ray.
 * @param to - A point on the second ray.
 * @param radius - Arc radius, scene units.
 * @param segments - Segment count. Chosen from the radius and sweep when omitted.
 * @param options - Which of the four arcs to take.
 * @returns The arc, starting on the `from` ray.
 *
 * @category Shapes
 */
export function angleArcPolyline(
	vertex: Point,
	from: Point,
	to: Point,
	radius: number,
	segments?: number,
	options: AngleArcOptions = {},
): Polyline {
	const [s1, s2] = options.quadrant ?? [1, 1];
	const a1 = Math.atan2((from.y - vertex.y) * s1, (from.x - vertex.x) * s1);
	const a2 = Math.atan2((to.y - vertex.y) * s2, (to.x - vertex.x) * s2);

	// Wrap into (−π, π] so the default is always the minor arc.
	let sweep = a2 - a1;
	sweep -= Math.PI * 2 * Math.floor((sweep + Math.PI) / (Math.PI * 2));
	if (options.otherAngle) sweep -= Math.sign(sweep || 1) * Math.PI * 2;

	return arcPolyline(
		vertex.x,
		vertex.y,
		radius,
		a1,
		a1 + sweep,
		segments ?? segmentsForArc(radius, sweep),
	);
}

/**
 * The curve form of {@link angleArcPolyline}.
 *
 * @param vertex - Where the rays meet.
 * @param from - A point on the first ray.
 * @param to - A point on the second ray.
 * @param radius - Arc radius.
 * @param options - Which of the four arcs to take.
 *
 * @category Shapes
 */
export function angleArcCurvePath(
	vertex: Point,
	from: Point,
	to: Point,
	radius: number,
	options: AngleArcOptions = {},
): CurvePath {
	const [s1, s2] = options.quadrant ?? [1, 1];
	const a1 = Math.atan2((from.y - vertex.y) * s1, (from.x - vertex.x) * s1);
	const a2 = Math.atan2((to.y - vertex.y) * s2, (to.x - vertex.x) * s2);

	// Wrap into (−π, π] so the default is always the minor arc.
	let sweep = a2 - a1;
	sweep -= Math.PI * 2 * Math.floor((sweep + Math.PI) / (Math.PI * 2));
	if (options.otherAngle) sweep -= Math.sign(sweep || 1) * Math.PI * 2;

	return arcCurvePath(vertex.x, vertex.y, radius, a1, a1 + sweep);
}

/**
 * The square that marks a right angle at `vertex`, sized `size` along each leg.
 * `direction1`/`direction2` need not be unit vectors — only their bearing is
 * used, so the two rays of the angle can be passed straight through.
 *
 * @param vertex - Where the rays meet.
 * @param direction1 - Direction of the first leg.
 * @param direction2 - Direction of the second leg.
 * @param size - Leg length of the mark, scene units.
 * @returns Three points forming the open square.
 *
 * @category Shapes
 */
export function rightAngleMarkPolyline(
	vertex: Point,
	direction1: Point,
	direction2: Point,
	size: number,
): Polyline {
	const unit = (d: Point): Point => {
		const length = Math.hypot(d.x, d.y);
		return length === 0 ? { x: 0, y: 0 } : { x: d.x / length, y: d.y / length };
	};
	const u = unit(direction1);
	const v = unit(direction2);
	return [
		{ x: vertex.x + u.x * size, y: vertex.y + u.y * size },
		{
			x: vertex.x + (u.x + v.x) * size,
			y: vertex.y + (u.y + v.y) * size,
		},
		{ x: vertex.x + v.x * size, y: vertex.y + v.y * size },
	];
}
