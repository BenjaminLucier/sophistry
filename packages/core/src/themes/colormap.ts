/**
 * Named colormaps for `resolveColormap` (a name, or a caller's own
 * `(t) => string`; see `geometry/resolver.ts`).
 *
 * Control points are sampled from the published tables (BIDS/colormap for
 * viridis, magma, plasma, inferno; matplotlib for cividis and coolwarm;
 * Mikhailov's turbo LUT; ColorBrewer RdBu) and interpolated in OKLCH. The
 * endpoints and midpoint are exact; the tests check them.
 */

import { createResolver } from "../geometry/resolver";
import { type ColorRampOptions, colorRamp } from "./ramp";

/**
 * A colormap: magnitude in `[0, 1]` → a CSS colour.
 *
 * @category Colormaps & ramps
 */
export type Colormap = (t: number) => string;

/**
 * The hex anchors behind each built-in colormap: nine evenly-spaced stops per
 * map (eleven for `rdbu`, two for `grey`), in ascending `t` order — see this file's module doc for where each table came
 * from and why nine rather than the full 256-entry LUT.
 *
 * @category Colormaps & ramps
 */
export const colormapStops = {
	viridis: [
		"#440154",
		"#472d7b",
		"#3b528b",
		"#2c728e",
		"#21918c",
		"#28ae80",
		"#5ec962",
		"#addc30",
		"#fde725",
	],
	magma: [
		"#000004",
		"#1d1147",
		"#51127c",
		"#832681",
		"#b73779",
		"#e75263",
		"#fc8961",
		"#fec488",
		"#fcfdbf",
	],
	plasma: [
		"#0d0887",
		"#4c02a1",
		"#7e03a8",
		"#aa2395",
		"#cc4778",
		"#e66c5c",
		"#f89540",
		"#fdc527",
		"#f0f921",
	],
	inferno: [
		"#000004",
		"#210c4a",
		"#57106e",
		"#8a226a",
		"#bc3754",
		"#e45a31",
		"#f98e09",
		"#f9cb35",
		"#fcffa4",
	],
	cividis: [
		"#00224e",
		"#1a386f",
		"#434e6c",
		"#61656f",
		"#7d7c78",
		"#9b9476",
		"#bcae6c",
		"#dec958",
		"#fee838",
	],
	turbo: [
		"#30123b",
		"#466be3",
		"#28bceb",
		"#32f298",
		"#a4fc3c",
		"#eecf3a",
		"#fb7e21",
		"#d02f05",
		"#7a0403",
	],
	coolwarm: [
		"#3b4cc0",
		"#6282ea",
		"#8db0fe",
		"#b8d0f9",
		"#dddddd",
		"#f5c4ad",
		"#f49a7b",
		"#de604d",
		"#b40426",
	],
	rdbu: [
		"#67001f",
		"#b2182b",
		"#d6604d",
		"#f4a582",
		"#fddbc7",
		"#f7f7f7",
		"#d1e5f0",
		"#92c5de",
		"#4393c3",
		"#2166ac",
		"#053061",
	],
	grey: ["#000000", "#ffffff"],
} satisfies Record<string, string[]>;

/**
 * Names of the nine built-in colormaps.
 *
 * @category Colormaps & ramps
 */
export type ColormapName = keyof typeof colormapStops;

/** `colorRamp`'s options, minus `colorSpace` — every built-in map picks its own
 * (see the module doc); a caller building a custom map still has the choice.
 *
 * @category Colormaps & ramps
 */
export type ColormapOptions = ColorRampOptions;

function buildColormap(name: ColormapName): Colormap {
	return colorRamp(colormapStops[name] as unknown as string[], {
		colorSpace: "oklch",
	});
}

/**
 * The nine built-in colormaps by name: `viridis`, `magma`, `plasma`,
 * `inferno`, `cividis`, `turbo`, `coolwarm`, `rdbu`, `grey`. Each maps `t` in
 * `[0, 1]` to a CSS colour string, interpolating in OKLCH.
 *
 * @category Colormaps & ramps
 */
export const colormaps: Readonly<Record<ColormapName, Colormap>> =
	Object.freeze({
		viridis: buildColormap("viridis"),
		magma: buildColormap("magma"),
		plasma: buildColormap("plasma"),
		inferno: buildColormap("inferno"),
		cividis: buildColormap("cividis"),
		turbo: buildColormap("turbo"),
		coolwarm: buildColormap("coolwarm"),
		rdbu: buildColormap("rdbu"),
		grey: buildColormap("grey"),
	});

const colormapResolver = createResolver<Colormap>("colormap", colormaps, {
	caseInsensitive: true,
});

/**
 * A colormap given as a function (`colorRamp([...])`, or any `(t) => string`)
 * or the name of a built-in in {@link colormaps} (case-insensitive: `"Viridis"`
 * and `"RdBu"` resolve). Custom colormaps are passed
 * as values, never registered under a name; a name outside the closed
 * {@link ColormapName} union is a type error and, at runtime, throws from
 * {@link resolveColormap} listing the built-ins.
 *
 * @category Colormaps & ramps
 */
export type ColormapSpec = Colormap | ColormapName;

/**
 * A name is sugar for a function — `resolveEasing`, for colormaps. `spec`
 * falsy (`undefined`) returns `fallback` (default `viridis`, the map this
 * package's own defaults should reach for when nothing else is said, being
 * the best-known and most colour-vision-deficiency-robust of the set).
 *
 * @param spec - A colormap function, or a built-in name.
 * @throws If `spec` is a string that is not a built-in colormap name.
 * @param fallback - Used when `spec` is falsy. Defaults to `viridis`.
 * @returns A function from `t` in `[0, 1]` to a CSS colour string.
 *
 * @category Colormaps & ramps
 */
export function resolveColormap(
	spec: ColormapSpec | undefined,
	fallback: Colormap = colormaps.viridis,
): Colormap {
	if (!spec) return fallback;
	return colormapResolver.resolve(spec);
}
