/**
 * Named colour constants with Manim's values (`BLUE === "#58C4DD"`), as plain
 * CSS hex strings that any `ColorInput` accepts.
 */

/**
 * Pure white, `#FFFFFF`.
 *
 * @category Colour
 */
export const WHITE = "#FFFFFF";
/**
 * Pure black, `#000000`.
 *
 * @category Colour
 */
export const BLACK = "#000000";

/**
 * Lightest grey of the A-E scale, `#DDDDDD`.
 *
 * @category Colour
 */
export const GREY_A = "#DDDDDD";
/**
 * Light grey, `#BBBBBB`.
 *
 * @category Colour
 */
export const GREY_B = "#BBBBBB";
/**
 * Mid grey, `#888888`.
 *
 * @category Colour
 */
export const GREY_C = "#888888";
/**
 * Dark grey, `#444444`.
 *
 * @category Colour
 */
export const GREY_D = "#444444";
/**
 * Darkest grey of the A-E scale, `#222222`.
 *
 * @category Colour
 */
export const GREY_E = "#222222";
/**
 * Alias for `GREY_C`, the mid grey most callers mean by "grey".
 *
 * @category Colour
 */
export const GREY = GREY_C;

/**
 * Manim red, `#FC6255`.
 *
 * @category Colour
 */
export const RED = "#FC6255";
/**
 * Manim maroon, `#C55F73`.
 *
 * @category Colour
 */
export const MAROON = "#C55F73";
/**
 * Manim orange, `#FF862F`.
 *
 * @category Colour
 */
export const ORANGE = "#FF862F";
/**
 * Manim gold, `#F0AC5F`.
 *
 * @category Colour
 */
export const GOLD = "#F0AC5F";
/**
 * Pure yellow, `#FFFF00`.
 *
 * @category Colour
 */
export const YELLOW = "#FFFF00";
/**
 * Manim green, `#83C167`.
 *
 * @category Colour
 */
export const GREEN = "#83C167";
/**
 * Manim teal, `#5CD0B3`.
 *
 * @category Colour
 */
export const TEAL = "#5CD0B3";
/**
 * Manim blue, `#58C4DD`.
 *
 * @category Colour
 */
export const BLUE = "#58C4DD";
/**
 * Manim purple, `#9A72AC`.
 *
 * @category Colour
 */
export const PURPLE = "#9A72AC";
/**
 * Manim pink, `#D147BD`.
 *
 * @category Colour
 */
export const PINK = "#D147BD";

/**
 * The named palette as a lookup, for code that picks a colour by string
 * key (e.g. a theme config) rather than importing the constant directly.
 * Keys are camelCase: `white`, `greyA` ... `greyE`, `grey`, `gray`, `red`, and so on.
 *
 * @example
 * ```ts
 * import { namedColors } from "@sophistry/core";
 *
 * const css = namedColors.blue; // "#58C4DD"
 * ```
 *
 * @category Colour
 */
export const namedColors: Readonly<Record<string, string>> = {
	white: WHITE,
	black: BLACK,
	greyA: GREY_A,
	greyB: GREY_B,
	greyC: GREY_C,
	greyD: GREY_D,
	greyE: GREY_E,
	grey: GREY,
	red: RED,
	maroon: MAROON,
	orange: ORANGE,
	gold: GOLD,
	yellow: YELLOW,
	green: GREEN,
	teal: TEAL,
	blue: BLUE,
	purple: PURPLE,
	pink: PINK,
};
