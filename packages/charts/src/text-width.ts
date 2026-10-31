/** Text measurement for chart layout: the one place marks ask how wide a label is. Internal to the charts. */

import { DEFAULT_FONT_WEIGHT, measureLabel } from "@sophistry/core/internal";

/**
 * The advance width of `text` at `fontSize`, in scene units, as `label`
 * draws it: measured on a canvas where there is one, else estimated.
 *
 * @param fontFamily - The theme's `defaults.fontFamily`.
 * @param fontWeight - Defaults to `label`'s, 500.
 */
export function textWidth(
	text: string,
	fontSize: number,
	fontFamily: string,
	fontWeight = DEFAULT_FONT_WEIGHT,
): number {
	return measureLabel(text, {
		fontSize,
		fontFamily,
		fontWeight,
		italic: false,
		letterSpacing: 0,
	}).width;
}
