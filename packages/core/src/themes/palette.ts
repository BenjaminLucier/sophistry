/**
 * Palettes.
 *
 * `definePalette` turns a handful of seed colours per mode into a full set of
 * semantic tokens, returned as a plain `Palette` value that is passed straight
 * to whatever takes one (`<Stage palette={brand}>`, `paletteCss(brand)`,
 * `themeInitScript({ palette: brand })`). Nothing is registered globally and
 * there is no mutable default: the built-ins live in the frozen
 * {@link palettes} map (currently Catppuccin: Mocha dark, Latte light), which
 * is also the default every `<Stage>` uses when nothing else is said.
 */

import type { ColorInput } from "../color";
import { cssColor, mixColor, parseColor, rgbToOklch, toCss } from "../color";
import { createResolver } from "../geometry/resolver";
import { catppuccin, catppuccinSeed } from "./catppuccin";
import type {
	ColorMode,
	Palette,
	PaletteInput,
	PaletteName,
	PaletteSpec,
	Theme,
	ThemeDefaults,
	ThemePalette,
	ThemePaletteSeed,
} from "./types";

/** Sizing defaults a palette gets when it does not set its own: stroke width and font size in scene units, plus a system sans-serif stack. */
export const DEFAULT_THEME_DEFAULTS: ThemeDefaults = {
	strokeWidth: 0.045,
	fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
	fontSize: 0.4,
};

/** Mixes `ground` toward `ink` by `t` — how missing tokens are derived. */
function blend(ground: ColorInput, ink: ColorInput, t: number): string {
	return toCss(mixColor(ground, ink, t));
}

/** Whether `background` takes Mocha's fallback hues: clearly dark (OKLCH lightness < 0.5), clearly light (> 0.7), else the declared `mode`. */
function fallbackIsDark(background: ColorInput, mode: ColorMode): boolean {
	const l = rgbToOklch(parseColor(background)).l;
	if (l < 0.5) return true;
	if (l > 0.7) return false;
	return mode === "dark";
}

/**
 * Fills every token a seed left out.
 *
 * Neutral tokens (`muted`, `surface`, `grid`, `border`) are blends of the
 * seed's own `background` and `foreground`, so they always sit inside the
 * palette's contrast range. The status and axis hues are conventionally
 * universal (red is bad, green is good, x is red), so they fall back to
 * Catppuccin's rather than being guessed from the seed. Which Catppuccin
 * flavour (Mocha or Latte) is chosen by the seed's own `background`: a
 * background clearly dark (OKLCH lightness below 0.5) gets Mocha's hues, a
 * clearly light one (above 0.7) gets Latte's, so the fallbacks stay legible
 * whatever `mode` the seed was filed under. `mode` only decides in between.
 *
 * @param seed - The required tokens plus any optional overrides.
 * @param mode - Which mode the seed is for; decides the Catppuccin fallbacks only for a mid-tone background.
 * @returns A complete {@link ThemePalette}.
 *
 * @category Theming
 */
export function completePalette(
	seed: ThemePaletteSeed,
	mode: ColorMode,
): ThemePalette {
	const base = catppuccinSeed(
		catppuccin[fallbackIsDark(seed.background, mode) ? "mocha" : "latte"],
	);
	const { background, foreground, accent } = seed;
	const css = (input: ColorInput | undefined, fallback: string): string =>
		input === undefined ? fallback : cssColor(input);
	const series = seed.series?.length
		? seed.series.map(cssColor)
		: [cssColor(accent)];
	return {
		background: cssColor(background),
		foreground: cssColor(foreground),
		accent: cssColor(accent),
		series,
		muted: css(seed.muted, blend(background, foreground, 0.65)),
		surface: css(seed.surface, blend(background, foreground, 0.08)),
		grid: css(seed.grid, blend(background, foreground, 0.3)),
		border: css(seed.border, blend(background, foreground, 0.2)),
		highlight: css(seed.highlight, cssColor(accent)),
		positive: css(seed.positive, base.positive),
		negative: css(seed.negative, base.negative),
		warning: css(seed.warning, base.warning),
		info: css(seed.info, base.info),
		axes: {
			x: css(seed.axes?.x, base.axes.x),
			y: css(seed.axes?.y, base.axes.y),
			z: css(seed.axes?.z, base.axes.z),
		},
		ramp: seed.ramp?.length
			? seed.ramp.map(cssColor)
			: [cssColor(background), cssColor(accent)],
	};
}

/**
 * Builds a `Palette` from per-mode seeds. A palette given one mode uses it for
 * both; given neither, it throws — there is nothing to draw with.
 *
 * The result is an ordinary value: pass it wherever a {@link PaletteSpec} is
 * accepted. Nothing is registered, so there is no name to look it up by.
 *
 * @param input - Name, per-mode seeds and optional sizing defaults.
 * @returns The fully resolved palette.
 * @throws If neither `dark` nor `light` is given.
 *
 * @category Theming
 */
export function definePalette(input: PaletteInput): Palette {
	const dark = input.dark ?? input.light;
	const light = input.light ?? input.dark;
	if (!dark || !light) {
		throw new Error(
			`Palette "${input.name}" needs at least one of \`dark\` or \`light\`.`,
		);
	}
	return {
		name: input.name,
		dark: completePalette(dark, "dark"),
		light: completePalette(light, "light"),
		defaults: { ...DEFAULT_THEME_DEFAULTS, ...input.defaults },
	};
}

/**
 * Catppuccin Mocha (dark) + Latte (light) — the core default.
 *
 * @category Theming
 */
export const catppuccinPalette: Palette = definePalette({
	name: "catppuccin",
	dark: catppuccinSeed(catppuccin.mocha),
	light: catppuccinSeed(catppuccin.latte),
});

/**
 * The built-in palettes, by name. A frozen constant: nothing registers into
 * it, so importing this module has no side effects and two libraries (or two
 * stages) can never fight over a name. A custom palette is a value —
 * `palette={definePalette({ ... })}` — not an entry here.
 *
 * @category Theming
 */
export const palettes: Readonly<Record<PaletteName, Palette>> = Object.freeze({
	catppuccin: catppuccinPalette,
});

/**
 * Name of the built-in default palette: `"catppuccin"`.
 *
 * @category Theming
 */
export const DEFAULT_PALETTE_NAME: PaletteName = "catppuccin";

const paletteResolver = createResolver<Palette>("palette", palettes);

/**
 * Resolves a palette spec: a built-in {@link PaletteName} looks up
 * {@link palettes}, a `Palette` object (typically from {@link definePalette})
 * passes through. Pure and non-reactive; the default is the constant
 * {@link catppuccinPalette}.
 *
 * @param spec - Built-in name or palette object. Defaults to Catppuccin.
 * @returns The palette.
 * @throws If a string is not a built-in palette name (the message lists them).
 *
 * @category Theming
 */
export function resolvePalette(spec?: PaletteSpec): Palette {
	return paletteResolver.resolve(spec ?? catppuccinPalette);
}

// A palette resolved for a mode is cached so repeated resolution hands back the
// same `Theme` object — the renderer compares themes by identity to know
// whether a frame needs its style state rebuilt.
const themeCache = new WeakMap<Palette, Partial<Record<ColorMode, Theme>>>();

/**
 * A palette resolved for one mode. Stable identity per (palette, mode).
 *
 * @param palette - A resolved palette.
 * @param mode - `"light"` or `"dark"`.
 * @returns The cached {@link Theme}.
 *
 * @category Theming
 */
export function paletteTheme(palette: Palette, mode: ColorMode): Theme {
	const byMode = themeCache.get(palette) ?? {};
	themeCache.set(palette, byMode);
	const theme = byMode[mode] ?? {
		name: palette.name,
		mode,
		palette: palette[mode],
		defaults: palette.defaults,
	};
	byMode[mode] = theme;
	return theme;
}
