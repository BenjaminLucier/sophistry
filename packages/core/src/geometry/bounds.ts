/**
 * Axis-aligned bounding boxes: measuring them, reading points off them and
 * combining them. The one home for box math — `scene/core/layout.ts`,
 * and `interact/hit.ts` import from here — so a
 * placement, a hit test and a grow can never disagree about where an edge is.
 *
 * Pure math over plain objects, like the rest of `geometry/`.
 */

import type { Bounds, Point, Polyline } from "./path/types";
import type { Matrix } from "./transform";

export type { Bounds } from "./path/types";

/**
 * Bounding box of every point in a set of polylines.
 *
 * With no points the result is `+Infinity` minimums and `-Infinity` maximums,
 * so check for emptiness first if that can happen.
 *
 * @param polylines - The polylines.
 *
 * @category Bounds & hit math
 */
export function boundsOf(polylines: Polyline[]): Bounds {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const line of polylines) {
		for (const p of line) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Whether a box contains a point, padded outwards by `slop`. Edges count as
 * inside.
 *
 * @param box - The box.
 * @param at - The point.
 * @param slop - Padding added on every side. Defaults to 0.
 *
 * @category Bounds & hit math
 */
export function boundsContain(box: Bounds, at: Point, slop = 0): boolean {
	return (
		at.x >= box.minX - slop &&
		at.x <= box.maxX + slop &&
		at.y >= box.minY - slop &&
		at.y <= box.maxY + slop
	);
}

/**
 * Bounding box of a set of polylines after mapping them through `matrix` — the
 * same box as `boundsOf(polylines.map((line) => applyToPolyline(matrix, line)))`,
 * bit for bit, without allocating the mapped copies.
 *
 * @param matrix - The transform to apply first.
 * @param polylines - The polylines, in the matrix's source space.
 * @returns The box in the matrix's target space, or `null` when there are no points.
 *
 * @category Bounds & hit math
 */
export function boundsUnder(
	matrix: Matrix,
	polylines: readonly Polyline[],
): Bounds | null {
	const { a, b, c, d, e, f } = matrix;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let any = false;
	for (const line of polylines) {
		for (const p of line) {
			// Same expression as `applyToPoint`, so the result is identical.
			const x = a * p.x + c * p.y + e;
			const y = b * p.x + d * p.y + f;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
			any = true;
		}
	}
	return any ? { minX, minY, maxX, maxY } : null;
}

/**
 * Midpoint of a bounding box.
 *
 * @param bounds - The box.
 *
 * @category Bounds & hit math
 */
export function centerOf(bounds: Bounds): Point {
	return {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
	};
}

/**
 * The point on a box in `direction` — Manim's `get_critical_point`. `{0,0}` is
 * the centre, `{0,1}` the top edge's midpoint, `{1,1}` the top-right corner.
 *
 * Components are clamped to ±1 so summed directions (which is how `nextTo`
 * folds in its `align`) stay on the box instead of flying off it.
 *
 * It lives down here rather than up in `scene/core/layout.ts` (whose `pointOn` is
 * this) because `anim/` needs it too — `growFromEdge` grows out of a box
 * corner — and `anim/` may not import `scene/`. One implementation, so a grow
 * and a placement can never disagree about where an edge is.
 *
 * @param bounds - The box.
 * @param direction - Which point of the box: components in -1..1, `x` right, `y` up.
 *
 * @category Bounds & hit math
 */
export function pointOnBounds(bounds: Bounds, direction: Point): Point {
	const clamp = (value: number) => Math.min(1, Math.max(-1, value || 0));
	const centre = centerOf(bounds);
	return {
		x: centre.x + (clamp(direction.x) * (bounds.maxX - bounds.minX)) / 2,
		y: centre.y + (clamp(direction.y) * (bounds.maxY - bounds.minY)) / 2,
	};
}

/**
 * Width of a box (`maxX - minX`).
 *
 * @category Bounds & hit math
 */
export function boundsWidth(bounds: Bounds): number {
	return bounds.maxX - bounds.minX;
}

/**
 * Height of a box (`maxY - minY`).
 *
 * @category Bounds & hit math
 */
export function boundsHeight(bounds: Bounds): number {
	return bounds.maxY - bounds.minY;
}

/**
 * The smallest box containing all of them. Null when nothing was supplied.
 * Null and undefined entries (an unmeasured handle) are skipped.
 *
 * @category Bounds & hit math
 */
export function unionBounds(
	...items: (Bounds | null | undefined)[]
): Bounds | null {
	let out: Bounds | null = null;
	for (const item of items) {
		if (!item) continue;
		out = out
			? {
					minX: Math.min(out.minX, item.minX),
					minY: Math.min(out.minY, item.minY),
					maxX: Math.max(out.maxX, item.maxX),
					maxY: Math.max(out.maxY, item.maxY),
				}
			: { ...item };
	}
	return out;
}

/**
 * Grows a box outward by `padding` on every side. Negative shrinks it.
 *
 * @category Bounds & hit math
 */
export function padBounds(bounds: Bounds, padding: number): Bounds {
	return {
		minX: bounds.minX - padding,
		minY: bounds.minY - padding,
		maxX: bounds.maxX + padding,
		maxY: bounds.maxY + padding,
	};
}

/**
 * A box of the given size centred on a point.
 *
 * @param center - Centre point.
 * @param width - Box width.
 * @param height - Box height.
 *
 * @category Bounds & hit math
 */
export function boundsFromCenter(
	center: Point,
	width: number,
	height: number,
): Bounds {
	return {
		minX: center.x - width / 2,
		minY: center.y - height / 2,
		maxX: center.x + width / 2,
		maxY: center.y + height / 2,
	};
}
