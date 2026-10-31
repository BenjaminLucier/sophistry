/**
 * Themes: palettes (built-in or `definePalette` colour sets with light and dark variants), the
 * colour mode they resolve against, and colormaps. Catppuccin is the default.
 */

export type { CatppuccinFlavor } from "./catppuccin";
export { catppuccin, catppuccinSeed } from "./catppuccin";
export type {
	Colormap,
	ColormapName,
	ColormapOptions,
	ColormapSpec,
} from "./colormap";
export {
	colormapStops,
	colormaps,
	resolveColormap,
} from "./colormap";
export type { PaletteCssOptions } from "./css";
export { paletteCss, paletteVariables } from "./css";
export type { ModeOptions, ThemeInitScriptOptions } from "./mode";
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
} from "./mode";
export {
	catppuccinPalette,
	completePalette,
	DEFAULT_PALETTE_NAME,
	DEFAULT_THEME_DEFAULTS,
	definePalette,
	palettes,
	paletteTheme,
	resolvePalette,
} from "./palette";
export { colorRamp, sampleRamp } from "./ramp";
export type { ThemeSpec } from "./theme";
export { resolveTheme } from "./theme";
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
} from "./types";
