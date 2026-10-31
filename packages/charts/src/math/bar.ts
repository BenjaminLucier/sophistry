/**
 * A bar's box in data space: slot `index` occupies `[index, index + 1]`, the
 * bar `barWidth` of it, centred.
 *
 * @category Math & helpers
 */

export interface BarSlotBox {
	/** The bar's x extent (not the whole slot): `barWidth` wide, centred on the slot. */
	x0: number;
	x1: number;
	/** The bar's y extent, sorted from `baseline` and `value`, so a negative value hangs below the baseline. */
	y0: number;
	y1: number;
}

/**
 * Bar width as a fraction of the slot.
 *
 * @category Math & helpers
 */
export const DEFAULT_BAR_WIDTH = 0.6;

/**
 * One bar's box in data space at full height: `barWidth` of slot `[index,
 * index + 1]`, centred at `index + 0.5`, spanning `baseline` to `value` in
 * either order.
 *
 * @param baseline - The value the bar stands on (usually 0).
 * @param barWidth - Fraction of the slot. Defaults to {@link DEFAULT_BAR_WIDTH}.
 * @returns The box, or `null` when `value` is not finite.
 * @category Math & helpers
 */
export function barSlot(
	index: number,
	value: number,
	baseline: number,
	barWidth = DEFAULT_BAR_WIDTH,
): BarSlotBox | null {
	if (!Number.isFinite(value)) return null;
	const centre = index + 0.5;
	const half = barWidth / 2;
	return {
		x0: centre - half,
		x1: centre + half,
		y0: Math.min(baseline, value),
		y1: Math.max(baseline, value),
	};
}
