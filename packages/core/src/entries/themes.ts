/**
 * `@sophistry/core/themes`: palettes (Catppuccin by default, or your own
 * through `definePalette`), the page's light/dark colour mode as a `Readable`,
 * the pre-paint `themeInitScript`, palette CSS variables, colormaps and ramps.
 *
 * @example
 * ```ts
 * import {
 * 	colorModeReadable,
 * 	installColorMode,
 * 	resolveTheme,
 * } from "@sophistry/core/themes";
 *
 * installColorMode();
 * let theme = resolveTheme();
 * colorModeReadable.subscribe(() => {
 * 	theme = resolveTheme();
 * });
 * ```
 *
 * @module @sophistry/core/themes
 * @packageDocumentation
 */

export type { CatppuccinFlavor } from "../themes/catppuccin.js";
export { catppuccin, catppuccinSeed } from "../themes/catppuccin.js";
export type {
	Colormap,
	ColormapName,
	ColormapOptions,
	ColormapSpec,
} from "../themes/colormap.js";
export {
	colormapStops,
	colormaps,
	resolveColormap,
} from "../themes/colormap.js";
export type { PaletteCssOptions } from "../themes/css.js";
export { paletteCss, paletteVariables } from "../themes/css.js";
export type { ModeOptions, ThemeInitScriptOptions } from "../themes/mode.js";
export {
	colorMode,
	colorModeReadable,
	cycleModePreference,
	installColorMode,
	modePreference,
	modePreferenceReadable,
	resolveModePreference,
	setModePreference,
	themeInitScript,
} from "../themes/mode.js";
export {
	catppuccinPalette,
	completePalette,
	DEFAULT_PALETTE_NAME,
	DEFAULT_THEME_DEFAULTS,
	definePalette,
	palettes,
	paletteTheme,
	resolvePalette,
} from "../themes/palette.js";
export type { ColorRampOptions } from "../themes/ramp.js";
export { colorRamp, sampleRamp } from "../themes/ramp.js";
export type { ThemeSpec } from "../themes/theme.js";
export { resolveTheme } from "../themes/theme.js";
export type {
	ColorMode,
	ModePreference,
	Palette,
	PaletteInput,
	PaletteName,
	PaletteSpec,
	Theme,
	ThemeDefaults,
	ThemePalette,
	ThemePaletteSeed,
} from "../themes/types.js";
