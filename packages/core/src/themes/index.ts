/**
 * Themes: palettes (built-in or `definePalette` colour sets with light and dark variants), the
 * colour mode they resolve against, and colormaps. Catppuccin is the default.
 */

export type { CatppuccinFlavor } from "./catppuccin.js";
export { catppuccin, catppuccinSeed } from "./catppuccin.js";
export type {
	Colormap,
	ColormapName,
	ColormapOptions,
	ColormapSpec,
} from "./colormap.js";
export {
	colormapStops,
	colormaps,
	resolveColormap,
} from "./colormap.js";
export type { PaletteCssOptions } from "./css.js";
export { paletteCss, paletteVariables } from "./css.js";
export type { ModeOptions, ThemeInitScriptOptions } from "./mode.js";
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
} from "./mode.js";
export {
	catppuccinPalette,
	completePalette,
	DEFAULT_PALETTE_NAME,
	DEFAULT_THEME_DEFAULTS,
	definePalette,
	palettes,
	paletteTheme,
	resolvePalette,
} from "./palette.js";
export { colorRamp, sampleRamp } from "./ramp.js";
export type { ThemeSpec } from "./theme.js";
export { resolveTheme } from "./theme.js";
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
} from "./types.js";
