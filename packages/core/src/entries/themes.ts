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

export type { CatppuccinFlavor } from "../themes/catppuccin";
export { catppuccin, catppuccinSeed } from "../themes/catppuccin";
export type {
	Colormap,
	ColormapName,
	ColormapOptions,
	ColormapSpec,
} from "../themes/colormap";
export {
	colormapStops,
	colormaps,
	resolveColormap,
} from "../themes/colormap";
export type { PaletteCssOptions } from "../themes/css";
export { paletteCss, paletteVariables } from "../themes/css";
export type { ModeOptions, ThemeInitScriptOptions } from "../themes/mode";
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
} from "../themes/mode";
export {
	catppuccinPalette,
	completePalette,
	DEFAULT_PALETTE_NAME,
	DEFAULT_THEME_DEFAULTS,
	definePalette,
	palettes,
	paletteTheme,
	resolvePalette,
} from "../themes/palette";
export type { ColorRampOptions } from "../themes/ramp";
export { colorRamp, sampleRamp } from "../themes/ramp";
export type { ThemeSpec } from "../themes/theme";
export { resolveTheme } from "../themes/theme";
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
} from "../themes/types";
