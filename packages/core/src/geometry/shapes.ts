/**
 * Primitive shape generators. Each returns a polyline in scene units; the scene
 * layer transforms it to pixels and the renderer strokes it.
 *
 * Closed shapes repeat their first point at the end. That is load-bearing —
 * arc length has to measure the closing segment for a reveal to draw it.
 */

import { polarPoint } from "./num";
import type { Point, Polyline } from "./path/types";

/** A usable segment count: whole, at least 1; non-finite input falls back to 1 (no divide-by-zero NaN points). */
function wholeCount(n: number): number {
	return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

/**
 * Segment count for a curve of the given radius, at the given pixels-per-unit.
 * Aims for roughly one segment per 6 px of circumference, within 12 to 512.
 *
 * @param radius - Radius in scene units (sign ignored).
 * @param pixelsPerUnit - Scene-to-pixel scale. Defaults to 1.
 * @param quality - Multiplier on the count. Defaults to 1.
 * @returns A whole number of segments.
 *
 * @category Shapes
 */
export function segmentsForRadius(
	radius: number,
	pixelsPerUnit = 1,
	quality = 1,
): number {
	const circumference = 2 * Math.PI * Math.abs(radius) * pixelsPerUnit;
	return Math.min(512, Math.max(12, Math.ceil((circumference / 6) * quality)));
}

/**
 * Closed ellipse as a polyline, first point repeated at the end.
 *
 * @param cx - Centre x, scene units.
 * @param cy - Centre y, scene units.
 * @param rx - Radius along the (unrotated) x axis.
 * @param ry - Radius along the (unrotated) y axis.
 * @param segments - Number of segments. Defaults to 64.
 * @param rotation - Counter-clockwise rotation about the centre, in radians. Defaults to 0.
 * @returns `segments + 1` points.
 *
 * @category Shapes
 */
export function ellipsePolyline(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	segments = 64,
	rotation = 0,
): Polyline {
	segments = wholeCount(segments);
	const points: Polyline = new Array(segments + 1);
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	for (let i = 0; i <= segments; i++) {
		const theta = (i / segments) * Math.PI * 2;
		const x = rx * Math.cos(theta);
		const y = ry * Math.sin(theta);
		points[i] = { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
	}
	return points;
}

/**
 * Closed circle as a polyline, first point repeated at the end.
 *
 * @param cx - Centre x, scene units.
 * @param cy - Centre y, scene units.
 * @param r - Radius, scene units.
 * @param segments - Number of segments. Defaults to 64.
 * @returns `segments + 1` points.
 * @see {@link segmentsForRadius}
 *
 * @category Shapes
 */
export function circlePolyline(
	cx: number,
	cy: number,
	r: number,
	segments = 64,
): Polyline {
	return ellipsePolyline(cx, cy, r, r, segments);
}

/**
 * Partial circle from `startAngle` to `endAngle`, in radians (0 along +x,
 * increasing counter-clockwise in y-up scene space).
 *
 * @param cx - Centre x, scene units.
 * @param cy - Centre y, scene units.
 * @param r - Radius, scene units.
 * @param startAngle - Start angle in radians.
 * @param endAngle - End angle in radians; may be less than `startAngle` to sweep backwards.
 * @param segments - Number of segments. Defaults to 48.
 * @returns `segments + 1` points.
 *
 * @category Shapes
 */
export function arcPolyline(
	cx: number,
	cy: number,
	r: number,
	startAngle: number,
	endAngle: number,
	segments = 48,
): Polyline {
	segments = wholeCount(segments);
	const points: Polyline = new Array(segments + 1);
	for (let i = 0; i <= segments; i++) {
		const theta = startAngle + ((endAngle - startAngle) * i) / segments;
		points[i] = polarPoint(cx, cy, r, theta);
	}
	return points;
}

/**
 * A straight segment as a two-point polyline (the endpoints are copied).
 *
 * @param from - Start point.
 * @param to - End point.
 * @returns `[from, to]`.
 *
 * @category Shapes
 */
export function linePolyline(from: Point, to: Point): Polyline {
	return [{ ...from }, { ...to }];
}

/**
 * Axis-aligned rectangle, optionally with rounded corners. Closed: the first
 * point is repeated at the end.
 *
 * @param x - Left edge, scene units.
 * @param y - Bottom edge in y-up scene space (the `y` corner; `height` is added to it).
 * @param width - Width, scene units.
 * @param height - Height, scene units.
 * @param radius - Corner radius, clamped to half the shorter side. Defaults to 0 (sharp).
 * @param cornerSegments - Segments per rounded corner. Defaults to 8.
 * @returns The outline.
 *
 * @category Shapes
 */
export function rectPolyline(
	x: number,
	y: number,
	width: number,
	height: number,
	radius = 0,
	cornerSegments = 8,
): Polyline {
	const r = Math.min(
		Math.abs(radius),
		Math.abs(width) / 2,
		Math.abs(height) / 2,
	);
	if (r === 0 || Number.isNaN(r)) {
		return [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height },
			{ x, y },
		];
	}

	// Normalize a negative width/height so the rounded corners stay inside the box.
	const left = Math.min(x, x + width);
	const bottom = Math.min(y, y + height);
	const right = left + Math.abs(width);
	const top = bottom + Math.abs(height);
	cornerSegments = wholeCount(cornerSegments);
	const points: Polyline = [];
	const corners: [number, number, number][] = [
		[right - r, top - r, 0],
		[left + r, top - r, Math.PI / 2],
		[left + r, bottom + r, Math.PI],
		[right - r, bottom + r, (3 * Math.PI) / 2],
	];
	for (const [cx, cy, start] of corners) {
		for (let i = 0; i <= cornerSegments; i++) {
			const theta = start + (i / cornerSegments) * (Math.PI / 2);
			points.push(polarPoint(cx, cy, r, theta));
		}
	}
	points.push({ ...points[0] });
	return points;
}

/**
 * Regular n-gon inscribed in a circle. The default rotation puts the first
 * vertex at the top — scene space is y-up, so that's +π/2, not −π/2.
 * Closed: the first vertex is repeated at the end.
 *
 * @param cx - Centre x, scene units.
 * @param cy - Centre y, scene units.
 * @param r - Circumradius, scene units.
 * @param sides - Number of sides.
 * @param rotation - Angle of the first vertex in radians. Defaults to `Math.PI / 2`.
 * @returns `sides + 1` points.
 *
 * @example
 * ```ts
 * import { createScene, path } from "@sophistry/core";
 * import { regularPolygon } from "@sophistry/core/geometry";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 6 });
 * scene.add(path.create({ points: regularPolygon(0, 0, 2, 5) }));
 * ```
 *
 * @category Shapes
 */
export function regularPolygon(
	cx: number,
	cy: number,
	r: number,
	sides: number,
	rotation = Math.PI / 2,
): Polyline {
	sides = wholeCount(sides);
	const points: Polyline = [];
	for (let i = 0; i <= sides; i++) {
		const theta = rotation + (i / sides) * Math.PI * 2;
		points.push(polarPoint(cx, cy, r, theta));
	}
	return points;
}

/**
 * Two short strokes forming an arrowhead at `tip`, pointing away from `from`.
 * Kept as its own polyline so a reveal draws the head after the shaft, the way
 * you'd draw an arrow.
 *
 * @param from - A point on the shaft behind the tip; sets the direction.
 * @param tip - Where the point of the arrow sits.
 * @param length - Length of each stroke, scene units.
 * @param spread - Half-angle between the strokes and the shaft, in radians. Defaults to `Math.PI / 7`.
 * @returns A three-point open polyline: left barb, tip, right barb.
 *
 * @category Shapes
 */
export function arrowHead(
	from: Point,
	tip: Point,
	length: number,
	spread = Math.PI / 7,
): Polyline {
	return arrowHeadAt(
		tip,
		Math.atan2(tip.y - from.y, tip.x - from.x),
		length,
		spread,
	);
}

/**
 * `arrowHead` when you already know the bearing — curved shafts and the tip
 * vocabulary in `tips.ts` have a tangent, not a tail point. Both spellings run
 * through here so a `"vee"` tip is bit-identical to the original arrowhead.
 *
 * @param tip - Where the point of the arrow sits.
 * @param angle - Direction the arrow points, in radians (0 along +x).
 * @param length - Length of each stroke, scene units.
 * @param spread - Half-angle between the strokes and the shaft, in radians. Defaults to `Math.PI / 7`.
 * @returns A three-point open polyline: left barb, tip, right barb.
 *
 * @category Shapes
 */
export function arrowHeadAt(
	tip: Point,
	angle: number,
	length: number,
	spread = Math.PI / 7,
): Polyline {
	const left = angle + Math.PI - spread;
	const right = angle + Math.PI + spread;
	return [
		polarPoint(tip.x, tip.y, length, left),
		{ ...tip },
		polarPoint(tip.x, tip.y, length, right),
	];
}

/**
 * Samples a parametric curve into a polyline.
 *
 * `f` maps the parameter to a full point, so `y = g(x)` is
 * `(x) => ({ x, y: g(x) })`.
 *
 * @param f - Maps the parameter to a point in scene units.
 * @param from - Parameter at the first sample.
 * @param to - Parameter at the last sample.
 * @param samples - Number of intervals. Defaults to 128.
 * @returns `samples + 1` points.
 *
 * @example
 * ```ts
 * import { createScene, path } from "@sophistry/core";
 * import { plotPolyline } from "@sophistry/core/geometry";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * scene.add(path.create({ points: plotPolyline((x) => ({ x, y: Math.sin(x) }), -3, 3) }));
 * ```
 *
 * @category Shapes
 */
export function plotPolyline(
	f: (t: number) => Point,
	from: number,
	to: number,
	samples = 128,
): Polyline {
	samples = wholeCount(samples);
	const points: Polyline = new Array(samples + 1);
	for (let i = 0; i <= samples; i++)
		points[i] = f(from + ((to - from) * i) / samples);
	return points;
}
