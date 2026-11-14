/**
 * Rounded rectangles as native curves: each corner a cubic quarter-ellipse,
 * with a radius (or a separate horizontal and vertical radius) per corner,
 * scaled down together when adjacent radii would overlap, as CSS does.
 */

import { reverseCurvePath } from "./curves.js";
import { lineSegment } from "./path/cubic.js";
import type { CurvePath, CurveSegment, Point } from "./path/types.js";

/**
 * A corner's radius: one number, or a horizontal and a vertical radius for an
 * elliptical corner.
 *
 * @category Shapes
 */
export type CornerRadius = number | { readonly x: number; readonly y: number };

/**
 * Radii for the four corners, clockwise from the top left as seen on a y-up
 * stage: top left, top right, bottom right, bottom left.
 *
 * @category Shapes
 */
export type CornerRadii = readonly [
	topLeft: CornerRadius,
	topRight: CornerRadius,
	bottomRight: CornerRadius,
	bottomLeft: CornerRadius,
];

/** The cubic control distance for a quarter circle, as a fraction of the radius. */
const KAPPA = 0.5522847498307936;

interface Radius {
	x: number;
	y: number;
}

function readRadius(radius: CornerRadius): Radius {
	const pair = typeof radius === "number" ? { x: radius, y: radius } : radius;
	return { x: Math.max(0, pair.x || 0), y: Math.max(0, pair.y || 0) };
}

/**
 * The corner radii actually drawn for a `width` by `height` box: negative
 * values become 0, and when two radii on one side add up to more than that
 * side, every radius is scaled down by the same factor (CSS's rule), so the
 * shape stays a rounded rectangle instead of folding over itself.
 *
 * @param width - Box width.
 * @param height - Box height.
 * @param radii - One radius for every corner, or one per corner.
 * @returns The four radii, clockwise from the top left.
 *
 * @category Shapes
 */
export function resolveCornerRadii(
	width: number,
	height: number,
	radii: CornerRadius | CornerRadii,
): [Radius, Radius, Radius, Radius] {
	const list =
		Array.isArray(radii) && radii.length === 4
			? (radii as CornerRadii)
			: ([radii, radii, radii, radii] as unknown as CornerRadii);
	const [topLeft, topRight, bottomRight, bottomLeft] = list.map(readRadius) as [
		Radius,
		Radius,
		Radius,
		Radius,
	];
	const w = Math.abs(width);
	const h = Math.abs(height);
	let factor = 1;
	const limit = (side: number, sum: number) => {
		if (sum > side && sum > 0) factor = Math.min(factor, side / sum);
	};
	limit(w, topLeft.x + topRight.x);
	limit(w, bottomLeft.x + bottomRight.x);
	limit(h, topLeft.y + bottomLeft.y);
	limit(h, topRight.y + bottomRight.y);
	const scale = (r: Radius): Radius => ({ x: r.x * factor, y: r.y * factor });
	return [
		scale(topLeft),
		scale(topRight),
		scale(bottomRight),
		scale(bottomLeft),
	];
}

/** Whether the final segment is a straight run (from `lineSegment`) ending at `start`. */
function isStraightTo(
	segment: CurveSegment,
	start: Point,
	segments: readonly CurveSegment[],
): boolean {
	const from = segments.at(-2)?.to;
	if (!from || segment.to.x !== start.x || segment.to.y !== start.y) {
		return false;
	}
	const expected = lineSegment(from, start);
	return (
		expected.c1.x === segment.c1.x &&
		expected.c1.y === segment.c1.y &&
		expected.c2.x === segment.c2.x &&
		expected.c2.y === segment.c2.y
	);
}

/**
 * A rounded rectangle as one closed curve path, counter-clockwise on a y-up
 * stage from the bottom-left corner (clockwise when `reverse`, which is how a
 * ring's hole is wound). Straight sides are cubic segments too, so the path is
 * one `CurvePath`. Corners whose radius is 0 are sharp; with every corner
 * sharp the path is the plain four-sided box.
 *
 * @example
 * ```ts
 * import { roundedRectCurvePath } from "@sophistry/core/geometry";
 *
 * // A 4 × 2 card about the origin, rounder at the top.
 * const outline = roundedRectCurvePath(-2, -1, 4, 2, [0.4, 0.4, 0.1, 0.1]);
 * ```
 *
 * @param x - Left edge.
 * @param y - Bottom edge in y-up space (`height` is added to it).
 * @param width - Width.
 * @param height - Height.
 * @param radii - One radius for every corner, or one per corner (see {@link CornerRadii}).
 * @param options - `reverse` winds the path the other way.
 * @returns The outline.
 *
 * @category Shapes
 */
export function roundedRectCurvePath(
	x: number,
	y: number,
	width: number,
	height: number,
	radii: CornerRadius | CornerRadii = 0,
	options: { reverse?: boolean } = {},
): CurvePath {
	const left = Math.min(x, x + width);
	const bottom = Math.min(y, y + height);
	const right = left + Math.abs(width);
	const top = bottom + Math.abs(height);
	const [topLeft, topRight, bottomRight, bottomLeft] = resolveCornerRadii(
		width,
		height,
		radii,
	);
	const k = 1 - KAPPA;
	const segments: CurveSegment[] = [];
	const start: Point = { x: left + bottomLeft.x, y: bottom };
	let at = start;
	const lineTo = (to: Point) => {
		if (to.x !== at.x || to.y !== at.y) segments.push(lineSegment(at, to));
		at = to;
	};
	const cornerTo = (to: Point, c1: Point, c2: Point, radius: Radius) => {
		if (radius.x > 0 && radius.y > 0) segments.push({ c1, c2, to });
		else lineTo(to);
		at = to;
	};

	lineTo({ x: right - bottomRight.x, y: bottom });
	cornerTo(
		{ x: right, y: bottom + bottomRight.y },
		{ x: right - bottomRight.x * k, y: bottom },
		{ x: right, y: bottom + bottomRight.y * k },
		bottomRight,
	);
	lineTo({ x: right, y: top - topRight.y });
	cornerTo(
		{ x: right - topRight.x, y: top },
		{ x: right, y: top - topRight.y * k },
		{ x: right - topRight.x * k, y: top },
		topRight,
	);
	lineTo({ x: left + topLeft.x, y: top });
	cornerTo(
		{ x: left, y: top - topLeft.y },
		{ x: left + topLeft.x * k, y: top },
		{ x: left, y: top - topLeft.y * k },
		topLeft,
	);
	lineTo({ x: left, y: bottom + bottomLeft.y });
	cornerTo(
		start,
		{ x: left, y: bottom + bottomLeft.y * k },
		{ x: left + bottomLeft.x * k, y: bottom },
		bottomLeft,
	);

	// A closing straight edge is drawn by `closePath`; leave it implicit.
	const last = segments.at(-1);
	if (last && at === start && isStraightTo(last, start, segments)) {
		segments.pop();
	}

	const path: CurvePath = { start, segments, closed: true };
	return options.reverse ? reverseCurvePath(path) : path;
}
