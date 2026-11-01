/**
 * The `ramp` prop shared by `<Imshow>`, `<ContourF>`, `<Pcolormesh>` and
 * `<VectorField>`: an explicit stop list, a colormap name, or a caller's own
 * `(t) => string` (told apart by `Array.isArray` and `typeof`).
 */

import type { ColorInput } from "../color/index.js";
import type { Colormap, ColormapSpec } from "../themes/index.js";
import { colorRamp, resolveColormap } from "../themes/index.js";

/**
 * An explicit stop list, a published colormap's name, or a caller's own ramp function.
 *
 * @category Colour
 */
export type ColorRampSpec = readonly ColorInput[] | ColormapSpec;

/**
 * Whether a `ramp` prop is an explicit stop list rather than a colormap name
 * or function (`Array.isArray` does not narrow a `readonly` array).
 */
export function isStopList(
	spec: ColorRampSpec | undefined,
): spec is readonly ColorInput[] {
	return Array.isArray(spec);
}

/**
 * Resolves a `ramp` prop to a `Colormap`, calling `fallbackStops()` (usually two
 * theme colours) only when it is omitted.
 */
export function resolveColorRamp(
	spec: ColorRampSpec | undefined,
	fallbackStops: () => readonly ColorInput[],
): Colormap {
	if (spec === undefined) return colorRamp(fallbackStops());
	if (isStopList(spec)) return colorRamp(spec);
	return resolveColormap(spec);
}
