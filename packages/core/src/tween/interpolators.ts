/**
 * The interpolator registry (`resolveInterpolator`): what "halfway between"
 * means for numbers, points, colours, matrices, polylines and curve paths, as a
 * `Name | Function` resolved like easings. `tween()`'s `auto` and the move verbs
 * share it.
 *
 * Interpolation is not correspondence: entries assume their inputs already line
 * up (`Correspondence` in `geometry/morph.ts` does the matching), and the
 * polyline and curve interpolators throw on mismatched inputs rather than
 * truncate.
 *
 * Every entry accepts progress outside 0..1, because springs and curves such
 * as `"backOut"` overshoot. Numbers, points, matrices, polylines and curve
 * paths extrapolate linearly (a curve path's `closed` snaps to the nearer
 * end). Colours clamp instead: channels to 0..255 and alpha to 0..1, at
 * `toCss` for {@link cssColorInterpolator} and in d3-color's formatter for
 * colour strings that reach `auto`'s structural fallback, so an overshooting
 * colour is always a valid CSS colour, never a `NaN` or negative channel.
 */

import { interpolate as d3Interpolate } from "d3-interpolate";
import type { ColorSpace } from "../color";
import { colorInterpolator, toCss } from "../color";
import type { CurvePath, Point, Polyline } from "../geometry";
import { lerpCurvePath, lerpPolyline } from "../geometry/lerp";
import { createResolver } from "../geometry/resolver";
import type { Matrix } from "../geometry/transform";
import { lerpMatrix } from "../geometry/transform";
import type { Point3 } from "../geometry3d/mat";
import type { Interpolator } from "./interpolate";
import { lerp, lerpPoint, lerpPoint3 } from "./interpolate";

/** Linear between two numbers. */
const numberInterpolator: Interpolator<number> = (a, b) => (t) => lerp(a, b, t);

/**
 * Names of the built-in interpolators in {@link interpolators}.
 *
 * @category Tracks & clocks
 */
export type InterpolatorName =
	| "number"
	| "point"
	| "point3"
	| "color"
	| "matrix"
	| "polyline"
	| "curvePath";

/**
 * Lerps a `Point` — `x`/`y` independently, same as `lerpPoint`.
 *
 * @category Interpolators
 */
export const pointInterpolator: Interpolator<Point> = (a, b) => (t) =>
	lerpPoint(a, b, t);

/**
 * Lerps a `Point3` — `x`/`y`/`z` independently, same as `lerpPoint3`.
 *
 * @category Interpolators
 */
export const point3Interpolator: Interpolator<Point3> = (a, b) => (t) =>
	lerpPoint3(a, b, t);

/**
 * Lerps a `Matrix` component-wise — the straight line between two affine
 * transforms, not a decomposed rotate/scale/translate blend. Thin wrapper
 * around `geometry/transform.ts`'s `lerpMatrix`, the canonical
 * implementation (`lerp`/`lerpPoint`/`lerpPoint3` live in `geometry/` for the
 * same reason — see `geometry/lerp.ts`'s module doc — and `geometry/
 * transform.ts` is where a `Matrix` itself is defined, so its own lerp
 * belongs beside it rather than reimplemented here); this file just gives it
 * the `Interpolator<Matrix>` shape the registry below expects. See
 * `lerpMatrix`'s own doc for the well-known artefact that comes with a
 * component-wise blend: blending through more than a right-angle rotation
 * visibly squashes the plane flat at the midpoint. That is a property of the
 * straight line between two matrices, not a bug in either function.
 *
 * @category Interpolators
 */
export const matrixInterpolator: Interpolator<Matrix> = (from, to) => (t) =>
	lerpMatrix(from, to, t);

/**
 * Lerps two *already-matched* polylines vertex-for-vertex; throws when the
 * vertex counts differ. The body is `geometry/lerp.ts`'s `lerpPolyline`, so
 * `geometry/morph.ts` shares it without importing up into `tween/`.
 *
 * @category Interpolators
 */
export const polylineInterpolator: Interpolator<Polyline> = lerpPolyline;

/**
 * Lerps two *already-matched* `CurvePath`s control-point-for-control-point;
 * throws when the segment counts differ. The body is `geometry/lerp.ts`'s
 * `lerpCurvePath` (see there for how `closed` snaps).
 *
 * @category Interpolators
 */
export const curvePathInterpolator: Interpolator<CurvePath> = lerpCurvePath;

/**
 * Builds a CSS-string interpolator over `color/`'s `colorInterpolator`,
 * for a given colour space. `"rgb"` is the default; `"oklch"` is the
 * perceptually-uniform space worth reaching for deliberately — see
 * `color/convert.ts`'s module doc for why a blue→yellow ramp through RGB
 * dips through a muddy grey-brown at its midpoint and OKLCH doesn't.
 *
 * Progress outside 0..1 extrapolates in the chosen space and the result is
 * clamped to a displayable colour (channels 0..255, alpha 0..1), so a spring
 * overshooting through a colour stays valid CSS.
 *
 * Not auto-detected from bare strings by `detectInterpolator`/`auto` below —
 * see that function's doc for why guessing "this string is a colour" from
 * shape alone is the wrong default.
 *
 * @category Interpolators
 */
export function cssColorInterpolator(
	colorSpace: ColorSpace = "rgb",
): Interpolator<string> {
	// Endpoints are parsed/converted once per (a, b), when the sampler is built
	// — not once per frame, which is what calling `mixColor` here would do.
	return (a, b) => {
		const lerp = colorInterpolator(a, b, { colorSpace });
		return (t) => toCss(lerp(t));
	};
}

/**
 * The frozen map of built-in interpolators `resolveInterpolator` looks names up in. Custom ones are passed as functions.
 *
 * @category Tracks & clocks
 */
export const interpolators: Readonly<{
	number: Interpolator<number>;
	point: Interpolator<Point>;
	point3: Interpolator<Point3>;
	color: Interpolator<string>;
	matrix: Interpolator<Matrix>;
	polyline: Interpolator<Polyline>;
	curvePath: Interpolator<CurvePath>;
}> = Object.freeze({
	number: numberInterpolator,
	point: pointInterpolator,
	point3: point3Interpolator,
	color: cssColorInterpolator(),
	matrix: matrixInterpolator,
	polyline: polylineInterpolator,
	curvePath: curvePathInterpolator,
});

const interpolatorResolver = createResolver<Interpolator<unknown>>(
	"interpolator",
	interpolators as unknown as Record<string, Interpolator<unknown>>,
);

/**
 * A name is sugar for a function — `resolveEasing`, for interpolators.
 * Returns `undefined` for `undefined` input rather than a fallback, because
 * the caller (`tween()`, `driveTrack`) already has its own fallback (`auto`)
 * and a fixed default here would just be a second, shadowing one.
 *
 * @category Interpolators
 */
export function resolveInterpolator<T>(
	spec: Interpolator<T> | InterpolatorName | undefined,
): Interpolator<T> | undefined {
	if (spec === undefined) return undefined;
	return interpolatorResolver.resolve(
		spec as Interpolator<unknown> | string,
	) as unknown as Interpolator<T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNum(value: unknown): value is number {
	return typeof value === "number";
}

function isPoint3(value: unknown): value is Point3 {
	return (
		isPlainObject(value) && isNum(value.x) && isNum(value.y) && isNum(value.z)
	);
}

function isPoint(value: unknown): value is Point {
	return (
		isPlainObject(value) && isNum(value.x) && isNum(value.y) && !("z" in value)
	);
}

function isMatrix(value: unknown): value is Matrix {
	return (
		isPlainObject(value) &&
		isNum(value.a) &&
		isNum(value.b) &&
		isNum(value.c) &&
		isNum(value.d) &&
		isNum(value.e) &&
		isNum(value.f)
	);
}

function isCurvePath(value: unknown): value is CurvePath {
	return (
		isPlainObject(value) &&
		isPlainObject(value.start) &&
		Array.isArray(value.segments) &&
		typeof value.closed === "boolean"
	);
}

function isPolyline(value: unknown): value is Polyline {
	return (
		Array.isArray(value) &&
		value.every((p) => isPlainObject(p) && isNum(p.x) && isNum(p.y))
	);
}

/**
 * Shape-detects `a`/`b` and returns the matching registry interpolator, or
 * `undefined` if nothing fits — the "first" half of `auto`'s two-stage
 * dispatch (registry, then d3's structural fallback).
 *
 * Deliberately does **not** try to detect colour strings. Every CSS colour
 * is also just a string, and every arbitrary string that happens to parse
 * (`d3-color` is lenient) is not a colour a caller meant to blend through a
 * particular space — routing every string through `cssColorInterpolator`'s
 * `rgba(...)` output would also silently change the format `auto`
 * have always produced for the plain hex/`rgb()` case (d3's own colour
 * detection, not this registry's). Colour space is a deliberate choice, not
 * a shape to be inferred — pick it explicitly via `colorTo`'s `colorSpace` option
 * or `resolveInterpolator("color")`.
 *
 * @category Interpolators
 */
export function detectInterpolator<T>(a: T, b: T): Interpolator<T> | undefined {
	if (typeof a === "number" && typeof b === "number") {
		return numberInterpolator as unknown as Interpolator<T>;
	}
	if (isPoint3(a) && isPoint3(b)) {
		return point3Interpolator as unknown as Interpolator<T>;
	}
	if (isMatrix(a) && isMatrix(b)) {
		return matrixInterpolator as unknown as Interpolator<T>;
	}
	if (isCurvePath(a) && isCurvePath(b)) {
		return curvePathInterpolator as unknown as Interpolator<T>;
	}
	if (isPoint(a) && isPoint(b)) {
		return pointInterpolator as unknown as Interpolator<T>;
	}
	if (isPolyline(a) && isPolyline(b)) {
		return polylineInterpolator as unknown as Interpolator<T>;
	}
	return undefined;
}

/**
 * d3's structural interpolator — numbers, colours, arrays, objects. The
 * fallback `auto` reaches for once the registry above has nothing to offer.
 *
 * d3-interpolate's own object/array interpolators build their result once and
 * mutate the same object or array on every sample, returning that one
 * reference each call — a reasonable allocation trade for d3's own
 * consumers, which mostly just read the fields back out. It is a landmine
 * for anything reactive: a `Track`'s signal notifies on reference
 * inequality, so a value driven straight through d3's interpolator writes a
 * *new* value on the very first sample (distinct from whatever the track
 * held before) and then the *same* object, mutated in place, on every sample
 * after — indistinguishable from a no-op write to `Object.is`, so the signal
 * fires once and the value appears to freeze. Wrapping the sampler to
 * shallow-copy an object/array result before returning it keeps d3's actual
 * interpolation math untouched while giving every frame the fresh reference
 * reactivity requires.
 */
function structuralInterpolator<T>(a: T, b: T): (t: number) => T {
	// d3's overloads are written per input kind; ours is deliberately generic.
	const structural = d3Interpolate as (
		a: unknown,
		b: unknown,
	) => (t: number) => unknown;
	const sample = structural(a, b);
	return ((t: number) => {
		const value = sample(t);
		if (Array.isArray(value)) return [...value];
		if (value !== null && typeof value === "object") return { ...value };
		return value;
	}) as (t: number) => T;
}

/**
 * `tween()`'s default interpolator: dispatches through the registry first
 * (a `Point` gets `lerpPoint`, a `Matrix` gets a real affine blend, and so
 * on), and falls back to d3's structural interpolator — still with the
 * shallow-copy fix above — for anything the registry doesn't recognise
 * (plain numeric arrays, ad hoc objects, colour strings).
 *
 * @category Tracks & clocks
 */
export function auto<T>(a: T, b: T): (t: number) => T {
	const detected = detectInterpolator(a, b);
	if (detected) return detected(a, b);
	return structuralInterpolator(a, b);
}
