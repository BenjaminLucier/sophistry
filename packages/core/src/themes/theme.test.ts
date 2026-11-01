import { describe, expect, it } from "vitest";
import { catppuccin } from "./catppuccin.js";
import {
	catppuccinPalette,
	definePalette,
	palettes,
	paletteTheme,
	resolvePalette,
} from "./palette.js";
import { resolveTheme } from "./theme.js";
import type { PaletteName } from "./types.js";

describe("catppuccin", () => {
	it("is the default palette: Mocha dark, Latte light", () => {
		expect(resolveTheme({ mode: "dark" }).palette.background).toBe(
			catppuccin.mocha.base,
		);
		expect(resolveTheme({ mode: "light" }).palette.background).toBe(
			catppuccin.latte.base,
		);
		expect(resolveTheme({ mode: "dark" }).palette.foreground).toBe("#cdd6f4");
		expect(resolveTheme({ mode: "light" }).palette.foreground).toBe("#4c4f69");
	});

	it("is dark when no mode is given and there is no DOM", () => {
		expect(resolveTheme().mode).toBe("dark");
	});

	it("fills every token in both modes", () => {
		for (const mode of ["dark", "light"] as const) {
			const p = catppuccinPalette[mode];
			for (const [key, value] of Object.entries(p)) {
				expect(value, `${mode}.${key}`).toBeTruthy();
			}
			expect(p.series.length).toBeGreaterThanOrEqual(6);
		}
	});

	it("keeps x/y/z red/green/blue", () => {
		const { axes } = resolveTheme({ mode: "dark" }).palette;
		expect(axes).toEqual({
			x: catppuccin.mocha.red,
			y: catppuccin.mocha.green,
			z: catppuccin.mocha.blue,
		});
	});
});

describe("definePalette", () => {
	it("derives missing tokens from the seed", () => {
		const p = definePalette({
			name: "mini",
			dark: { background: "#000000", foreground: "#ffffff", accent: "#ff0000" },
		});
		expect(p.dark.series).toEqual(["#ff0000"]);
		expect(p.dark.highlight).toBe("#ff0000");
		expect(p.dark.ramp).toEqual(["#000000", "#ff0000"]);
		// neutrals are blends of the seed's own ground and ink
		expect(p.dark.muted).toMatch(/^rgba\(/);
		expect(p.dark.positive).toBe(catppuccin.mocha.green);
		expect(p.defaults.strokeWidth).toBeGreaterThan(0);
	});

	it("takes status/axis fallbacks from the flavour matching the background lightness", () => {
		const lightFiledAsDark = definePalette({
			name: "odd",
			dark: { background: "#ffffff", foreground: "#000000", accent: "#00f" },
		});
		expect(lightFiledAsDark.dark.positive).toBe(catppuccin.latte.green);
		const darkFiledAsLight = definePalette({
			name: "odd2",
			light: { background: "#000000", foreground: "#ffffff", accent: "#00f" },
		});
		expect(darkFiledAsLight.light.axes.x).toBe(catppuccin.mocha.red);
	});

	it("uses a single supplied mode for both", () => {
		const p = definePalette({
			name: "mono",
			light: { background: "#fff", foreground: "#000", accent: "#00f" },
		});
		expect(p.dark.background).toBe("#fff");
		expect(p.light.background).toBe("#fff");
	});

	it("throws with neither mode", () => {
		expect(() => definePalette({ name: "empty" })).toThrow(/at least one/);
	});

	it("keeps explicit tokens over derived ones", () => {
		const p = definePalette({
			name: "explicit",
			dark: {
				background: "#000",
				foreground: "#fff",
				accent: "#f00",
				grid: "#123456",
				axes: { x: "#111111" },
			},
		});
		expect(p.dark.grid).toBe("#123456");
		expect(p.dark.axes.x).toBe("#111111");
		expect(p.dark.axes.y).toBe(catppuccin.mocha.green);
	});
});

describe("palettes", () => {
	it("resolves a built-in name and passes objects through", () => {
		const palette = definePalette({
			name: "custom-value",
			dark: { background: "#010101", foreground: "#fefefe", accent: "#0f0" },
		});
		expect(resolvePalette("catppuccin")).toBe(catppuccinPalette);
		expect(resolvePalette(palette)).toBe(palette);
		expect(resolvePalette()).toBe(catppuccinPalette);
		expect(Object.keys(palettes)).toEqual(["catppuccin"]);
		expect(Object.isFrozen(palettes)).toBe(true);
	});

	it("throws for an unknown name, listing the built-ins", () => {
		expect(() => resolvePalette("nope" as PaletteName)).toThrow(
			/Unknown palette "nope".*catppuccin/,
		);
	});

	it("a custom palette value drives the theme without any registration", () => {
		const swap = definePalette({
			name: "swap",
			dark: { background: "#222222", foreground: "#fff", accent: "#f00" },
		});
		expect(
			resolveTheme({ palette: swap, mode: "dark" }).palette.background,
		).toBe("#222222");
		expect(resolveTheme({ mode: "dark" }).name).toBe("catppuccin");
	});
});

describe("resolveTheme", () => {
	it("hands back the same Theme object for the same palette and mode", () => {
		expect(resolveTheme({ mode: "dark" })).toBe(resolveTheme({ mode: "dark" }));
		expect(resolveTheme({ mode: "dark" })).not.toBe(
			resolveTheme({ mode: "light" }),
		);
	});

	it("uses a fully-built theme as-is, ignoring palette and mode", () => {
		const theme = paletteTheme(catppuccinPalette, "light");
		expect(
			resolveTheme({
				theme,
				palette: definePalette({
					name: "swap",
					dark: { background: "#222", foreground: "#fff", accent: "#f00" },
				}),
				mode: "dark",
			}),
		).toBe(theme);
	});

	it("records the mode on the theme", () => {
		expect(resolveTheme({ mode: "light" }).mode).toBe("light");
	});
});

describe("paletteCss", () => {
	it("emits dark on :root and light on [data-mode=light], from the palette", async () => {
		const { paletteCss } = await import("./css.js");
		const css = paletteCss();
		expect(css).toContain(':root, [data-mode="dark"] {');
		expect(css).toContain('[data-mode="light"] {');
		expect(css).toContain(`--c-background: ${catppuccin.mocha.base};`);
		expect(css).toContain(`--c-background: ${catppuccin.latte.base};`);
		expect(css).toContain("color-scheme: light;");
		expect(css).toContain("--c-series-0:");
		expect(css).toContain("--c-axis-x:");
	});

	it("honours a prefix", async () => {
		const { paletteCss } = await import("./css.js");
		expect(paletteCss("catppuccin", { prefix: "s" })).toContain("--s-accent:");
	});
});
