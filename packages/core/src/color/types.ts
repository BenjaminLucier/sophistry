/**
 * `Color`: the one normalised numeric colour form the colour toolkit computes
 * with. `parseColor` is the way in; `toCss` the way out.
 */

/**
 * Normalised RGBA. Channels are **not** clamped by the type system — most
 * conversions (OKLCH round-trips especially) can transiently overshoot
 * 0..255 for a saturated colour near the edge of the sRGB gamut — so
 * `toCss` is where out-of-range channels finally get clamped, once, at the
 * boundary where a browser will otherwise silently do it for you.
 *
 * @category Colour
 */
export interface Color {
	/** Red, 0..255. */
	r: number;
	/** Green, 0..255. */
	g: number;
	/** Blue, 0..255. */
	b: number;
	/** Alpha, 0..1 (not 0..255 — this is the one channel CSS itself keeps
	 * fractional, and matching that convention is one fewer place to divide
	 * by 255 by accident). */
	a: number;
}

/** A colour, or a string a scene author actually wrote. Most of this
 * module's public functions accept either so a call site never has to
 * remember which form it is currently holding.
 *
 * @category Colour
 */
export type ColorInput = string | Color;

/** The colour spaces `colorInterpolator` knows how to walk a straight line
 * through. See that function's doc for when each is the right call.
 *
 * @category Colour
 */
export type ColorSpace = "rgb" | "hsl" | "oklch";
