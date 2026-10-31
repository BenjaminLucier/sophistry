/**
 * Colour-space conversions (HSL, HSV, OKLCH) and the interpolation built on
 * them. OKLCH (Ottosson, 2020) is perceptually uniform: an RGB blend between
 * saturated colours dips through grey, an OKLCH one keeps lightness and chroma.
 * `rgb` stays the default colour space for interpolation.
 */

import { parseColor } from "./parse";
import type { Color, ColorInput, ColorSpace } from "./types";

/**
 * Hue, saturation, lightness.
 *
 * @category Conversion
 */
export interface Hsl {
	/** Hue in degrees, 0..360. */
	h: number;
	/** Saturation, 0..1. */
	s: number;
	/** Lightness, 0..1. */
	l: number;
	/** Alpha, 0..1. */
	a: number;
}

/**
 * Hue, saturation, value (brightness).
 *
 * @category Conversion
 */
export interface Hsv {
	/** Hue in degrees, 0..360. */
	h: number;
	/** Saturation, 0..1. */
	s: number;
	/** Value (the max channel), 0..1. */
	v: number;
	/** Alpha, 0..1. */
	a: number;
}

/** OKLCH: perceptual lightness, chroma, and hue. `l` is 0..1, `c` is
 * typically 0..~0.4 (unbounded — see the module doc on overshoot), `h` is
 * degrees.
 *
 * @category Conversion
 */
export interface Oklch {
	/** Perceptual lightness, 0..1. */
	l: number;
	/** Chroma (colourfulness); typically 0..~0.4. */
	c: number;
	/** Hue in degrees, 0..360. */
	h: number;
	/** Alpha, 0..1. */
	a: number;
}

function hueToRgbChannel(p: number, q: number, t: number): number {
	let tt = t;
	if (tt < 0) tt += 1;
	if (tt > 1) tt -= 1;
	if (tt < 1 / 6) return p + (q - p) * 6 * tt;
	if (tt < 1 / 2) return q;
	if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
	return p;
}

/** `Color` → HSL. Channels normalised to 0..1 (0..360 for hue) first, since
 * that is the space the cylindrical formulas are defined in.
 *
 * @param color - Source colour.
 * @returns Hue in degrees, saturation and lightness in 0..1; hue is 0 for greys.
 *
 * @category Conversion
 */
export function rgbToHsl(color: Color): Hsl {
	const r = color.r / 255;
	const g = color.g / 255;
	const b = color.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;

	if (max === min) return { h: 0, s: 0, l, a: color.a };

	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	switch (max) {
		case r:
			h = (g - b) / d + (g < b ? 6 : 0);
			break;
		case g:
			h = (b - r) / d + 2;
			break;
		default:
			h = (r - g) / d + 4;
	}
	return { h: h * 60, s, l, a: color.a };
}

/**
 * HSL → `Color`.
 *
 * @param hsl - Hue in degrees (wrapped), saturation and lightness in 0..1.
 * @returns RGB channels 0..255.
 *
 * @category Conversion
 */
export function hslToRgb(hsl: Hsl): Color {
	const h = (((hsl.h % 360) + 360) % 360) / 360;
	const { s, l } = hsl;
	if (s === 0) {
		const v = l * 255;
		return { r: v, g: v, b: v, a: hsl.a };
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return {
		r: hueToRgbChannel(p, q, h + 1 / 3) * 255,
		g: hueToRgbChannel(p, q, h) * 255,
		b: hueToRgbChannel(p, q, h - 1 / 3) * 255,
		a: hsl.a,
	};
}

/** `Color` → HSV. Distinct from HSL — `v` is the max channel, not the
 * midpoint of max/min — which is why `shadeColor`-style "scale the
 * brightness" reasoning is closer to HSV's `v` than to HSL's `l`.
 *
 * @param color - Source colour.
 * @returns Hue in degrees, saturation and value in 0..1; hue is 0 for greys.
 *
 * @category Conversion
 */
export function rgbToHsv(color: Color): Hsv {
	const r = color.r / 255;
	const g = color.g / 255;
	const b = color.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	const v = max;
	const s = max === 0 ? 0 : d / max;

	if (d === 0) return { h: 0, s, v, a: color.a };
	let h: number;
	switch (max) {
		case r:
			h = (g - b) / d + (g < b ? 6 : 0);
			break;
		case g:
			h = (b - r) / d + 2;
			break;
		default:
			h = (r - g) / d + 4;
	}
	return { h: h * 60, s, v, a: color.a };
}

/**
 * HSV → `Color`.
 *
 * @param hsv - Hue in degrees (wrapped), saturation and value in 0..1.
 * @returns RGB channels 0..255.
 *
 * @category Conversion
 */
export function hsvToRgb(hsv: Hsv): Color {
	const h = (((hsv.h % 360) + 360) % 360) / 60;
	const { s, v } = hsv;
	const c = v * s;
	const x = c * (1 - Math.abs((h % 2) - 1));
	const m = v - c;
	let r: number;
	let g: number;
	let b: number;
	if (h < 1) [r, g, b] = [c, x, 0];
	else if (h < 2) [r, g, b] = [x, c, 0];
	else if (h < 3) [r, g, b] = [0, c, x];
	else if (h < 4) [r, g, b] = [0, x, c];
	else if (h < 5) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: hsv.a };
}

// --- OKLCH -------------------------------------------------------------
//
// sRGB (gamma) → linear sRGB → LMS → OKLab → OKLCH, and back. The matrices
// are Ottosson's published constants; see the module doc for the source.
// This package deliberately implements them rather than pulling in a colour
// library, since it is ~30 lines of matrix multiplication and the point of
// `src/color/` is to *be* that one dependency for the rest of the package.

function srgbToLinear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
	const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
	return c * 255;
}

/**
 * `Color` → OKLCH.
 *
 * @param color - Source sRGB colour.
 * @returns Lightness 0..1, chroma, and hue in degrees; hue is 0 for greys.
 *
 * @category Conversion
 */
export function rgbToOklch(color: Color): Oklch {
	const r = srgbToLinear(color.r);
	const g = srgbToLinear(color.g);
	const b = srgbToLinear(color.b);

	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	const c = Math.sqrt(A * A + B * B);
	// atan2(0, 0) is 0, which is exactly right for a grey — a hue is
	// meaningless without chroma, and 0 is as good a default as any.
	const h = (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c, h: h < 0 ? h + 360 : h, a: color.a };
}

/**
 * OKLCH → `Color`.
 *
 * Channels may fall outside 0..255 for colours outside the sRGB gamut; `toCss`
 * clamps them.
 *
 * @param oklch - Lightness 0..1, chroma, hue in degrees.
 * @returns sRGB `Color`.
 *
 * @category Conversion
 */
export function oklchToRgb(oklch: Oklch): Color {
	const hRad = (oklch.h * Math.PI) / 180;
	const A = oklch.c * Math.cos(hRad);
	const B = oklch.c * Math.sin(hRad);
	const L = oklch.l;

	const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
	const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
	const s_ = L - 0.0894841775 * A - 1.291485548 * B;

	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;

	const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return {
		r: linearToSrgb(r),
		g: linearToSrgb(g),
		b: linearToSrgb(b),
		a: oklch.a,
	};
}

/** The short way round a hue circle from `a` to `b`, at `t`. Both HSL and
 * OKLCH interpolation need this — a straight lerp from 350° to 10° would
 * swing through 180° of unrelated hues instead of the 20° that are actually
 * between them. */
function lerpHue(a: number, b: number, t: number): number {
	let diff = ((b - a + 180) % 360) - 180;
	if (diff < -180) diff += 360;
	return a + diff * t;
}

/**
 * Options for {@link colorInterpolator} and `mixColor`.
 *
 * @category Interpolation
 */
export interface ColorInterpolationOptions {
	/**
	 * Interpolation space; `"oklch"` is perceptually even.
	 * @default "rgb"
	 */
	colorSpace?: ColorSpace;
}

/**
 * A sampler for the line from `a` to `b` in the chosen space. Endpoints are
 * parsed and converted once, so prefer it to `mixColor` when sampling one pair
 * repeatedly; the output matches `mixColor(a, b, t, options)`. Hue goes the short
 * way round; an achromatic endpoint borrows the other's hue.
 *
 * @param a - Colour at `t = 0`.
 * @param b - Colour at `t = 1`.
 * @param options - See {@link ColorInterpolationOptions}.
 * @returns A function from `t` (not clamped) to a fresh `Color`.
 *
 * @example
 * ```ts
 * import { toCss } from "@sophistry/core";
 * import { colorInterpolator } from "@sophistry/core/color";
 *
 * const ramp = colorInterpolator("#3b4cc0", "#b40426", { colorSpace: "oklch" });
 * const css = toCss(ramp(0.5));
 * ```
 *
 * @category Interpolation
 */
export function colorInterpolator(
	a: ColorInput,
	b: ColorInput,
	options: ColorInterpolationOptions = {},
): (t: number) => Color {
	const from = parseColor(a);
	const to = parseColor(b);
	const colorSpace = options.colorSpace ?? "rgb";

	if (colorSpace === "rgb") {
		const dr = to.r - from.r;
		const dg = to.g - from.g;
		const db = to.b - from.b;
		const da = to.a - from.a;
		return (t) => ({
			r: from.r + dr * t,
			g: from.g + dg * t,
			b: from.b + db * t,
			a: from.a + da * t,
		});
	}

	if (colorSpace === "hsl") {
		const fromHsl = rgbToHsl(from);
		const toHsl = rgbToHsl(to);
		// An achromatic endpoint (s ~ 0) has an arbitrary hue (rgbToHsl gives
		// 0), so hold the other endpoint's hue — mirrors the OKLCH chroma check.
		const fromHue = fromHsl.s < 1e-4 ? toHsl.h : fromHsl.h;
		const toHue = toHsl.s < 1e-4 ? fromHsl.h : toHsl.h;
		return (t) =>
			hslToRgb({
				h: lerpHue(fromHue, toHue, t),
				s: fromHsl.s + (toHsl.s - fromHsl.s) * t,
				l: fromHsl.l + (toHsl.l - fromHsl.l) * t,
				a: fromHsl.a + (toHsl.a - fromHsl.a) * t,
			});
	}

	const fromOklch = rgbToOklch(from);
	const toOklch = rgbToOklch(to);
	// A fully desaturated endpoint (grey, black, white) has an arbitrary hue
	// — atan2(0, 0) — so lerping *toward* it should hold the other
	// endpoint's hue rather than swinging toward 0°.
	const fromHue = fromOklch.c < 1e-4 ? toOklch.h : fromOklch.h;
	const toHue = toOklch.c < 1e-4 ? fromOklch.h : toOklch.h;
	return (t) =>
		oklchToRgb({
			l: fromOklch.l + (toOklch.l - fromOklch.l) * t,
			c: fromOklch.c + (toOklch.c - fromOklch.c) * t,
			h: lerpHue(fromHue, toHue, t),
			a: fromOklch.a + (toOklch.a - fromOklch.a) * t,
		});
}
