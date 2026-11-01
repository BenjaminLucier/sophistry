/**
 * `color/`: one colour algebra for the package. A normalised `Color` type, one
 * parser, one CSS serialiser, and the interpolation and shading operations.
 * A leaf module (d3-color and d3-interpolate only).
 */

export type {
	ColorInterpolationOptions,
	Hsl,
	Hsv,
	Oklch,
} from "./convert.js";
export {
	colorInterpolator,
	hslToRgb,
	hsvToRgb,
	oklchToRgb,
	rgbToHsl,
	rgbToHsv,
	rgbToOklch,
} from "./convert.js";
export {
	BLACK,
	BLUE,
	GOLD,
	GREEN,
	GREY,
	GREY_A,
	GREY_B,
	GREY_C,
	GREY_D,
	GREY_E,
	MAROON,
	namedColors,
	ORANGE,
	PINK,
	PURPLE,
	RED,
	TEAL,
	WHITE,
	YELLOW,
} from "./named.js";
export {
	darken,
	lighten,
	mixColor,
	shadeColor,
	withAlpha,
} from "./ops.js";
export {
	cssColor,
	FALLBACK_COLOR,
	parseColor,
	toCss,
	tryParseColor,
} from "./parse.js";
export type { RandomColorOptions } from "./random.js";
export { randomColor } from "./random.js";
export type { Color, ColorInput, ColorSpace } from "./types.js";
