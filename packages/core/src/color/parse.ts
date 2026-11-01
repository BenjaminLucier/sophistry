/**
 * The one door in and the one door out of `Color`.
 *
 * Parsing is delegated to d3-color rather than hand-rolled, because
 * "recognise every CSS colour" is a solved, tedious problem — hex (3/4/6/8
 * digit), `rgb()`/`rgba()`, `hsl()`/`hsla()`, and the ~150 CSS named colours
 * — and d3-color already carries the named-colour table nothing else in
 * this package should duplicate. What this file adds is the fallback
 * contract the rest of `sophistry` needs: **never throw**, because a colour
 * usually arrives from a scene author's prop, and a typo in a `fill` string
 * should render something rather than crash the whole scene tree.
 */

import { color as d3Color } from "d3-color";
import { hslToRgb, oklchToRgb } from "./convert.js";
import type { Color, ColorInput } from "./types.js";

/**
 * The documented fallback for a colour string d3-color cannot parse:
 * opaque mid-grey. This is the same fallback `mesh-math.ts`'s old
 * `parseHexColor` used for unparsable hex — kept here so a malformed colour
 * still reads as "something is wrong" (grey) rather than as black, which
 * would be indistinguishable from an intentional choice.
 *
 * @category Conversion
 */
export const FALLBACK_COLOR: Color = { r: 128, g: 128, b: 128, a: 1 };

/**
 * Any CSS colour string → normalised `{ r, g, b, a }`, or a `Color` handed
 * back unchanged: the one shared colour parser.
 *
 * @param input - A CSS colour string (hex, `rgb()`, `hsl()`, named) or a `Color`.
 * @returns A fresh `Color`; the opaque grey {@link FALLBACK_COLOR} if the string is unparsable. Never throws.
 *
 * @example
 * ```ts
 * import { parseColor } from "@sophistry/core";
 *
 * const c = parseColor("rebeccapurple"); // { r: 102, g: 51, b: 153, a: 1 }
 * ```
 *
 * @category Colour
 */
export function parseColor(input: ColorInput): Color {
	if (typeof input !== "string") return sanitize(input);
	return tryParseColor(input) ?? { ...FALLBACK_COLOR };
}

/** Channel used in place of a NaN r/g/b: the {@link FALLBACK_COLOR} grey. */
const NAN_CHANNEL = FALLBACK_COLOR.r;

/**
 * Replaces NaN channels so downstream arithmetic and `toCss` never see them:
 * NaN r/g/b become mid-grey (128, matching {@link FALLBACK_COLOR}) and NaN
 * alpha becomes 1. Infinite values are left for `toCss` to clamp.
 */
function sanitize(color: Color): Color {
	return {
		r: Number.isNaN(color.r) ? NAN_CHANNEL : color.r,
		g: Number.isNaN(color.g) ? NAN_CHANNEL : color.g,
		b: Number.isNaN(color.b) ? NAN_CHANNEL : color.b,
		a: Number.isNaN(color.a) ? 1 : color.a,
	};
}

const MODERN_FN = /^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/i;

/** A number, percentage or angle token → value; `%` is returned as a fraction flag. */
function token(
	raw: string,
): { value: number; percent: boolean; unit: string } | null {
	if (raw.toLowerCase() === "none")
		return { value: 0, percent: false, unit: "" };
	const m =
		/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/i.exec(
			raw,
		);
	if (!m) return null;
	return {
		value: Number.parseFloat(m[1]),
		percent: m[2] === "%",
		unit: (m[2] ?? "").toLowerCase(),
	};
}

function hueDegrees(t: {
	value: number;
	unit: string;
	percent: boolean;
}): number | null {
	if (t.percent) return null;
	switch (t.unit) {
		case "":
		case "deg":
			return t.value;
		case "grad":
			return (t.value * 360) / 400;
		case "rad":
			return (t.value * 180) / Math.PI;
		case "turn":
			return t.value * 360;
		default:
			return null;
	}
}

/** Fraction 0..1 from `50%` or `0.5`. */
function fraction(t: {
	value: number;
	percent: boolean;
	unit: string;
}): number | null {
	if (t.unit && !t.percent) return null;
	return t.percent ? t.value / 100 : t.value;
}

/**
 * CSS Color 4 function syntax d3-color does not read: space-separated
 * `rgb()`/`hsl()` with `/ alpha`, `deg`/`turn`/`rad` hue units, `none`, and
 * `oklch()`/`oklab()`. Returns null for anything malformed.
 */
function parseModern(input: string): Color | null {
	const match = MODERN_FN.exec(input.trim());
	if (!match) return null;
	const fn = match[1].toLowerCase().replace(/a$/, "");
	let main = match[2];
	let alphaRaw: string | undefined;
	const slash = main.indexOf("/");
	if (slash >= 0) {
		alphaRaw = main.slice(slash + 1).trim();
		main = main.slice(0, slash);
	}
	const parts = main
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean);
	if (alphaRaw === undefined && parts.length === 4) alphaRaw = parts.pop();
	if (parts.length !== 3) return null;
	const t = parts.map(token);
	if (t.some((x) => x === null)) return null;
	const [c1, c2, c3] = t as NonNullable<(typeof t)[number]>[];

	let a = 1;
	if (alphaRaw !== undefined) {
		const at = token(alphaRaw);
		const f = at && fraction(at);
		if (f === null || f === undefined) return null;
		a = Math.min(1, Math.max(0, f));
	}

	if (fn === "rgb") {
		const ch = (x: typeof c1) =>
			x.unit && !x.percent
				? Number.NaN
				: x.percent
					? (x.value / 100) * 255
					: x.value;
		const rgb = { r: ch(c1), g: ch(c2), b: ch(c3), a };
		return Number.isNaN(rgb.r + rgb.g + rgb.b) ? null : rgb;
	}
	if (fn === "hsl") {
		const h = hueDegrees(c1);
		const s = fraction(c2);
		const l = fraction(c3);
		if (h === null || s === null || l === null) return null;
		return hslToRgb({
			h,
			s: Math.min(1, Math.max(0, s)),
			l: Math.min(1, Math.max(0, l)),
			a,
		});
	}
	if (fn === "oklch") {
		const l = fraction(c1);
		const c = c2.percent ? (c2.value / 100) * 0.4 : c2.unit ? null : c2.value;
		const h = hueDegrees(c3);
		if (l === null || c === null || h === null) return null;
		return oklchToRgb({ l, c, h, a });
	}
	// oklab: l, a, b → polar form.
	const l = fraction(c1);
	const A = c2.percent ? (c2.value / 100) * 0.4 : c2.unit ? null : c2.value;
	const B = c3.percent ? (c3.value / 100) * 0.4 : c3.unit ? null : c3.value;
	if (l === null || A === null || B === null) return null;
	return oklchToRgb({
		l,
		c: Math.hypot(A, B),
		h: (Math.atan2(B, A) * 180) / Math.PI,
		a,
	});
}

/**
 * Like {@link parseColor} for strings, but returns `null` instead of the grey
 * fallback when the input is not a recognised colour. A `Color` object is
 * returned (sanitized) as-is. Handles hex, named colours, `transparent`,
 * comma-separated and space-separated (`/ alpha`) `rgb()`/`hsl()`, and
 * `oklch()`/`oklab()`.
 *
 * @param input - A CSS colour string or a `Color`.
 * @returns A fresh `Color`, or `null` if unparsable. Never throws.
 *
 * @category Conversion
 */
export function tryParseColor(input: ColorInput): Color | null {
	if (typeof input !== "string") return sanitize(input);
	const text = input.trim();
	if (text.toLowerCase() === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

	const parsed = d3Color(text);
	if (parsed !== null) {
		const rgb = parsed.rgb();
		if (Number.isNaN(rgb.r) || Number.isNaN(rgb.g) || Number.isNaN(rgb.b)) {
			return null;
		}
		// d3's `opacity` is already 0..1, and `NaN` reads as fully opaque —
		// an author who wrote a colour with no alpha channel meant "opaque",
		// not "undefined".
		const a = Number.isNaN(rgb.opacity) ? 1 : rgb.opacity;
		return { r: rgb.r, g: rgb.g, b: rgb.b, a };
	}
	return parseModern(text);
}

function clampChannel(value: number): number {
	return Math.round(Math.min(255, Math.max(0, value)));
}

/**
 * A {@link ColorInput} as a CSS string Canvas2D or the DOM will accept.
 *
 * A string passes through untouched (so an authored `"#3b4cc0"`, or a named
 * constant such as `BLUE`, stays that exact string). A `Color` is serialised
 * as `rgba(...)`, always, even at `a: 1`: a single consistent format is one
 * fewer branch for every caller, and Canvas2D treats `rgba(r,g,b,1)`
 * identically to `rgb(r,g,b)`. Channels are clamped and rounded here, at the
 * boundary, rather than after every arithmetic step upstream; see the
 * `Color` doc for why intermediate values are allowed to overshoot.
 *
 * @param color - A CSS colour string, or a `Color` with channels 0..255 (clamped and rounded; `NaN` reads as grey 128) and alpha 0..1 (clamped; `NaN` reads as 1).
 * @returns The string unchanged, or one like `rgba(88, 196, 221, 1)`.
 *
 * @category Colour
 */
export function toCss(color: ColorInput): string {
	if (typeof color === "string") return color;
	// NaN channels are replaced (grey 128) so the output never contains "NaN".
	// No intermediate `sanitize` object: this runs once per animated colour per
	// frame, so it is allocation-free apart from the result string.
	const r = clampChannel(Number.isNaN(color.r) ? NAN_CHANNEL : color.r);
	const g = clampChannel(Number.isNaN(color.g) ? NAN_CHANNEL : color.g);
	const b = clampChannel(Number.isNaN(color.b) ? NAN_CHANNEL : color.b);
	const a = Number.isNaN(color.a) ? 1 : Math.min(1, Math.max(0, color.a));
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Same as {@link toCss}: a {@link ColorInput} as the CSS string Canvas2D
 * wants. The name used where props that accept a `ColorInput` are resolved
 * before they reach a spec, so `fill={BLUE}` and `fill="blue"` are
 * interchangeable everywhere.
 *
 * @param input - A CSS colour string or a `Color`.
 * @returns A CSS colour string.
 *
 * @category Colour
 */
export function cssColor(input: ColorInput): string {
	return toCss(input);
}
