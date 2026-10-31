/**
 * `lerp`, `clamp`, `remap`, `lerpPoint`, `lerpPoint3`: the canonical
 * interpolation primitives. They live in `geometry/`, a leaf layer, so every
 * other layer can import them; `tween/interpolate.ts` re-exports them.
 * `lerpPoint3` imports only the `Point3` type from `geometry3d/`.
 */

import type { Point3 } from "../geometry3d/mat";
import type { CurvePath, Point, Polyline } from "./path/types";

/**
 * Linear interpolation: `t` of the way from `a` to `b`. The one formula
 * everything below reduces to. `t` is not clamped, so values outside 0..1
 * extrapolate.
 *
 * @param a - Value at `t = 0`.
 * @param b - Value at `t = 1`.
 * @param t - Blend factor, usually 0..1.
 * @returns `a + (b - a) * t`; exactly `b` at `t = 1`.
 *
 * @example
 * ```ts
 * import { lerp } from "@sophistry/core/geometry";
 *
 * const halfway = lerp(10, 20, 0.5); // 15
 * ```
 *
 * @category Interpolation
 */
export function lerp(a: number, b: number, t: number): number {
	// `a + (b - a) * 1` can miss `b` by rounding (e.g. a = 1e16, b = 1); pin the endpoint.
	return t === 1 ? b : a + (b - a) * t;
}

/**
 * `x`/`y` independently. This is *the* `Point` lerp for the package — the
 * straight-line interpolation a bezier control point, a vertex morph and a
 * dragged-point animation all want, and the one `tween/interpolators.ts`'s
 * `pointInterpolator` is built from.
 *
 * @param a - Point at `t = 0`.
 * @param b - Point at `t = 1`.
 * @param t - Blend factor, usually 0..1 (not clamped).
 * @returns A new point.
 *
 * @category Interpolation
 */
export function lerpPoint(a: Point, b: Point, t: number): Point {
	return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/**
 * `x`/`y`/`z` independently — `lerpPoint`'s 3D counterpart, for `scene3d/`.
 *
 * @param a - Point at `t = 0`.
 * @param b - Point at `t = 1`.
 * @param t - Blend factor, usually 0..1 (not clamped).
 * @returns A new point.
 *
 * @category Interpolation
 */
export function lerpPoint3(a: Point3, b: Point3, t: number): Point3 {
	return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/**
 * Restricts `value` to `[min, max]`. Defaults to the unit interval, since
 * that is what a `t` parameter or a normalized progress value almost always
 * wants clamped to.
 *
 * @param value - The number to restrict.
 * @param min - Lower bound. Defaults to 0.
 * @param max - Upper bound. Defaults to 1.
 * @returns `value`, or the nearest bound if it falls outside.
 *
 * @category Interpolation
 */
export function clamp(value: number, min = 0, max = 1): number {
	return value < min ? min : value > max ? max : value;
}

/**
 * Maps `value` from `[fromLow, fromHigh]` onto `[toLow, toHigh]`, without
 * clamping — a value outside the source range lands outside the destination
 * one too, which is the right default for "extrapolate this axis" and wrong
 * for "clamp this progress"; compose with `clamp` when the latter is meant.
 * A degenerate source span (`fromLow === fromHigh`) answers `toLow` rather
 * than dividing by zero.
 *
 * @param value - The number to map.
 * @param fromLow - Source range start.
 * @param fromHigh - Source range end.
 * @param toLow - Destination range start.
 * @param toHigh - Destination range end.
 * @returns The mapped number.
 *
 * @example
 * ```ts
 * import { remap } from "@sophistry/core/geometry";
 *
 * const y = remap(5, 0, 10, -1, 1); // 0
 * ```
 *
 * @category Interpolation
 */
export function remap(
	value: number,
	fromLow: number,
	fromHigh: number,
	toLow: number,
	toHigh: number,
): number {
	const span = fromHigh - fromLow;
	if (span === 0) return toLow;
	return toLow + ((value - fromLow) / span) * (toHigh - toLow);
}

/**
 * How far `value` is through `[start, end]`, clamped to 0..1: 0 at or before
 * `start`, 1 at or after `end`. The inverse of `lerp` over a window, and the
 * one piece of arithmetic behind every "this part runs over that slice of the
 * timeline": Manim's `squish_rate_func` (see `squish` in `tween/easing.ts`),
 * a staggered reveal, a phase of a multi-part draw. A degenerate window
 * (`start === end`), or a reversed one, is a step to 1 at `start` rather than
 * a division by zero or a curve that runs backwards. `NaN` reads as 0.
 *
 * @param value - Progress to locate, usually 0..1.
 * @param start - Where the window opens.
 * @param end - Where it closes.
 * @returns Progress through the window, 0..1.
 *
 * @example
 * ```ts
 * import { progressIn } from "@sophistry/core/geometry";
 *
 * progressIn(0.5, 0.4, 0.6); // 0.5
 * progressIn(0.2, 0.4, 0.6); // 0
 * ```
 *
 * @category Interpolation
 */
export function progressIn(value: number, start: number, end: number): number {
	if (!(value > start)) return value === start && end <= start ? 1 : 0;
	if (value >= end) return 1;
	return (value - start) / (end - start);
}

/**
 * How a point travels from `from` to `to` as `t` runs 0..1: Manim's
 * `path_func`. {@link lerpPoint} is the straight one; {@link pathAlongArc}
 * builds the curved ones.
 *
 * @category Interpolation
 */
export type PointPath = (from: Point, to: Point, t: number) => Point;

/** Below this many radians an arc is a straight line: Manim's `STRAIGHT_PATH_THRESHOLD`. */
const STRAIGHT_ARC = 0.01;

/**
 * A path that carries each point along a circular arc to its destination,
 * turning through `angle` radians on the way: Manim's `path_along_arc`.
 * Positive turns counter-clockwise (y up), so `Math.PI` is Manim's
 * `counterclockwise_path` (a half circle) and `-Math.PI` its
 * `clockwise_path`. Every point of a shape turns through the same angle about
 * its own centre, so a whole shape swings round as one. Near zero (below
 * 0.01 rad) it is the straight path.
 *
 * @param angle - Radians turned between the start and the end.
 * @returns A {@link PointPath}.
 *
 * @example
 * ```ts
 * import { pathAlongArc } from "@sophistry/core/geometry";
 *
 * const halfTurn = pathAlongArc(Math.PI);
 * halfTurn({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.5); // { x: 0, y: -1 }
 * ```
 *
 * @category Interpolation
 */
export function pathAlongArc(angle: number): PointPath {
	if (!(Math.abs(angle) >= STRAIGHT_ARC))
		return (from, to, t) => ({
			x: from.x + (to.x - from.x) * t,
			y: from.y + (to.y - from.y) * t,
		});
	// The centre sits on the chord's perpendicular bisector, far enough out
	// that the chord subtends `angle`; at a half turn, on the chord itself.
	const lift =
		Math.abs(Math.abs(angle) - Math.PI) < 1e-12 ? 0 : 1 / Math.tan(angle / 2);
	return (from, to, t) => {
		const hx = (to.x - from.x) / 2;
		const hy = (to.y - from.y) / 2;
		const cx = from.x + hx - hy * lift;
		const cy = from.y + hy + hx * lift;
		const turn = angle * t;
		const cos = Math.cos(turn);
		const sin = Math.sin(turn);
		const dx = from.x - cx;
		const dy = from.y - cy;
		return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
	};
}

/**
 * Lerps two *already-matched* polylines vertex-for-vertex. Deliberately
 * strict: differing vertex counts mean nobody has decided correspondence
 * yet, and index-pairing mismatched lists would silently produce nonsense
 * (or, worse, a plausible-looking wrong shape) rather than fail loudly.
 * Build a correspondence first — `geometry/morph.ts`'s `resampleCorrespondence`
 * (rotation-aligned resampling to a common vertex count) or a custom
 * `Correspondence<Polyline>` — then lerp the result through this.
 *
 * @category Interpolation
 */
export function lerpPolyline(
	a: Polyline,
	b: Polyline,
): (t: number) => Polyline {
	if (a.length !== b.length) {
		throw new Error(
			`polylineInterpolator: vertex counts differ (${a.length} vs ${b.length}). ` +
				"This interpolator lerps matched vertices; it does not resample or " +
				"solve correspondence. Use geometry/morph.ts's resampleCorrespondence " +
				"(or morphPolylines, which already composes the two) for polylines " +
				"with different vertex counts.",
		);
	}
	return (t) => a.map((p, i) => lerpPoint(p, b[i], t));
}

/**
 * Lerps two *already-matched* `CurvePath`s control-point-for-control-point —
 * every intermediate frame stays an exact bezier. Strict about segment count
 * for the same reason `lerpPolyline` is strict about vertex count:
 * `geometry/morph.ts`'s `morphCurvePaths` is the caller that first grows the
 * shorter side to match (`promoteToSegmentCount`, bisecting its longest
 * segment) and then reaches for this.
 *
 * `closed` is not blended (there is no halfway between "closed" and "open");
 * it snaps to whichever endpoint `t` is closer to, matching `morphPolylines`
 * taking one `closed` flag rather than resolving one per side.
 *
 * @category Interpolation
 */
export function lerpCurvePath(
	a: CurvePath,
	b: CurvePath,
): (t: number) => CurvePath {
	if (a.segments.length !== b.segments.length) {
		throw new Error(
			`curvePathInterpolator: segment counts differ (${a.segments.length} vs ${b.segments.length}). ` +
				"Grow the shorter side to match first — see geometry/morph.ts's " +
				"promoteToSegmentCount/morphCurvePaths.",
		);
	}
	return (t) => ({
		start: lerpPoint(a.start, b.start, t),
		segments: a.segments.map((seg, i) => {
			const other = b.segments[i];
			return {
				c1: lerpPoint(seg.c1, other.c1, t),
				c2: lerpPoint(seg.c2, other.c2, t),
				to: lerpPoint(seg.to, other.to, t),
			};
		}),
		closed: t < 1 ? a.closed : b.closed,
	});
}
