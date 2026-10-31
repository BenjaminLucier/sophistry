/**
 * Where a bar's value label goes, in scene units: centred inside the bar
 * and whether it fits there, and which bar of a stack carries the stack's
 * total past its outer end.
 *
 * @category Math & helpers
 */

import type { Bounds } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { mix } from "@sophistry/core/internal";

/** A label's size in scene units: its advance width and ink height. */
export interface BarLabelSize {
	width: number;
	height: number;
}

/** How far past first fitting (as a fraction of the label's length) the bar grows before its label is fully opaque. */
export const INSIDE_LABEL_FADE = 0.5;

/**
 * How visible a label centred inside a bar is, 0..1: 0 while the bar is too
 * small for the label plus `pad`, rising to 1 as it grows past that, and 1
 * at full length whenever the label fits. A label never shows ahead of its
 * growing segment.
 *
 * @param box - The bar now (mid-reveal or mid-transition).
 * @param rest - The bar at full length on this frame.
 * @param pad - Room kept between the label and each edge.
 * @param vertical - Whether the bar runs up the y axis.
 * @category Math & helpers
 */
export function insideLabelFit(
	box: Bounds,
	rest: Bounds,
	size: BarLabelSize,
	pad: number,
	vertical: boolean,
): number {
	const along = (b: Bounds) => (vertical ? b.maxY - b.minY : b.maxX - b.minX);
	const across = (b: Bounds) => (vertical ? b.maxX - b.minX : b.maxY - b.minY);
	const needAlong = (vertical ? size.height : size.width) + 2 * pad;
	const needAcross = (vertical ? size.width : size.height) + 2 * pad;
	if (!(needAlong > 0) || !(needAcross > 0)) return 0;
	const now = along(box);
	if (!(across(box) >= needAcross) || !(now >= needAlong)) return 0;
	if (now >= along(rest) - 1e-9) return 1;
	return Math.min(1, (now - needAlong) / (INSIDE_LABEL_FADE * needAlong));
}

/**
 * One bar's share in its stack's total: the total of its side of zero, and
 * whether it is that side's outermost segment (the one the total is
 * written past).
 *
 * @category Math & helpers
 */
export interface StackTotal {
	/** The sum of the segments on this bar's side of zero, in data units. */
	total: number;
	/** Whether this bar ends its side of the stack. */
	outer: boolean;
}

/**
 * Each stacked bar's {@link StackTotal}: segments grouped by category and
 * sign, each side's total carried by the segment reaching furthest its way.
 * Zero and non-finite segments belong to no side (`undefined`).
 *
 * @param own - Each bar's own signed value.
 * @param ends - Where each bar ends on the value axis (the stack's `y2`).
 * @category Math & helpers
 */
export function stackTotals(
	categories: readonly unknown[],
	own: readonly number[],
	ends: readonly number[],
): (StackTotal | undefined)[] {
	const sides = new Map<unknown, { total: number; outer: number }>();
	const sideKey = (category: unknown, sign: number) =>
		`${sign > 0 ? "+" : "-"}${typeof category}:${String(category)}`;
	own.forEach((value, i) => {
		const end = ends[i];
		if (!Number.isFinite(value) || value === 0 || !Number.isFinite(end)) return;
		const key = sideKey(categories[i], value);
		const side = sides.get(key);
		if (!side) {
			sides.set(key, { total: value, outer: i });
			return;
		}
		side.total += value;
		if (value > 0 ? end > ends[side.outer] : end < ends[side.outer])
			side.outer = i;
	});
	return own.map((value, i) => {
		if (!Number.isFinite(value) || value === 0 || !Number.isFinite(ends[i]))
			return undefined;
		const side = sides.get(sideKey(categories[i], value));
		return side ? { total: side.total, outer: side.outer === i } : undefined;
	});
}

/** What a bar's labels read from its dataset. */
export interface BarLabelSide {
	/** Each bar's own value (a stacked segment's, not where it ends). */
	own: readonly number[];
	/** Where each bar ends. */
	values: readonly number[];
	/** Where each bar starts, when not at the baseline. */
	bases: readonly number[] | undefined;
	stacked: boolean;
	/** Whether the stack is of shares (`offset="normalize"`). */
	normalized: boolean;
	/** Each stacked bar's side of its stack's total. */
	totals: readonly (StackTotal | undefined)[] | undefined;
}

/** The numbers a bar's labels write: its own (a share, when normalized) and its stack's total when it ends its side. @internal */
export function barLabelValues(
	side: BarLabelSide,
	index: number,
): { share: number; total: number | undefined } {
	const total = side.totals?.[index];
	return {
		share: side.normalized
			? side.values[index] - (side.bases?.[index] ?? 0)
			: side.stacked
				? side.own[index]
				: side.values[index],
		total: total?.outer ? total.total : undefined,
	};
}

/** Two ends' label values blended at `u`; a total carried at only one end shows while that end is nearer. @internal */
export function mixBarLabelValues(
	from: { share: number; total: number | undefined },
	to: { share: number; total: number | undefined },
	u: number,
): { share: number; total: number | undefined } {
	const total =
		from.total !== undefined && to.total !== undefined
			? mix(from.total, to.total, u)
			: u < 0.5
				? from.total
				: to.total;
	return { share: mix(from.share, to.share, u), total };
}

/** Decimal places a value is written with, so a counting label keeps one width (`"1.5e-7"` has 8). @internal */
export function decimalsOf(value: number): number {
	const match = /^-?\d*(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(formatTick(value));
	if (!match) return 0;
	return Math.max(0, (match[1]?.length ?? 0) - Number(match[2] ?? 0));
}
