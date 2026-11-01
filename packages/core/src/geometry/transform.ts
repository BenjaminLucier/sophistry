/**
 * 2D affine transforms, used to map scene units to device pixels and to
 * accumulate `<Group>` transforms down the scene tree.
 *
 * Points are baked into pixel space before they reach a theme, so themes can
 * jitter and hatch in pixels without knowing anything about the camera.
 */

import { lerp } from "./lerp.js";
import type { CurvePath, Point, Polyline } from "./path/types.js";

/**
 * Column-major affine matrix, matching the canvas `setTransform` argument order.
 *
 * @category Value types
 */
export interface Matrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

/**
 * The transform that leaves every point where it is.
 *
 * @category Transforms
 */
export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Combines two transforms: the result applies `inner` first, then `outer`
 * (i.e. `outer * inner`).
 *
 * @param outer - Applied second.
 * @param inner - Applied first.
 * @returns The combined matrix.
 *
 * @category Transforms
 */
export function compose(outer: Matrix, inner: Matrix): Matrix {
	return {
		a: outer.a * inner.a + outer.c * inner.b,
		b: outer.b * inner.a + outer.d * inner.b,
		c: outer.a * inner.c + outer.c * inner.d,
		d: outer.b * inner.c + outer.d * inner.d,
		e: outer.a * inner.e + outer.c * inner.f + outer.e,
		f: outer.b * inner.e + outer.d * inner.f + outer.f,
	};
}

/**
 * A pure translation.
 *
 * @param x - Shift along x.
 * @param y - Shift along y.
 *
 * @category Transforms
 */
export function translate(x: number, y: number): Matrix {
	return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

/**
 * A scale about the origin.
 *
 * @param sx - Factor along x.
 * @param sy - Factor along y. Defaults to `sx` (uniform).
 *
 * @category Transforms
 */
export function scale(sx: number, sy = sx): Matrix {
	return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/**
 * A rotation about the origin. Positive angles turn counter-clockwise in y-up
 * scene space.
 *
 * @param radians - Angle in radians.
 *
 * @category Transforms
 */
export function rotate(radians: number): Matrix {
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/**
 * Translate/rotate/scale around `origin`, applied in the usual TRS order.
 * This is what `<Group>` builds from its props.
 *
 * @param options - `x`/`y` translation (scene units), `rotation` (radians),
 *   `scaleX`/`scaleY` (`scaleY` defaults to `scaleX`, which defaults to 1), and
 *   the `origin` pivot (defaults to 0,0; also offsets the translation).
 * @returns The combined matrix.
 *
 * @category Transforms
 */
export function fromTranslationRotationScale(options: {
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	origin?: Point;
}): Matrix {
	const origin = options.origin ?? { x: 0, y: 0 };
	let m = translate((options.x ?? 0) + origin.x, (options.y ?? 0) + origin.y);
	if (options.rotation) m = compose(m, rotate(options.rotation));
	const sx = options.scaleX ?? 1;
	const sy = options.scaleY ?? options.scaleX ?? 1;
	if (sx !== 1 || sy !== 1) m = compose(m, scale(sx, sy));
	return compose(m, translate(-origin.x, -origin.y));
}

/**
 * A general linear map, written the way it is written on a blackboard.
 *
 * `rows` is row-major maths notation — `[[a, b], [c, d]]` is the map
 * `(x, y) ↦ (ax + by, cx + dy)`. `Matrix`'s own fields are column-major (they
 * are the canvas `setTransform` argument order), so authoring a 2×2 by hand
 * against them means transposing in your head at every call site; this is the
 * only place that transpose happens.
 *
 * Unlike `fromTranslationRotationScale` this can express a *shear*, which is the whole point: shear
 * is what a TRS chain cannot say, and half of what makes a 2×2 interesting.
 *
 * @param rows - The 2x2 matrix, row-major.
 * @returns A matrix with no translation.
 *
 * @example
 * ```ts
 * import { linearMap } from "@sophistry/core/geometry";
 *
 * const shear = linearMap([
 *   [1, 1],
 *   [0, 1],
 * ]);
 * ```
 *
 * @category Transforms
 */
export function linearMap(rows: [[number, number], [number, number]]): Matrix {
	const [[a, b], [c, d]] = rows;
	return { a, b: c, c: b, d, e: 0, f: 0 };
}

/**
 * The linear map sending `î = (1,0)` to `iHat` and `ĵ = (0,1)` to `jHat`.
 *
 * A matrix's columns *are* the images of the basis vectors, so this is the same
 * thing as `linearMap` said the other way round — and it is the way a lesson
 * usually says it, since the basis arrows are on screen.
 *
 * @param iHat - Image of (1, 0).
 * @param jHat - Image of (0, 1).
 *
 * @category Transforms
 */
export function fromColumns(iHat: Point, jHat: Point): Matrix {
	return { a: iHat.x, b: iHat.y, c: jHat.x, d: jHat.y, e: 0, f: 0 };
}

/**
 * Where the map sends the two basis vectors — the inverse of `fromColumns`.
 * Translation is ignored.
 *
 * @param m - The transform.
 *
 * @category Transforms
 */
export function columnsOf(m: Matrix): { iHat: Point; jHat: Point } {
	return { iHat: { x: m.a, y: m.b }, jHat: { x: m.c, y: m.d } };
}

/**
 * Signed area scale factor. Negative means the map flipped orientation, and
 * zero means it collapsed the plane onto a line — both worth saying out loud in
 * a lesson, and both things `invert` refuses to answer for.
 *
 * @param m - The transform.
 * @returns `a * d - b * c`.
 *
 * @category Transforms
 */
export function determinant(m: Matrix): number {
	return m.a * m.d - m.b * m.c;
}

/**
 * Re-centres a transform on `origin`, so that point is left fixed.
 *
 * A linear map fixes the origin by definition; a scene's interesting point
 * often isn't there. This conjugates by a translation, which is what `fromTranslationRotationScale`
 * does with its own `origin` — same idea, arbitrary matrix.
 *
 * @param m - The transform to re-centre.
 * @param origin - The point to keep fixed, scene units.
 * @returns A new matrix.
 *
 * @category Transforms
 */
export function about(m: Matrix, origin: Point): Matrix {
	return compose(
		compose(translate(origin.x, origin.y), m),
		translate(-origin.x, -origin.y),
	);
}

/**
 * Component-wise blend between two transforms.
 *
 * For *linear* maps this is exact rather than an approximation, and that is
 * worth being precise about: `((1-t)A + tB)·p ≡ (1-t)(A·p) + t(B·p)`, so
 * interpolating the matrix and interpolating every transformed point are the
 * same operation. A grid tweened this way is not a sampled approximation of the
 * warp — it is the warp, at every frame, and straight lines stay exactly
 * straight. (Manim's `ApplyMatrix` lerps the points; this lerps the matrix; the
 * results are identical.)
 *
 * The known artefact is inherited, not introduced: blending towards a rotation
 * of more than a right angle passes through a lower determinant than either
 * end, so a half-turn visibly squashes the plane flat on its way round. That is
 * a property of the straight line between two matrices, and the fix is to route
 * the animation through an explicit intermediate, not to change the blend.
 *
 * This is the canonical implementation — `geometry/` is a leaf (see
 * `geometry/lerp.ts`'s module doc for why `lerp`/`lerpPoint`/`lerpPoint3` live
 * here rather than in `tween/`), and a `Matrix`'s own lerp belongs beside its
 * type for the same reason. `tween/interpolators.ts`'s `matrixInterpolator`
 * is a thin `Interpolator<Matrix>`-shaped wrapper around this one function,
 * not a second implementation.
 *
 * @param from - Matrix at `t = 0`.
 * @param to - Matrix at `t = 1`.
 * @param t - Blend factor, usually 0..1 (not clamped).
 *
 * @category Transforms
 */
export function lerpMatrix(from: Matrix, to: Matrix, t: number): Matrix {
	return {
		a: lerp(from.a, to.a, t),
		b: lerp(from.b, to.b, t),
		c: lerp(from.c, to.c, t),
		d: lerp(from.d, to.d, t),
		e: lerp(from.e, to.e, t),
		f: lerp(from.f, to.f, t),
	};
}

/**
 * The inverse transform, or the identity for a degenerate one.
 *
 * A singular matrix means the space has been collapsed to a line or a point,
 * and there is no honest answer to "where did this pixel come from"; answering
 * with the identity keeps a camera whose viewport briefly has zero width from
 * poisoning the whole paint pass with `NaN`s.
 *
 * @param m - The transform to invert.
 * @returns The inverse, or a fresh identity matrix if `m` is singular.
 *
 * @category Transforms
 */
export function invert(m: Matrix): Matrix {
	const det = m.a * m.d - m.b * m.c;
	// A fresh copy: callers may mutate the result, and must not corrupt the shared IDENTITY.
	if (det === 0 || !Number.isFinite(det)) return { ...IDENTITY };
	return {
		a: m.d / det,
		b: -m.b / det,
		c: -m.c / det,
		d: m.a / det,
		e: (m.c * m.f - m.d * m.e) / det,
		f: (m.b * m.e - m.a * m.f) / det,
	};
}

/**
 * Maps a point through a transform.
 *
 * @param m - The transform.
 * @param p - The point.
 * @returns A new point.
 *
 * @category Transforms
 */
export function applyToPoint(m: Matrix, p: Point): Point {
	return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/**
 * Maps every point of a polyline through a transform.
 *
 * @param m - The transform.
 * @param points - The polyline.
 * @returns A new polyline of the same length.
 *
 * @category Transforms
 */
export function applyToPolyline(m: Matrix, points: Polyline): Polyline {
	return points.map((p) => applyToPoint(m, p));
}

/**
 * `applyToPolyline`'s counterpart for a `CurvePath` — every anchor and
 * control point (`start`, and each segment's `to`/`c1`/`c2`) mapped through
 * `m`. A control point is not on the curve, but it is still a point in the
 * same space as everything else the shape is built from, so it takes the
 * same transform as an on-curve vertex would.
 */
export function applyToCurvePath(m: Matrix, path: CurvePath): CurvePath {
	return {
		start: applyToPoint(m, path.start),
		segments: path.segments.map((segment) => ({
			c1: applyToPoint(m, segment.c1),
			c2: applyToPoint(m, segment.c2),
			to: applyToPoint(m, segment.to),
		})),
		closed: path.closed,
	};
}

/**
 * Average absolute scale factor of a matrix. Stroke widths are authored in
 * scene units, so the renderer multiplies them by this to get pixels.
 *
 * @param m - The transform.
 * @returns The mean of the lengths of the two transformed basis vectors.
 *
 * @category Transforms
 */
export function scaleFactorOf(m: Matrix): number {
	const sx = Math.hypot(m.a, m.b);
	const sy = Math.hypot(m.c, m.d);
	return (sx + sy) / 2;
}
