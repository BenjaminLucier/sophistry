/**
 * Where a value sits on an axis that may be categorical, and whether a value
 * axis has a zero for a mark to grow from. Pure; internal to the charts.
 */

import type { BandKey, BandScale, Range } from "@sophistry/core/geometry";

/**
 * Where `value` sits along an axis, in data units: a category's band centre
 * on a band axis (a number is looked up as a category first, then taken as
 * a slot coordinate), otherwise the number itself.
 *
 * @returns The position, or undefined when there is none.
 */
export function positionOf(
	band: BandScale | undefined,
	value: BandKey | null | undefined,
): number | undefined {
	if (value === null || value === undefined) return undefined;
	if (band && band.index(value) >= 0) return band.center(value);
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * The extent of a category's band, `[start, end]` in data units, or undefined
 * when there is no band axis or the category is not on it.
 */
export function bandSpan(
	band: BandScale | undefined,
	value: BandKey | null | undefined,
): [number, number] | undefined {
	if (!band || value === null || value === undefined) return undefined;
	const start = band.start(value);
	return start === undefined ? undefined : [start, start + band.bandwidth];
}

/** Whether a value axis's range contains 0 for a mark to grow from; marks on axes without one fade in instead. */
export function growsFromZero(range: Readonly<Range>): boolean {
	return Math.min(range[0], range[1]) <= 0 && Math.max(range[0], range[1]) >= 0;
}
