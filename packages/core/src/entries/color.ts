/**
 * `@sophistry/core/color`: colour spaces (HSL, HSV, OKLCH), interpolation,
 * random colours, colormaps and ramps, plus the named colours and everyday
 * operations (`withAlpha`, `lighten`, `darken`, `mixColor`, `parseColor`,
 * `toCss`), which the root entry also re-exports.
 *
 * @example
 * ```ts
 * import { BLUE, colorInterpolator, colorRamp, RED } from "@sophistry/core/color";
 *
 * const redToBlue = colorInterpolator(RED, BLUE, { colorSpace: "oklch" });
 * const mid = redToBlue(0.5);
 * const ramp = colorRamp(["#000000", "#ff0000", "#ffffff"]);
 * ```
 *
 * @module @sophistry/core/color
 * @packageDocumentation
 */

export type {
	ColorInterpolationOptions,
	Hsl,
	Hsv,
	Oklch,
} from "../color/convert";
export {
	colorInterpolator,
	hslToRgb,
	hsvToRgb,
	oklchToRgb,
	rgbToHsl,
	rgbToHsv,
	rgbToOklch,
} from "../color/convert";
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
} from "../color/named";
export {
	darken,
	lighten,
	mixColor,
	shadeColor,
	withAlpha,
} from "../color/ops";
export {
	FALLBACK_COLOR,
	parseColor,
	toCss,
	tryParseColor,
} from "../color/parse";
export type { RandomColorOptions } from "../color/random";
export { randomColor } from "../color/random";
export type { Color, ColorInput, ColorSpace } from "../color/types";
export type {
	Colormap,
	ColormapName,
	ColormapOptions,
	ColormapSpec,
} from "../themes/colormap";
export { colormapStops, colormaps, resolveColormap } from "../themes/colormap";
export type { ColorRampOptions } from "../themes/ramp";
export { colorRamp, sampleRamp } from "../themes/ramp";
