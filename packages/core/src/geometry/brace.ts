/**
 * Curly-brace geometry — Manim's `Brace`, as a pure function of two points.
 *
 * A brace is drawn as a filled shape, not a stroke: its width swells along
 * each arm and pinches to points at the tip and thins at the ends, which a
 * single stroke width cannot do. Each arm is its own ring, so the cusp at the
 * tip (where the centreline doubles back on itself) never has to be offset.
 */

import type { Bounds, Point, Polyline } from "./path/types.js";

/** @category Shapes */
export interface BraceOptions {
	/**
	 * How far the tip stands out from the span, scene units.
	 * @default 0.25
	 */
	depth?: number;
	/**
	 * Widest point of each arm, scene units.
	 * @default 0.08
	 */
	thickness?: number;
}

/** Samples per cubic piece of an arm's centreline. */
const CURVE_SAMPLES = 16;
/** Width left at a brace's two ends, as a share of `thickness`, so they read as ends rather than vanishing. */
const END_WIDTH = 0.25;

function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
	const u = 1 - t;
	return {
		x:
			u * u * u * a.x +
			3 * u * u * t * b.x +
			3 * u * t * t * c.x +
			t * t * t * d.x,
		y:
			u * u * u * a.y +
			3 * u * u * t * b.y +
			3 * u * t * t * c.y +
			t * t * t * d.y,
	};
}

/**
 * One arm's centreline in the brace's own frame (x along the span from 0,
 * y outward), from the end at the origin to the tip at `(half, depth)`.
 */
function armCentreline(half: number, depth: number): Polyline {
	const mid = depth / 2;
	// The shoulders' radius: the depth, unless the span is too short for it.
	const r = Math.min(depth, half / 2);
	const out: Polyline = [];
	const piece = (a: Point, b: Point, c: Point, d: Point) => {
		for (let i = out.length === 0 ? 0 : 1; i <= CURVE_SAMPLES; i++)
			out.push(cubic(a, b, c, d, i / CURVE_SAMPLES));
	};
	piece(
		{ x: 0, y: 0 },
		{ x: 0, y: 0.55 * mid },
		{ x: 0.45 * r, y: mid },
		{ x: r, y: mid },
	);
	if (half - r > r) out.push({ x: half - r, y: mid });
	const from = out[out.length - 1];
	piece(
		from,
		{ x: from.x + 0.55 * (half - from.x), y: mid },
		{ x: half, y: mid + 0.45 * mid },
		{ x: half, y: depth },
	);
	return out;
}

/**
 * Outlines a centreline with a width that swells from `END_WIDTH` of
 * `thickness` at its start to `thickness` mid-way and pinches to nothing at
 * its end: a closed ring, wound counter-clockwise in the frame it is given in.
 */
function outlineArm(line: Polyline, thickness: number): Polyline {
	const lengths = [0];
	for (let i = 1; i < line.length; i++)
		lengths.push(
			lengths[i - 1] +
				Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y),
		);
	const total = lengths[lengths.length - 1] || 1;
	const left: Polyline = [];
	const right: Polyline = [];
	line.forEach((p, i) => {
		const prev = line[Math.max(0, i - 1)];
		const next = line[Math.min(line.length - 1, i + 1)];
		const dx = next.x - prev.x;
		const dy = next.y - prev.y;
		const norm = Math.hypot(dx, dy) || 1;
		const s = lengths[i] / total;
		const swell = Math.sin(Math.PI * s) ** 0.6;
		const width =
			thickness * (s < 0.5 ? Math.max(END_WIDTH, swell) : swell) * 0.5;
		const nx = -dy / norm;
		const ny = dx / norm;
		left.push({ x: p.x + nx * width, y: p.y + ny * width });
		right.push({ x: p.x - nx * width, y: p.y - ny * width });
	});
	return [...right, ...left.reverse(), { ...right[0] }];
}

/**
 * The rings of a curly brace spanning `from` to `to`, its tip pointing to the
 * right of the direction of travel: from left to right, a brace that opens
 * upward and points down, as Manim's `BraceBetweenPoints` does. Swap the two
 * points to flip it. Two closed rings, one per arm, wound the same way, to be
 * filled with no stroke.
 *
 * @param from - One end of the span, scene units.
 * @param to - The other end.
 * @param options - {@link BraceOptions}.
 * @returns The two arms' rings, or none for a zero-length span.
 *
 * @category Shapes
 */
export function braceRings(
	from: Point,
	to: Point,
	options: BraceOptions = {},
): Polyline[] {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (!(length > 0)) return [];
	const depth = options.depth ?? 0.25;
	const thickness = options.thickness ?? 0.08;
	const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
	const out = { x: along.y, y: -along.x };
	const place = (p: Point): Point => ({
		x: from.x + along.x * p.x + out.x * p.y,
		y: from.y + along.y * p.x + out.y * p.y,
	});
	// Built in a frame whose y is `out`, which is clockwise of `along`; the
	// arm outlined there winds the other way once placed, and mirroring the
	// second arm flips it back, so it is reversed to match the first.
	const arm = outlineArm(armCentreline(length / 2, depth), thickness);
	const first = arm.map(place);
	const second = arm.map((p) => place({ x: length - p.x, y: p.y })).reverse();
	return [first, second];
}

/**
 * The tip of the brace {@link braceRings} draws between `from` and `to`:
 * where a label goes.
 *
 * @category Shapes
 */
export function braceTip(
	from: Point,
	to: Point,
	options: Pick<BraceOptions, "depth"> = {},
): Point {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	const depth = options.depth ?? 0.25;
	if (!(length > 0)) return { ...from };
	return {
		x: (from.x + to.x) / 2 + ((to.y - from.y) / length) * depth,
		y: (from.y + to.y) / 2 - ((to.x - from.x) / length) * depth,
	};
}

/**
 * The span a brace takes beside a box: the side of `bounds` that faces
 * `direction`, pushed out by `gap`, ordered so {@link braceRings} points the
 * tip along `direction`. Works for any direction, not only the four sides: the
 * span covers the box's whole extent across it.
 *
 * @param bounds - The box to brace, scene units.
 * @param direction - Which side, as a vector (`DOWN`, `LEFT`, …). Need not be unit length.
 * @param gap - Gap between the box and the brace. Defaults to 0.2.
 * @returns The span's two ends.
 *
 * @category Shapes
 */
export function braceSpan(
	bounds: Bounds,
	direction: Point,
	gap = 0.2,
): { from: Point; to: Point } {
	const norm = Math.hypot(direction.x, direction.y) || 1;
	const d = { x: direction.x / norm, y: direction.y / norm };
	// Counter-clockwise of `d`, so `d` is clockwise of the span: the side
	// `braceRings` points to.
	const u = { x: -d.y, y: d.x };
	const corners = [
		{ x: bounds.minX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.maxY },
		{ x: bounds.minX, y: bounds.maxY },
	];
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	let reach = Number.NEGATIVE_INFINITY;
	for (const c of corners) {
		const across = c.x * u.x + c.y * u.y;
		low = Math.min(low, across);
		high = Math.max(high, across);
		reach = Math.max(reach, c.x * d.x + c.y * d.y);
	}
	const out = reach + gap;
	return {
		from: { x: u.x * low + d.x * out, y: u.y * low + d.y * out },
		to: { x: u.x * high + d.x * out, y: u.y * high + d.y * out },
	};
}
