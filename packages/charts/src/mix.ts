/**
 * Blends a keyed transition draws between its two ends — colours, paints,
 * boxes, point lists — and the text colour that reads on a fill. Internal to
 * the charts. Colour work is cached per colour (and per pair), since marks
 * call these per datum per frame.
 */

import type { Color } from "@sophistry/core/color";
import {
	colorInterpolator,
	parseColor,
	rgbToOklch,
	toCss,
} from "@sophistry/core/color";
import type { Bounds, Point } from "@sophistry/core/geometry";
import { mix, mixPoint } from "./util.js";

/** Above this many entries a cache is cleared rather than grown (a chart has few colours; a stream of computed ones must not leak). */
const CACHE_LIMIT = 512;

/** `colorInterpolator(a, b, oklch)` per pair, built once. */
const lerps = new Map<string, (t: number) => Color>();

/** Two CSS colours blended at `t` in OKLCH, exact at 0 and 1, memoised per pair. */
export function blendCss(a: string, b: string, t: number): string {
	if (a === b || t <= 0) return a;
	if (t >= 1) return b;
	const pair = `${a}\u0000${b}`;
	let lerp = lerps.get(pair);
	if (!lerp) {
		if (lerps.size >= CACHE_LIMIT) lerps.clear();
		lerp = colorInterpolator(a, b, { colorSpace: "oklch" });
		lerps.set(pair, lerp);
	}
	return toCss(lerp(t));
}

/** Two boxes blended at `t`, edge by edge: `a` at 0, `b` at 1. */
export function mixBounds(a: Bounds, b: Bounds, t: number): Bounds {
	if (t <= 0) return a;
	if (t >= 1) return b;
	return {
		minX: mix(a.minX, b.minX, t),
		minY: mix(a.minY, b.minY, t),
		maxX: mix(a.maxX, b.maxX, t),
		maxY: mix(a.maxY, b.maxY, t),
	};
}

/**
 * Two point lists blended at `t`, point by point: `a` at 0, `b` at 1. Lists
 * of different lengths can't blend point by point: the nearer one is
 * returned whole.
 */
export function mixPoints<P extends readonly Point[]>(
	a: P,
	b: P,
	t: number,
): P {
	if (t <= 0) return a;
	if (t >= 1) return b;
	if (a.length !== b.length) return t < 0.5 ? a : b;
	return a.map((p, i) => mixPoint(p, b[i], t)) as unknown as P;
}
/**
 * A paint blended at `t`: colours in OKLCH ({@link blendCss}); paints that
 * are not colours (gradients) switch at the midpoint.
 */
export function mixPaint<P>(a: P, b: P, t: number): P {
	if (typeof a === "string" && typeof b === "string")
		return blendCss(a, b, t) as P;
	return t < 0.5 ? a : b;
}

/** OKLCH lightness per colour, parsed once. */
const lightness = new Map<string, number>();

function lightnessOf(color: string): number {
	let l = lightness.get(color);
	if (l === undefined) {
		if (lightness.size >= CACHE_LIMIT) lightness.clear();
		l = rgbToOklch(parseColor(color)).l;
		lightness.set(color, l);
	}
	return l;
}

/** Whichever of `dark` and `light` reads better on `fill`, by OKLCH lightness, for numbers written on coloured cells. */
export function readableOn(fill: string, dark: string, light: string): string {
	const background = lightnessOf(fill);
	return Math.abs(background - lightnessOf(dark)) >=
		Math.abs(background - lightnessOf(light))
		? dark
		: light;
}
