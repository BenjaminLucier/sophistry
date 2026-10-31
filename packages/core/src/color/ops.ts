/**
 * Everyday colour operations as named wrappers (`lighten`, `darken`,
 * `mixColor`, `withAlpha`, ...). Every mix takes `{ colorSpace }`: `mixColor`
 * defaults to `"rgb"` (a plain blend), `lighten`/`darken` to `"oklch"` (so
 * saturation holds). `shadeColor` scales RGB channels.
 */

import { type ColorInterpolationOptions, colorInterpolator } from "./convert";
import { parseColor } from "./parse";
import type { Color, ColorInput } from "./types";

/** `color` between `a` and `b`, at `t`, in RGB — the direct replacement for
 * `mesh-math.ts`'s old `mixHexColor`, and the general "fade toward a base
 * colour" primitive `scene/core/gradient.ts`'s `sheen` wants. Pass `{ colorSpace }`
 * to mix in a perceptually-uniform space instead. To sample one pair many
 * times, build a `colorInterpolator(a, b, options)` once.
 *
 * @param a - Colour at `t = 0`.
 * @param b - Colour at `t = 1`.
 * @param t - Mix amount; 0 gives `a`, 1 gives `b`. Not clamped.
 * @param options - `colorSpace` defaults to `"rgb"`; see {@link ColorInterpolationOptions}.
 * @returns The mixed `Color`.
 *
 * @example
 * ```ts
 * import { mixColor, toCss } from "@sophistry/core";
 *
 * const purple = toCss(mixColor("red", "blue", 0.5));
 * ```
 *
 * @category Colour
 */
export function mixColor(
	a: ColorInput,
	b: ColorInput,
	t: number,
	options: ColorInterpolationOptions = {},
): Color {
	return colorInterpolator(a, b, options)(t);
}

/** `color` mixed `amount` of the way toward white, in OKLCH by default — lightening in
 * a perceptual colorSpace keeps a saturated colour looking lightened rather than
 * washed to pastel the way an RGB mix toward white does.
 *
 * @param color - Colour to lighten.
 * @param amount - 0 leaves it unchanged, 1 gives white.
 * @param options - `colorSpace` to mix in. Defaults to `"oklch"` (note `mixColor` defaults to `"rgb"`).
 * @returns The lightened `Color`.
 *
 * @example
 * ```ts
 * import { BLUE, lighten, toCss } from "@sophistry/core";
 *
 * const fill = toCss(lighten(BLUE, 0.3));
 * ```
 *
 * @category Colour
 */
export function lighten(
	color: ColorInput,
	amount: number,
	{ colorSpace = "oklch" }: ColorInterpolationOptions = {},
): Color {
	return mixColor(color, { r: 255, g: 255, b: 255, a: 1 }, amount, {
		colorSpace,
	});
}

/**
 * `color` mixed `amount` of the way toward black, in OKLCH by default.
 *
 * @param color - Colour to darken.
 * @param amount - 0 leaves it unchanged, 1 gives black.
 * @param options - `colorSpace` to mix in. Defaults to `"oklch"` (note `mixColor` defaults to `"rgb"`).
 * @returns The darkened `Color`.
 *
 * @category Colour
 */
export function darken(
	color: ColorInput,
	amount: number,
	{ colorSpace = "oklch" }: ColorInterpolationOptions = {},
): Color {
	return mixColor(color, { r: 0, g: 0, b: 0, a: 1 }, amount, {
		colorSpace,
	});
}

/**
 * Scales a colour's channels by `intensity`, clamped so a bright light never
 * overflows into a channel outside 0..255 before `toCss` gets to it.
 *
 * This is the exact operation flat 3D shading needs — `N·L` produces a
 * 0..1-ish intensity, and a lit face is its base colour times that number —
 * kept as a plain multiply (not a mix toward white/black) because that is
 * what `mesh-math.ts`'s old `shadeHexColor` did and what makes a cube's
 * faces read as *one material under different light* rather than as three
 * different materials.
 *
 * @param color - Base colour.
 * @param intensity - Multiplier; 1 leaves the colour unchanged, 0 gives black. Alpha is preserved.
 * @returns The scaled `Color`, channels clamped to 0..255.
 *
 * @category Ops
 */
export function shadeColor(color: ColorInput, intensity: number): Color {
	const c = parseColor(color);
	return {
		r: Math.min(255, Math.max(0, c.r * intensity)),
		g: Math.min(255, Math.max(0, c.g * intensity)),
		b: Math.min(255, Math.max(0, c.b * intensity)),
		a: c.a,
	};
}

/**
 * `color` with its alpha replaced by `alpha`.
 *
 * @param color - Colour to modify.
 * @param alpha - New opacity, 0..1.
 * @returns A new `Color`; the input is not modified.
 *
 * @example
 * ```ts
 * import { RED, toCss, withAlpha } from "@sophistry/core";
 *
 * const translucent = toCss(withAlpha(RED, 0.4));
 * ```
 *
 * @category Colour
 */
export function withAlpha(color: ColorInput, alpha: number): Color {
	const c = parseColor(color);
	return { ...c, a: alpha };
}
