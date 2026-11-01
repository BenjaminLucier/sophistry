/**
 * How one `progress` becomes a staggered per-datum reveal, and the orders a
 * stagger runs in: by position, by a hash of the key, or a grid's reading
 * order. Pure; internal to the charts.
 */

import type { BandKey, Range } from "@sophistry/core/geometry";
import { clamp01, hashUnit } from "@sophistry/core/internal";
import type { StaggerOrder } from "./props.js";

/**
 * One datum's share of a reveal staggered across `count` data: start times
 * spread over `spread` of the reveal, each datum taking `1 - spread`, so the
 * last ends at `progress = 1` and 5 or 500 bars take equally long.
 *
 * @param rank - This datum's place in the reveal order, 0-based.
 * @param spread - 0 (all together) to just under 1 (one after another).
 * @returns This datum's own progress, 0..1.
 */
export function staggered(
	progress: number,
	rank: number,
	count: number,
	spread: number,
): number {
	const s = Math.min(0.95, Math.max(0, spread || 0));
	if (s === 0 || count <= 1) return clamp01(progress);
	const start = (s * rank) / (count - 1);
	return clamp01((progress - start) / (1 - s));
}

/** Each value's 0-based place in ascending order: the left-to-right reveal order. Ties keep data order; non-finite values go last. */
export function ranks(values: readonly number[]): number[] {
	const key = (v: number) =>
		Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
	const order = values
		.map((_, index) => index)
		.sort((a, b) => key(values[a]) - key(values[b]) || a - b);
	const rank: number[] = [];
	order.forEach((index, r) => {
		rank[index] = r;
	});
	return rank;
}

/** Each key's place in a "random" reveal order: ascending by a hash of the key, so it looks shuffled but is the same every frame and when scrubbed. */
export function hashRanks(keys: readonly BandKey[]): number[] {
	return ranks(keys.map((key) => hashUnit(key, 0x5eed)));
}

/**
 * Each key's place in a stagger by `staggerOrder`: by key hash under
 * `"random"`, else ascending by `position` (non-finite last, ties in key
 * order).
 *
 * @param order - Omitted, `"position"`.
 * @returns `rank[i]` for `keys[i]`.
 */
export function orderRanks(
	keys: readonly BandKey[],
	order: StaggerOrder | undefined,
	position: (key: BandKey, index: number) => number,
): number[] {
	return order === "random"
		? hashRanks(keys)
		: ranks(keys.map((key, i) => position(key, i)));
}

/** Which axes run backwards on screen (a range given end first, or `reverse`), for {@link readingRanks}. */
export function reversedAxes(
	xRange: Readonly<Range>,
	yRange: Readonly<Range>,
): { x: boolean; y: boolean } {
	return { x: xRange[1] < xRange[0], y: yRange[1] < yRange[0] };
}

/**
 * Each cell's place in screen reading order: top row first, each row left to
 * right. Cells sharing a `y` are one row; ties keep data order.
 *
 * @param cells - One position per cell that is the same across a row, in data units.
 * @param reversed - Axes that run backwards on screen ({@link reversedAxes}).
 * @returns `rank[i]` for cell `i`.
 */
export function readingRanks(
	cells: readonly { readonly x: number; readonly y: number }[],
	reversed?: { readonly x?: boolean; readonly y?: boolean },
): number[] {
	const down = reversed?.y ? -1 : 1;
	const across = reversed?.x ? -1 : 1;
	const order = cells
		.map((_, index) => index)
		.sort(
			(a, b) =>
				down * (cells[b].y - cells[a].y) ||
				across * (cells[a].x - cells[b].x) ||
				a - b,
		);
	const rank: number[] = [];
	order.forEach((index, r) => {
		rank[index] = r;
	});
	return rank;
}

/** Above this many cells a grid fades in as one, unstaggered. */
export const GRID_STAGGER_LIMIT = 2000;

/** A gridded layer's stagger: the one given, else 0.5, dropped to 0 above {@link GRID_STAGGER_LIMIT} cells. */
export function gridStagger(
	stagger: number | undefined,
	count: number,
): number {
	if (stagger !== undefined) return stagger;
	return count > GRID_STAGGER_LIMIT ? 0 : 0.5;
}
