/**
 * Theme types. A *palette* is semantic colour tokens (`background`,
 * `foreground`, `accent`, `series`, ...) with a light and a dark variant; a
 * *theme* is a palette resolved for one mode plus sizing defaults. Every default
 * colour in the library is a theme token, so a palette restyles everything and
 * any explicit prop still overrides.
 */

import type { ColorInput } from "../color/types";

/**
 * A concrete colour mode. What a palette variant is keyed by.
 *
 * @category Theming
 */
export type ColorMode = "light" | "dark";

/**
 * What a user *stores*: a concrete mode, or "follow the OS".
 *
 * @category Theming
 */
export type ModePreference = "system" | ColorMode;

/**
 * The semantic colour tokens of one palette in one mode.
 *
 * Components never hardcode colours; they read these tokens from the active
 * {@link Theme}. All values are CSS colour strings (a palette seed may be
 * written with `Color`s; `definePalette` serialises them).
 *
 * @category Theming
 */
export interface ThemePalette {
	/** The canvas ground. */
	background: string;
	/** Primary ink: default strokes, text, labels. */
	foreground: string;
	/** Secondary ink: tick labels, captions, de-emphasised strokes. */
	muted: string;
	/** The one colour a shape gets when nothing else is said. */
	accent: string;
	/** Categorical colours for series, highlights, and labels. */
	series: string[];
	/** A raised surface sitting on the ground: label plates, panels. */
	surface: string;
	/** Grid and guide lines — dimmer than `muted`, scenery rather than data. */
	grid: string;
	/** Frames and dividers: a camera's border, a plot's outline. */
	border: string;
	/** Emphasis flashes and highlights (`indicate`, `circumscribe`). */
	highlight: string;
	/** Status colour for gains and success. */
	positive: string;
	/** Status colour for losses and failure. */
	negative: string;
	/** Status colour for caution. */
	warning: string;
	/** Status colour for neutral information. */
	info: string;
	/** The x / y / z axis hues of a 3D coordinate frame. */
	axes: { x: string; y: string; z: string };
	/** A sequential low → high ramp, for heat maps and densities. */
	ramp: string[];
}

/**
 * Sizing defaults a theme carries alongside its colours.
 *
 * @category Theming
 */
export interface ThemeDefaults {
	/** Stroke width in *scene units*; scaled to pixels by the renderer. */
	strokeWidth: number;
	/** CSS `font-family` list used for text when none is given. */
	fontFamily: string;
	/** Font size in scene units. */
	fontSize: number;
}

/**
 * A palette resolved for one mode: the object components read their default
 * colours and sizes from. `mode` records which variant `palette` is, so a
 * caller holding only a `Theme` can tell light from dark.
 *
 * Get one reactively with `useTheme()`, or build one with {@link resolveTheme}
 * or {@link paletteTheme}. Themes are cached per (palette, mode), so the same
 * inputs yield the same object identity.
 *
 * @category Theming
 */
export interface Theme {
	/** Name of the palette this theme came from. */
	readonly name: string;
	/** Which variant of the palette `palette` is. */
	readonly mode: ColorMode;
	/** The semantic colour tokens for `mode`. */
	readonly palette: ThemePalette;
	/** Sizing defaults (stroke width, font) shared by both modes. */
	readonly defaults: ThemeDefaults;
}

/**
 * The tokens a palette *must* supply. Everything else is derived from these
 * when left out — see `completePalette` — so a brand palette can be four
 * colours long and still colour every component. Every token is a
 * {@link ColorInput}: a CSS string or a `Color` such as `BLUE`.
 *
 * @category Theming
 */
export interface ThemePaletteSeed {
	/** The stage background. */
	background: ColorInput;
	/** Default ink: strokes, text. */
	foreground: ColorInput;
	/** The primary highlight colour. */
	accent: ColorInput;
	/** Defaults to a 65% blend of `background` toward `foreground`. */
	muted?: ColorInput;
	/** Defaults to `[accent]`. */
	series?: ColorInput[];
	/** Defaults to an 8% blend of `background` toward `foreground`. */
	surface?: ColorInput;
	/** Defaults to a 30% blend of `background` toward `foreground`. */
	grid?: ColorInput;
	/** Defaults to a 20% blend of `background` toward `foreground`. */
	border?: ColorInput;
	/** Defaults to `accent`. */
	highlight?: ColorInput;
	/** Defaults to Catppuccin's green for the same mode. */
	positive?: ColorInput;
	/** Defaults to Catppuccin's red for the same mode. */
	negative?: ColorInput;
	/** Defaults to Catppuccin's peach for the same mode. */
	warning?: ColorInput;
	/** Defaults to Catppuccin's sky for the same mode. */
	info?: ColorInput;
	/** Per-axis overrides; missing axes default to Catppuccin's red/green/blue. */
	axes?: { x?: ColorInput; y?: ColorInput; z?: ColorInput };
	/** Defaults to `[background, accent]`. */
	ramp?: ColorInput[];
}

/**
 * What `definePalette` accepts: one seed per mode. Supply just one and it is
 * used for both — a palette with no light variant is a dark palette in light
 * mode, which is the author's call to make, not the library's to guess.
 *
 * @category Theming
 */
export interface PaletteInput {
	/** Display name, carried on the resulting `Palette` and its `Theme`s. Not a lookup key. */
	name: string;
	/** Seed colours for dark mode. Falls back to `light` when omitted. */
	dark?: ThemePaletteSeed;
	/** Seed colours for light mode. Falls back to `dark` when omitted. */
	light?: ThemePaletteSeed;
	/** Sizing defaults shared by both modes; unset fields use `DEFAULT_THEME_DEFAULTS`. */
	defaults?: Partial<ThemeDefaults>;
}

/**
 * Name of a built-in palette in `palettes`. The closed union of built-ins; a custom palette is passed as a `Palette` value instead.
 *
 * @category Theming
 */
export type PaletteName = "catppuccin";

/**
 * A palette: both modes fully resolved. Build one with
 * {@link definePalette}; pick a mode with
 * {@link paletteTheme}.
 *
 * @category Theming
 */
export interface Palette {
	/** Display name. Not a lookup key. */
	readonly name: string;
	/** Fully resolved tokens for dark mode. */
	readonly dark: ThemePalette;
	/** Fully resolved tokens for light mode. */
	readonly light: ThemePalette;
	/** Sizing defaults shared by both modes. */
	readonly defaults: ThemeDefaults;
}

/**
 * A palette object used directly (build one with `definePalette`), or the
 * name of a built-in in `palettes` (currently `"catppuccin"`).
 *
 * @category Theming
 */
export type PaletteSpec = Palette | PaletteName;
