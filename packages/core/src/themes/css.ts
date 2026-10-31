/**
 * A palette as CSS custom properties, keyed off `<html data-mode>`.
 *
 * The DOM around a `<Stage>` — page background, text, buttons — should repaint
 * from the same tokens the canvas does, from one source: the palette. This
 * emits the raw token block (`--c-background`, `--c-foreground`, …) so an app
 * never hand-copies a hex.
 *
 * Dark is the default on `:root`, so a page with no JS, no storage or no
 * `data-mode` is dark — the same fallback `themeInitScript` uses.
 */

import { resolvePalette } from "./palette";
import type { ColorMode, PaletteSpec, ThemePalette } from "./types";

/**
 * Options for {@link paletteCss}.
 *
 * @category Theming
 */
export interface PaletteCssOptions {
	/** Variable prefix: `c` → `--c-background`. */
	prefix?: string;
}

/**
 * Flattens one mode's palette into a map of CSS custom properties.
 *
 * Plain tokens become `--c-<token>`; `series`, `ramp` and `axes` are expanded
 * to `--c-series-0`, `--c-ramp-0`, `--c-axis-x`, and so on.
 *
 * @param palette - The tokens of one mode, e.g. `resolvePalette().dark`.
 * @param prefix - Variable prefix. Defaults to `"c"`.
 * @returns A map from `--prefix-name` to CSS colour value.
 *
 * @category Theming
 */
export function paletteVariables(
	palette: ThemePalette,
	prefix = "c",
): Record<string, string> {
	const vars: Record<string, string> = {};
	const put = (name: string, value: string) => {
		vars[`--${prefix}-${name}`] = value;
	};
	for (const [key, value] of Object.entries(palette)) {
		if (typeof value === "string") put(key, value);
	}
	palette.series.forEach((color, i) => {
		put(`series-${i}`, color);
	});
	palette.ramp.forEach((color, i) => {
		put(`ramp-${i}`, color);
	});
	for (const [axis, color] of Object.entries(palette.axes)) {
		put(`axis-${axis}`, color);
	}
	return vars;
}

function block(
	selector: string,
	mode: ColorMode,
	vars: Record<string, string>,
) {
	const body = Object.entries(vars)
		.map(([name, value]) => `\t${name}: ${value};`)
		.join("\n");
	return `${selector} {\n\tcolor-scheme: ${mode};\n${body}\n}`;
}

/**
 * Builds the stylesheet that exposes a palette as CSS custom properties.
 *
 * Emits a dark block on `:root, [data-mode="dark"]` and a light block on
 * `[data-mode="light"]`, each also setting `color-scheme`. Use it so the DOM
 * around a `<Stage>` repaints from the same tokens as the canvas when
 * `<html data-mode>` flips.
 *
 * @param spec - Built-in palette name or palette object. Defaults to Catppuccin.
 * @param options - See {@link PaletteCssOptions}.
 * @returns CSS text, ready for a `<style>` element.
 * @see {@link paletteVariables}
 *
 * @category Theming
 */
export function paletteCss(
	spec?: PaletteSpec,
	options: PaletteCssOptions = {},
): string {
	const palette = resolvePalette(spec);
	const prefix = options.prefix ?? "c";
	return [
		block(
			':root, [data-mode="dark"]',
			"dark",
			paletteVariables(palette.dark, prefix),
		),
		block(
			'[data-mode="light"]',
			"light",
			paletteVariables(palette.light, prefix),
		),
	].join("\n");
}
