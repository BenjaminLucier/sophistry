/**
 * Shape morphing in two steps: a **correspondence** decides which part of `from`
 * becomes which part of `to` (`Correspondence<T>`, resolved like easings), then
 * an ordinary lerp (`./lerp.ts`) interpolates the matched pair.
 *
 * - `morphPolylines`: resample to a common count and align a ring's start.
 * - `morphRings`: pair outlines and holes by role and place; unpaired rings
 *   grow or shrink.
 * - `morphPathData`: `morphRings` over two SVG path strings.
 * - `morphCurvePaths`: split segments until counts match, then lerp.
 */

import { boundsOf } from "./bounds.js";
import { lerpCurvePath, lerpPolyline, pathAlongArc } from "./lerp.js";
import { measure, pointAtT, resample, ringArea } from "./path/arclength.js";
import { cubicArcLength, lineSegment, splitCubicAt } from "./path/cubic.js";
import { closePolyline, flattenPath } from "./path/svg-path.js";
import type { CurvePath, CurveSegment, Point, Polyline } from "./path/types.js";
import { createResolver } from "./resolver.js";

/**
 * Samples a morph at `t` in 0..1 (clamped), returning the in-between polyline.
 *
 * @category Morphing & matching
 */
export type MorphInterpolator = (t: number) => Polyline;

/**
 * A correspondence: decides which piece of `from` becomes which piece of
 * `to`, before any lerping happens. This is the matching half of every morph
 * strategy in this file (see the module doc); once a correspondence has run,
 * what's left is always an ordinary `Interpolator` lerp
 * (`tween/interpolators.ts`) between the paired-up values it returns.
 *
 * @category Morphing & matching
 */
export type Correspondence<T> = (from: T, to: T) => { from: T; to: T };

/** Sum of squared distances between corresponding vertices. */
function correspondenceCost(a: Polyline, b: Polyline, offset: number): number {
	let cost = 0;
	for (let i = 0; i < a.length; i++) {
		const p = a[i];
		const q = b[(i + offset) % b.length];
		cost += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
	}
	return cost;
}

/**
 * Rotates a closed ring so its vertices line up with the target's — without
 * this, morphing a square to a circle makes the shape spin on its way over.
 *
 * Both arguments must be *open* rings (no repeated closing point): rotating a
 * list whose last entry duplicates its first would leave the new last entry
 * somewhere else entirely, and the ring would come out with a gap.
 */
function alignClosedRing(from: Polyline, to: Polyline): Polyline {
	// Which way round the target goes is set by winding, not by cost. Two rings
	// wound the same way morphed with one reversed turn inside out on the way
	// (every in-between frame collapses toward a line); two wound opposite
	// ways do the same unless one *is* reversed. Choosing by cost let a nearly
	// symmetric ring (a `6` onto a `9`) take the reversal when it had no
	// business to, and a counter wound the same way as its outline fills
	// solid. Cost still decides for a degenerate ring with no winding.
	const fromSign = Math.sign(ringArea(from));
	const toSign = Math.sign(ringArea(to));
	const reversed = [...to].reverse();
	const candidates =
		fromSign === 0 || toSign === 0
			? [to, reversed]
			: fromSign === toSign
				? [to]
				: [reversed];
	let ring = candidates[0];
	let best = 0;
	let bestCost = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		for (let offset = 0; offset < candidate.length; offset++) {
			const cost = correspondenceCost(from, candidate, offset);
			if (cost < bestCost) {
				bestCost = cost;
				best = offset;
				ring = candidate;
			}
		}
	}
	if (best === 0) return ring;
	return ring.map((_, i) => ring[(i + best) % ring.length]);
}

/**
 * A closed ring's distinct vertices: no closing repeat, no (near-)zero-length
 * edges. A zero-length edge would otherwise spend a sample on a second copy
 * of the same point.
 */
function ringVertices(ring: Polyline): Polyline {
	const eps = measure(ring).total * 1e-9;
	const vertices: Polyline = [];
	for (const p of ring.slice(0, -1)) {
		const prev = vertices[vertices.length - 1];
		if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > eps) vertices.push(p);
	}
	while (
		vertices.length > 1 &&
		Math.hypot(
			vertices[0].x - vertices[vertices.length - 1].x,
			vertices[0].y - vertices[vertices.length - 1].y,
		) <= eps
	)
		vertices.pop();
	return vertices;
}

/**
 * Resamples a closed ring to `count` points, keeping every original vertex and
 * spreading the rest along edges by length (falls back to `resample` when there
 * is no room). Used only for degenerate rings now.
 */
function resampleRing(ring: Polyline, count: number): Polyline {
	const slots = Math.floor(count) - 1;
	const table = measure(ring);
	const vertices = ringVertices(ring);
	if (vertices.length < 2 || vertices.length > slots || !(table.total > 0))
		return resample(table, count);
	const out = fillFractions(vertexFractions(vertices), slots).map((f) =>
		pointAtT(table, f),
	);
	out.push({ ...out[0] });
	return out;
}

/** Each vertex's place along the closed ring through `vertices`, as a fraction of its perimeter; the first is 0. */
function vertexFractions(vertices: Polyline): number[] {
	const table = measure([...vertices, vertices[0]]);
	return table.lengths.slice(0, -1).map((length) => length / table.total);
}

/**
 * Sorted fractions in `[0, 1)` (the first 0) topped up to `slots` entries,
 * the spare ones spread over the gaps in proportion to their length
 * (largest remainder), so long runs get more samples than short ones.
 */
function fillFractions(fractions: number[], slots: number): number[] {
	const gaps = fractions.map((f, i) => (fractions[i + 1] ?? 1) - f);
	const extra = slots - fractions.length;
	if (extra <= 0) return fractions;
	const shares = gaps.map((gap) => extra * gap);
	const counts = shares.map(Math.floor);
	let left = extra - counts.reduce((sum, n) => sum + n, 0);
	const byRemainder = shares
		.map((share, i) => ({ i, rest: share - counts[i] }))
		.sort((x, y) => y.rest - x.rest);
	for (let k = 0; left > 0; k++, left--) counts[byRemainder[k].i]++;
	const out: number[] = [];
	fractions.forEach((f, i) => {
		out.push(f);
		for (let j = 1; j <= counts[i]; j++)
			out.push(f + (gaps[i] * j) / (counts[i] + 1));
	});
	return out;
}

/** Fractions closer than this are one sample: two corners at the same place. */
const FRACTION_EPS = 1e-9;

/**
 * Samples two closed rings at the union of their vertex arc-length fractions,
 * from aligned starts, so corners of both survive and the blend has no dents.
 * Falls back to uniform samples when the corners don't fit in `samples`;
 * `undefined` for a degenerate ring.
 */
function pairRings(
	from: Polyline,
	to: Polyline,
	samples: number | undefined,
): { from: Polyline; to: Polyline } | undefined {
	const verticesA = ringVertices(from);
	const verticesB = ringVertices(to);
	if (verticesA.length < 2 || verticesB.length < 2) return undefined;
	const tableA = measure([...verticesA, verticesA[0]]);
	if (!(tableA.total > 0)) return undefined;

	// Alignment on uniform samples, exactly as `alignClosedRing` decides it.
	const probe =
		samples !== undefined
			? Math.max(4, Math.min(1024, Math.floor(samples) - 1))
			: Math.min(1024, Math.max(64, verticesA.length, verticesB.length));
	const uniform = (vertices: Polyline) => {
		const table = measure([...vertices, vertices[0]]);
		return Array.from({ length: probe }, (_, i) => pointAtT(table, i / probe));
	};
	const probeA = uniform(verticesA);
	const sameWay =
		Math.sign(ringArea(verticesA)) === Math.sign(ringArea(verticesB));
	const degenerate =
		Math.sign(ringArea(verticesA)) === 0 ||
		Math.sign(ringArea(verticesB)) === 0;
	const forward = verticesB;
	const backward = [...verticesB].reverse();
	const options = degenerate
		? [forward, backward]
		: sameWay
			? [forward]
			: [backward];
	let oriented = options[0];
	let shift = 0;
	let bestCost = Number.POSITIVE_INFINITY;
	for (const option of options) {
		const probeB = uniform(option);
		for (let offset = 0; offset < probe; offset++) {
			const cost = correspondenceCost(probeA, probeB, offset);
			if (cost < bestCost) {
				bestCost = cost;
				shift = offset / probe;
				oriented = option;
			}
		}
	}
	const tableB = measure([...oriented, oriented[0]]);

	// Every corner of both rings, on A's parameter.
	const union = [
		...vertexFractions(verticesA),
		...vertexFractions(oriented).map((f) => (f - shift + 1) % 1),
	].sort((x, y) => x - y);
	const fractions: number[] = [];
	for (const f of union) {
		const last = fractions[fractions.length - 1];
		if (last === undefined || f - last > FRACTION_EPS) fractions.push(f);
	}
	if (1 - fractions[fractions.length - 1] <= FRACTION_EPS) fractions.pop();

	const fallbackSlots = Math.min(
		1023,
		Math.max(from.length, to.length, 32) - 1,
	);
	const slots =
		samples !== undefined
			? Math.floor(samples) - 1
			: Math.min(1023, Math.max(fallbackSlots, fractions.length));
	const at =
		fractions.length <= slots
			? fillFractions(fractions, slots)
			: Array.from({ length: slots }, (_, i) => i / slots);

	const a = at.map((f) => pointAtT(tableA, f));
	const b = at.map((f) => pointAtT(tableB, (f + shift) % 1));
	return { from: [...a, { ...a[0] }], to: [...b, { ...b[0] }] };
}

/**
 * The correspondence `morphPolylines` has always used: resample both
 * polylines to a common vertex count. Closed shapes are sampled together by
 * arc length (see `pairRings`), keeping every corner of both, with the
 * target's start rotated to whichever alignment costs least — the fix for a
 * square-to-circle morph otherwise visibly spinning on its way over. A
 * factory rather than a bare `Correspondence<Polyline>` because it needs
 * `closed`/`samples` per call; `correspondences.resample` below is the
 * zero-argument version registered under a name.
 */
export function resampleCorrespondence(
	options: { closed?: boolean; samples?: number } = {},
): Correspondence<Polyline> {
	const closed = options.closed === true;
	return (from, to) => {
		// Close first, so both rings are measured over the same full perimeter.
		const source = closed ? closePolyline(from) : from;
		const target = closed ? closePolyline(to) : to;

		if (closed && (options.samples === undefined || options.samples >= 2)) {
			const paired = pairRings(source, target, options.samples);
			if (paired) return paired;
		}

		const count =
			options.samples ??
			Math.min(1024, Math.max(source.length, target.length, 32));
		let a = closed
			? resampleRing(source, count)
			: resample(measure(source), count);
		let b = closed
			? resampleRing(target, count)
			: resample(measure(target), count);

		if (closed) {
			// Align on the open rings, then re-close both so they stay the same
			// length and every in-between frame is a complete ring.
			const ringA = a.slice(0, -1);
			const ringB = b.slice(0, -1);
			// Not `closePolyline`: it leaves a ring alone whose first and last
			// points already coincide (a degenerate, zero-length source), which
			// would drop the closing vertex and desync the two vertex counts.
			const reclose = (ring: Polyline): Polyline =>
				ring.length > 0 ? [...ring, { ...ring[0] }] : ring;
			a = reclose(ringA);
			b = reclose(alignClosedRing(ringA, ringB));
		}

		return { from: a, to: b };
	};
}

/** Named correspondence strategies, resolved by `resolveCorrespondence`. */
export const correspondences = Object.freeze({
	resample: resampleCorrespondence(),
} satisfies Record<string, Correspondence<Polyline>>);

export type CorrespondenceName = keyof typeof correspondences;

const correspondenceResolver = createResolver<Correspondence<Polyline>>(
	"correspondence",
	correspondences,
);

/**
 * A name is sugar for a function — `resolveEasing`, for correspondences.
 * A falsy `spec` returns `fallback`; an unknown name throws.
 */
export function resolveCorrespondence(
	spec: Correspondence<Polyline> | CorrespondenceName | undefined,
	fallback: Correspondence<Polyline> = correspondences.resample,
): Correspondence<Polyline> {
	if (!spec) return fallback;
	return correspondenceResolver.resolve(spec);
}

/**
 * Interpolates two polylines by resampling both to a common vertex count;
 * closed ones are also aligned to the cheapest start. Build it once and call it
 * per frame.
 *
 * @param from - Starting polyline.
 * @param to - Ending polyline.
 * @param options - `closed` aligns rings; `samples` sets the common count
 *   (default the larger input, within 32 to 1024); `correspondence` replaces the
 *   pairing; `pathArc` swings vertices along an arc of that many radians.
 * @returns A function from progress (clamped to 0..1) to polyline.
 *
 * @example
 * ```ts
 * import { createScene, path } from "@sophistry/core";
 * import {
 *   circlePolyline,
 *   morphPolylines,
 *   rectPolyline,
 * } from "@sophistry/core/geometry";
 *
 * const morph = morphPolylines(
 *   rectPolyline(-1, -1, 2, 2),
 *   circlePolyline(0, 0, 1),
 *   { closed: true },
 * );
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 4 });
 * scene.add(path.create({ points: [morph(0.5)], closed: true }));
 * ```
 *
 * @category Morphing & matching
 */
export function morphPolylines(
	from: Polyline,
	to: Polyline,
	options: {
		closed?: boolean;
		samples?: number;
		correspondence?: Correspondence<Polyline>;
		pathArc?: number;
	} = {},
): MorphInterpolator {
	const correspondence =
		options.correspondence ?? resampleCorrespondence(options);
	const { from: a, to: b } = correspondence(from, to);
	const interpolate = options.pathArc
		? arcInterpolator(a, b, options.pathArc)
		: lerpPolyline(a, b);
	// Clamped, not extrapolated: a morph has no meaning past its endpoints,
	// and the pre-registry version returned the endpoint arrays outright for
	// t outside [0,1] rather than running the lerp math at all.
	return (t) => interpolate(t <= 0 ? 0 : t >= 1 ? 1 : t);
}

/** Every vertex along {@link pathAlongArc} to its partner, exact at both ends. */
function arcInterpolator(
	a: Polyline,
	b: Polyline,
	angle: number,
): (t: number) => Polyline {
	const path = pathAlongArc(angle);
	return (t) => (t <= 0 ? a : t >= 1 ? b : a.map((p, i) => path(p, b[i], t)));
}

/** A ring's place in its shape, for pairing rings across two shapes. */
interface RingRole {
	ring: Polyline;
	/** Outline (winds like the shape's largest ring) or counter (winds against it). */
	hole: boolean;
	/** Centroid as a fraction of the shape's box, so two shapes of different size compare. */
	at: Point;
	/** Unsigned area as a fraction of the box's. */
	size: number;
}

function ringRoles(rings: Polyline[]): RingRole[] {
	if (rings.length === 0) return [];
	const box = boundsOf(rings);
	const width = box.maxX - box.minX || 1;
	const height = box.maxY - box.minY || 1;
	const areas = rings.map(ringArea);
	let largest = 0;
	for (let i = 1; i < areas.length; i++) {
		if (Math.abs(areas[i]) > Math.abs(areas[largest])) largest = i;
	}
	const outer = Math.sign(areas[largest]);
	return rings.map((ring, i) => {
		let x = 0;
		let y = 0;
		for (const p of ring) {
			x += p.x;
			y += p.y;
		}
		const n = ring.length || 1;
		return {
			ring,
			hole: Math.sign(areas[i]) === -outer,
			at: { x: (x / n - box.minX) / width, y: (y / n - box.minY) / height },
			size: Math.abs(areas[i]) / (width * height),
		};
	});
}

/** The point at the same place in the other shape's box. */
function placeIn(at: Point, rings: Polyline[]): Point {
	const box = boundsOf(rings);
	return {
		x: box.minX + at.x * (box.maxX - box.minX),
		y: box.minY + at.y * (box.maxY - box.minY),
	};
}

/** A ring shrinking onto `point` as `t` runs 0..1; gone once it gets there. */
function shrinking(ring: Polyline, point: Point): MorphInterpolator {
	return (t) => {
		if (t >= 1) return [];
		const k = Math.max(0, t);
		return ring.map((p) => ({
			x: p.x + (point.x - p.x) * k,
			y: p.y + (point.y - p.y) * k,
		}));
	};
}

/**
 * Samples a many-ring morph at `t` in 0..1 (clamped), returning the rings in
 * play at that point.
 *
 * @category Morphing & matching
 */
export type RingsInterpolator = (t: number) => Polyline[];

/**
 * Morphs one many-ring shape into another: outlines into outlines and holes into
 * holes (by winding), each to the nearest of its kind, keeping winding throughout.
 * Unpaired rings shrink to or grow from a point.
 *
 * @param from - Rings of the starting shape (closed contours).
 * @param to - Rings of the ending shape.
 * @param options - `pathArc`, radians each paired ring's vertices turn through.
 * @returns A function from progress to the rings in play: all of `from` at 0,
 *   all of `to` at 1.
 *
 * @example
 * ```ts
 * import { createScene, path } from "@sophistry/core";
 * import { circlePolyline, morphRings, rectPolyline } from "@sophistry/core/geometry";
 *
 * // A square with a round hole becomes a plain disc: the hole shrinks away.
 * const ring = morphRings(
 *   [rectPolyline(-1, -1, 2, 2), circlePolyline(0, 0, 0.5).reverse()],
 *   [circlePolyline(0, 0, 1.2)],
 * );
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 4 });
 * scene.add(path.create({ points: ring(0.5), closed: true }));
 * ```
 *
 * @category Morphing & matching
 */
export function morphRings(
	from: Polyline[],
	to: Polyline[],
	options: { pathArc?: number } = {},
): RingsInterpolator {
	const source = ringRoles(from);
	const target = ringRoles(to);
	const rings: MorphInterpolator[] = [];
	const usedSource = new Set<number>();
	const usedTarget = new Set<number>();

	const candidates: { i: number; j: number; cost: number }[] = [];
	for (let i = 0; i < source.length; i++) {
		for (let j = 0; j < target.length; j++) {
			if (source[i].hole !== target[j].hole) continue;
			const a = source[i];
			const b = target[j];
			// Position first; relative size breaks the tie between rings that
			// sit in the same place (the two bars of an `=` do not, a big and a
			// small counter might).
			const sizes = Math.log((a.size + 1e-6) / (b.size + 1e-6));
			candidates.push({
				i,
				j,
				cost:
					(a.at.x - b.at.x) ** 2 + (a.at.y - b.at.y) ** 2 + 0.05 * sizes ** 2,
			});
		}
	}
	candidates.sort((a, b) => a.cost - b.cost);
	for (const { i, j } of candidates) {
		if (usedSource.has(i) || usedTarget.has(j)) continue;
		usedSource.add(i);
		usedTarget.add(j);
		rings.push(
			morphPolylines(source[i].ring, target[j].ring, {
				closed: true,
				pathArc: options.pathArc,
			}),
		);
	}

	for (let i = 0; i < source.length; i++) {
		if (usedSource.has(i)) continue;
		rings.push(
			shrinking(source[i].ring, placeIn(source[i].at, to.length ? to : from)),
		);
	}
	for (let j = 0; j < target.length; j++) {
		if (usedTarget.has(j)) continue;
		const grow = shrinking(
			target[j].ring,
			placeIn(target[j].at, from.length ? from : to),
		);
		rings.push((t) => grow(1 - t));
	}

	return (t) => {
		const clamped = Math.min(1, Math.max(0, t));
		const out: Polyline[] = [];
		for (const ring of rings) {
			const points = ring(clamped);
			if (points.length > 0) out.push(points);
		}
		return out;
	};
}

/**
 * Morphs one SVG path into another: {@link morphRings} over their subpaths,
 * so a shape with holes keeps them and two shapes with different numbers of
 * pieces still morph, the extra pieces growing or shrinking.
 *
 * Every subpath is treated as a closed ring.
 *
 * @param from - SVG path data to start from.
 * @param to - SVG path data to end at.
 * @param options - `tolerance`, the flattening budget for curves (see
 *   `flattenPath`), and `pathArc` (see {@link morphRings}).
 * @returns A function from progress (clamped to 0..1) to the rings in play.
 *
 * @category Morphing & matching
 */
export function morphPathData(
	from: string,
	to: string,
	options: { tolerance?: number; pathArc?: number } = {},
): RingsInterpolator {
	const rings = (d: string) =>
		flattenPath(d, options.tolerance)
			.map((sub) => sub.points)
			.filter((points) => points.length >= 3);
	return morphRings(rings(from), rings(to), { pathArc: options.pathArc });
}

/**
 * Straight-line interpolation between two points, re-exported for callers
 * that reach for `lerpPoint` from `"./morph"`. Defined in `./lerp.ts`.
 */
export { lerpPoint } from "./lerp.js";

/** Arc length of one segment, given the anchor point it starts from. */
function segmentLength(cursor: Point, segment: CurveSegment): number {
	return cubicArcLength(cursor, segment.c1, segment.c2, segment.to);
}

/** Splits one segment at its local midpoint via De Casteljau. */
function splitSegmentInHalf(
	cursor: Point,
	segment: CurveSegment,
): [CurveSegment, CurveSegment] {
	const { left, right } = splitCubicAt(
		cursor,
		segment.c1,
		segment.c2,
		segment.to,
		0.5,
	);
	return [
		{ c1: left[1], c2: left[2], to: left[3] },
		{ c1: right[1], c2: right[2], to: right[3] },
	];
}

/**
 * Grows `curve` to `targetCount` segments by repeatedly bisecting its longest
 * segment, keeping it an exact bézier.
 */
function promoteToSegmentCount(
	curve: CurvePath,
	targetCount: number,
): CurvePath {
	if (curve.segments.length >= targetCount) return curve;

	if (curve.segments.length === 0) {
		// Nothing to subdivide — repeat a zero-length segment at the curve's own
		// point so the segment count still matches.
		const segments: CurveSegment[] = [];
		for (let i = 0; i < targetCount; i++) {
			segments.push(lineSegment(curve.start, { ...curve.start }));
		}
		return { start: curve.start, segments, closed: curve.closed };
	}

	const segments = curve.segments.slice();
	const anchors: Point[] = new Array(segments.length);
	let cursor = curve.start;
	for (let i = 0; i < segments.length; i++) {
		anchors[i] = cursor;
		cursor = segments[i].to;
	}

	while (segments.length < targetCount) {
		let worst = 0;
		let worstLength = -1;
		for (let i = 0; i < segments.length; i++) {
			const length = segmentLength(anchors[i], segments[i]);
			if (length > worstLength) {
				worstLength = length;
				worst = i;
			}
		}
		const [left, right] = splitSegmentInHalf(anchors[worst], segments[worst]);
		segments.splice(worst, 1, left, right);
		anchors.splice(worst + 1, 0, left.to);
	}

	return { start: curve.start, segments, closed: curve.closed };
}

/**
 * Interpolates two `CurvePath`s control point by control point, so every frame
 * is an exact bézier; the shorter is first split up to the same segment count.
 * `closed` snaps to the nearer end.
 *
 * @param a - Curve at `t = 0`.
 * @param b - Curve at `t = 1`.
 * @param t - Progress, 0..1.
 * @returns The in-between curve.
 *
 * @category Morphing & matching
 */
export function morphCurvePaths(
	a: CurvePath,
	b: CurvePath,
	t: number,
): CurvePath {
	const targetCount = Math.max(a.segments.length, b.segments.length, 1);
	const pa = promoteToSegmentCount(a, targetCount);
	const pb = promoteToSegmentCount(b, targetCount);
	return lerpCurvePath(pa, pb)(t);
}
