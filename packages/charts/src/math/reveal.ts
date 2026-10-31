/**
 * Reveals that follow the independent variable: geometry cut off at an x
 * that sweeps left to right at a constant rate as `progress` runs 0 → 1, so
 * reveal progress reads as progress along x. Works on points in scene units.
 */

import type { Bounds, Point } from "@sophistry/core/geometry";

/**
 * The `[min, max]` x of every point in `polylines`, or undefined when there
 * are none (or none finite).
 *
 * @category Math & helpers
 */
export function xExtent(
	polylines: readonly (readonly Point[])[],
): [number, number] | undefined {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const line of polylines) {
		for (const { x } of line) {
			if (!Number.isFinite(x)) continue;
			if (x < min) min = x;
			if (x > max) max = x;
		}
	}
	return min <= max ? [min, max] : undefined;
}

/** The point where segment `a → b` crosses the vertical line at `cutoff`. */
function crossingAt(a: Point, b: Point, cutoff: number): Point {
	const t = (cutoff - a.x) / (b.x - a.x);
	return { x: cutoff, y: a.y + (b.y - a.y) * t };
}

/**
 * The parts of an open polyline at or left of `cutoff`; a line doubling back
 * over the cut comes out in several pieces.
 *
 * @returns The kept pieces; pieces of fewer than two points are dropped.
 * @category Math & helpers
 */
export function clipPolylineToX(
	points: readonly Point[],
	cutoff: number,
): Point[][] {
	const pieces: Point[][] = [];
	let piece: Point[] = [];
	const flush = () => {
		if (piece.length > 1) pieces.push(piece);
		piece = [];
	};
	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		const inside = point.x <= cutoff;
		if (i === 0) {
			if (inside) piece.push(point);
			continue;
		}
		const previous = points[i - 1];
		const wasInside = previous.x <= cutoff;
		if (wasInside && inside) piece.push(point);
		else if (wasInside) {
			piece.push(crossingAt(previous, point, cutoff));
			flush();
		} else if (inside) piece.push(crossingAt(previous, point, cutoff), point);
	}
	flush();
	return pieces;
}

/**
 * A closed ring cut to the half-plane `x <= cutoff`, so a filled area
 * reveals with a straight front. A ring given closed comes back closed.
 *
 * @returns The cut ring, or `[]` when nothing is left of the cut.
 * @category Math & helpers
 */
export function clipRingToX(ring: readonly Point[], cutoff: number): Point[] {
	const n = ring.length;
	if (n < 3) return [];
	const first = ring[0];
	const last = ring[n - 1];
	const closed = first.x === last.x && first.y === last.y;
	const vertices = closed ? ring.slice(0, -1) : ring;
	const out: Point[] = [];
	for (let i = 0; i < vertices.length; i++) {
		const current = vertices[i];
		const previous = vertices[(i + vertices.length - 1) % vertices.length];
		const inside = current.x <= cutoff;
		const wasInside = previous.x <= cutoff;
		if (inside !== wasInside) out.push(crossingAt(previous, current, cutoff));
		if (inside) out.push(current);
	}
	if (out.length < 3) return [];
	if (closed) out.push(out[0]);
	return out;
}

/**
 * Where the cut stands at `progress`: linear across `extent`. Ease the
 * track driving `progress` for an eased reveal.
 *
 * @category Math & helpers
 */
export function revealCutoff(
	progress: number,
	extent: readonly [number, number],
): number {
	return extent[0] + (extent[1] - extent[0]) * progress;
}

/**
 * Open polylines revealed left to right over their joint x extent, all cut
 * at the same x so lines drawn together advance together.
 *
 * @param progress - 0..1.
 * @category Math & helpers
 */
export function revealPolylinesAlongX(
	polylines: readonly (readonly Point[])[],
	progress: number,
): Point[][] {
	if (!(progress > 0)) return [];
	if (progress >= 1) return polylines.map((line) => [...line]);
	const extent = xExtent(polylines);
	if (!extent) return [];
	const cutoff = revealCutoff(progress, extent);
	return polylines.flatMap((line) => clipPolylineToX(line, cutoff));
}

/**
 * Closed rings (filled areas) revealed left to right over their joint x extent.
 *
 * @param progress - 0..1.
 * @returns The visible rings; a ring entirely right of the cut is dropped.
 * @category Math & helpers
 */
export function revealRingsAlongX(
	rings: readonly (readonly Point[])[],
	progress: number,
): Point[][] {
	if (!(progress > 0)) return [];
	if (progress >= 1) return rings.map((ring) => [...ring]);
	const extent = xExtent(rings);
	if (!extent) return [];
	const cutoff = revealCutoff(progress, extent);
	return rings
		.map((ring) => clipRingToX(ring, cutoff))
		.filter((ring) => ring.length > 0);
}

/**
 * The clip box revealing filled regions left to right: everything left of
 * the reached x, with room around so only the front cuts. Unlike a cut, it
 * leaves the geometry whole (no stroked edge along the front).
 *
 * @param polylines - The geometry being revealed, in scene units.
 * @param progress - 0..1.
 * @returns A box for `<Group clip>`, or undefined at `progress >= 1` or with no geometry.
 * @category Math & helpers
 */
export function revealClipAlongX(
	polylines: readonly (readonly Point[])[],
	progress: number,
): Bounds | undefined {
	if (progress >= 1) return undefined;
	const extent = xExtent(polylines);
	if (!extent) return undefined;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const line of polylines) {
		for (const { y } of line) {
			if (!Number.isFinite(y)) continue;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	const room = Math.max(extent[1] - extent[0], maxY - minY, 1);
	const start = extent[0] - room;
	return {
		minX: start,
		maxX: progress > 0 ? revealCutoff(progress, extent) : start,
		minY: minY - room,
		maxY: maxY + room,
	};
}
