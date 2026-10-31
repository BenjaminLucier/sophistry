/** Sizes and gaps for a chart's guides, shared by `chart` and a group's guides so they match. */

import { mix } from "@sophistry/core/internal";

/** An axis title's font size when none is given. */
export const AXIS_LABEL_FONT_SIZE = 0.34;
/** The gap between an axis's numbers and its title. */
export const AXIS_LABEL_GAP = 0.22;
/** The title's font size when none is given. */
export const TITLE_FONT_SIZE = 0.42;
/** The gap under the title. */
export const TITLE_GAP = 0.35;
/** The gap between the plotting area and a legend beside or above it. */
export const LEGEND_GAP = 0.35;
/** The gap between the colour legend and the size key under (or beside) it. */
export const KEYS_GAP = 0.25;
/** The colour bar's thickness. */
export const COLORBAR_THICKNESS = 0.22;

/**
 * Half a line of text at `fontSize` (a line is `1.2` of it): from a line's
 * edge to its middle, as a rotated title stands off the edge it reads along.
 */
export function halfLine(fontSize: number): number {
	return fontSize * 0.6;
}

/** A key's laid-out size, and how present it is (0 at a transition end with no legend), scaling the gap before it. */
export interface KeyExtent {
	width: number;
	height: number;
	presence: number;
}

/** A key's size at each end of a keyed transition (`to` only when the ends differ). */
export interface KeyEnds {
	from: KeyExtent;
	to: KeyExtent | undefined;
}

/** Two laid-out boxes of the same size (or both none). */
export function sameKeyExtent(
	a: KeyExtent | undefined,
	b: KeyExtent | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.width === b.width && a.height === b.height && a.presence === b.presence
	);
}

export function sameKeyEnds(
	a: KeyEnds | undefined,
	b: KeyEnds | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return sameKeyExtent(a.from, b.from) && sameKeyExtent(a.to, b.to);
}

/** A key's size now: its own end's, or blended between the ends by the update stage's progress `u`. */
export function keyExtentNow(
	ends: KeyEnds | undefined,
	u: () => number,
): KeyExtent | undefined {
	if (!ends?.to) return ends?.from;
	const at = u();
	return {
		width: mix(ends.from.width, ends.to.width, at),
		height: mix(ends.from.height, ends.to.height, at),
		presence: mix(ends.from.presence, ends.to.presence, at),
	};
}
