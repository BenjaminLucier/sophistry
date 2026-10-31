/**
 * Catppuccin, the default palette: `mocha` (dark) and `latte` (light). The raw
 * swatches are exported for custom palettes, and `catppuccinSeed` maps them to
 * semantic tokens (`base` ground, `text` ink, `blue` accent, and a `series` that
 * alternates warm and cool hues). Values from https://catppuccin.com/palette.
 */

import type { ThemePalette } from "./types";

/**
 * The 26 named swatches of one Catppuccin flavour, as CSS hex strings.
 *
 * @category Theming
 */
export interface CatppuccinFlavor {
	rosewater: string;
	flamingo: string;
	pink: string;
	mauve: string;
	red: string;
	maroon: string;
	peach: string;
	yellow: string;
	green: string;
	teal: string;
	sky: string;
	sapphire: string;
	blue: string;
	lavender: string;
	text: string;
	subtext1: string;
	subtext0: string;
	overlay2: string;
	overlay1: string;
	overlay0: string;
	surface2: string;
	surface1: string;
	surface0: string;
	base: string;
	mantle: string;
	crust: string;
}

const mocha: CatppuccinFlavor = {
	rosewater: "#f5e0dc",
	flamingo: "#f2cdcd",
	pink: "#f5c2e7",
	mauve: "#cba6f7",
	red: "#f38ba8",
	maroon: "#eba0ac",
	peach: "#fab387",
	yellow: "#f9e2af",
	green: "#a6e3a1",
	teal: "#94e2d5",
	sky: "#89dceb",
	sapphire: "#74c7ec",
	blue: "#89b4fa",
	lavender: "#b4befe",
	text: "#cdd6f4",
	subtext1: "#bac2de",
	subtext0: "#a6adc8",
	overlay2: "#9399b2",
	overlay1: "#7f849c",
	overlay0: "#6c7086",
	surface2: "#585b70",
	surface1: "#45475a",
	surface0: "#313244",
	base: "#1e1e2e",
	mantle: "#181825",
	crust: "#11111b",
};

const latte: CatppuccinFlavor = {
	rosewater: "#dc8a78",
	flamingo: "#dd7878",
	pink: "#ea76cb",
	mauve: "#8839ef",
	red: "#d20f39",
	maroon: "#e64553",
	peach: "#fe640b",
	yellow: "#df8e1d",
	green: "#40a02b",
	teal: "#179299",
	sky: "#04a5e5",
	sapphire: "#209fb5",
	blue: "#1e66f5",
	lavender: "#7287fd",
	text: "#4c4f69",
	subtext1: "#5c5f77",
	subtext0: "#6c6f85",
	overlay2: "#7c7f93",
	overlay1: "#8c8fa1",
	overlay0: "#9ca0b0",
	surface2: "#acb0be",
	surface1: "#bcc0cc",
	surface0: "#ccd0da",
	base: "#eff1f5",
	mantle: "#e6e9ef",
	crust: "#dce0e8",
};

/**
 * The two Catppuccin flavours used by the library: `mocha` (dark) and `latte` (light).
 *
 * @category Theming
 */
export const catppuccin = { mocha, latte } as const;

/**
 * Maps a Catppuccin flavour onto the library's semantic tokens.
 *
 * @param c - A flavour, e.g. `catppuccin.mocha`.
 * @returns A complete {@link ThemePalette}, usable as a seed in {@link PaletteInput}.
 *
 * @category Theming
 */
export function catppuccinSeed(c: CatppuccinFlavor): ThemePalette {
	return {
		background: c.base,
		foreground: c.text,
		muted: c.subtext0,
		accent: c.blue,
		series: [
			c.blue,
			c.peach,
			c.green,
			c.mauve,
			c.yellow,
			c.teal,
			c.pink,
			c.red,
		],
		surface: c.surface0,
		grid: c.overlay0,
		border: c.surface2,
		highlight: c.yellow,
		positive: c.green,
		negative: c.red,
		warning: c.peach,
		info: c.sky,
		axes: { x: c.red, y: c.green, z: c.blue },
		ramp: [c.base, c.blue, c.mauve, c.pink],
	};
}
