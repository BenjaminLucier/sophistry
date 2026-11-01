/**
 * Resolving the active theme: palette × mode.
 *
 * The one function every consumer funnels through — `<Stage>` for its subtree,
 * `useTheme()` for a component outside any stage, tests for a known theme.
 */

import { colorMode } from "./mode.js";
import { paletteTheme, resolvePalette } from "./palette.js";
import type { ColorMode, PaletteSpec, Theme } from "./types.js";

/**
 * Inputs to {@link resolveTheme}, and the shape of the `theme` / `palette` /
 * `mode` props on `<Stage>`. Every field is optional; an empty spec means
 * "the default palette in the page's current mode".
 *
 * @category Theming
 */
export interface ThemeSpec {
	/** A fully-built theme, used as-is. Wins over `palette` and `mode`. */
	theme?: Theme;
	/** Built-in palette name or palette object. Defaults to Catppuccin. */
	palette?: PaletteSpec;
	/** Defaults to the page's current mode (`<html data-mode>`). */
	mode?: ColorMode;
}

/**
 * Resolves a {@link ThemeSpec} to the concrete {@link Theme} components read.
 *
 * Precedence: `spec.theme` if given, otherwise `spec.palette` (or the default
 * palette) resolved for `spec.mode` (or the page's current mode).
 *
 * Reads the page's colour mode unless the spec pins `mode`. The read does not
 * subscribe: to follow the page between light and dark, resolve again when
 * {@link colorModeReadable} changes (or `derive` from it).
 *
 * @param spec - What to resolve; omit for the default palette in the current mode.
 * @returns The resolved theme. Stable identity per (palette, mode).
 * @throws If `spec.palette` is a string that is not a built-in palette name.
 * @see {@link definePalette}
 * @see {@link colorMode}
 * @see {@link colorModeReadable}
 *
 * @category Theming
 */
export function resolveTheme(spec: ThemeSpec = {}): Theme {
	if (spec.theme) return spec.theme;
	return paletteTheme(resolvePalette(spec.palette), spec.mode ?? colorMode());
}
