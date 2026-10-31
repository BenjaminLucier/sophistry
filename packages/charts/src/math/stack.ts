/**
 * Stacking: values sharing a position laid end to end as segments (stacked
 * bars and areas, streamgraphs, normalized and diverging stacks). Input is
 * one column per position, each a list of `{ series, value }` items stacked
 * in series order, then placed by the {@link StackOffset}.
 */

import { finiteOrZero } from "@sophistry/core/internal";
import { sum } from "d3-array";

/**
 * How a stack is placed: `"zero"` on the baseline; `"normalize"` each
 * column scaled to 0..1; `"center"` each column centred on zero;
 * `"wiggle"` shifted to minimise slope change between columns (a
 * streamgraph), centred overall.
 *
 * @category Math & helpers
 */
export type StackOffset = "zero" | "normalize" | "center" | "wiggle";

/**
 * Which series sits at the bottom: `"appearance"` (given or first-seen
 * order), `"reverse"`, `"sum"` (largest on top), `"insideOut"` (the
 * streamgraph order: earliest peaks in the middle), or an array of series
 * indices bottom to top (unlisted series follow).
 *
 * @category Math & helpers
 */
export type StackOrder =
	| "appearance"
	| "reverse"
	| "sum"
	| "insideOut"
	| readonly number[];

/** @category Math */
export interface StackColumnsOptions {
	/** @default "zero" */
	offset?: StackOffset;
	/** @default "appearance" */
	order?: StackOrder;
	/**
	 * Stack negatives down from the baseline and positives up, as two stacks.
	 * Off, values accumulate in one running total, so a negative dips back down.
	 * @default true
	 */
	diverging?: boolean;
	/** Where the stack starts under `"zero"`; other offsets ignore it. @default 0 */
	baseline?: number;
}

/** @category Math */
export interface StackItem {
	/** The item's series, 0-based; several items of one series in a column stack one after another. */
	series: number;
	/** Its value; a non-finite value takes no room. */
	value: number;
}

/** @category Math */
export interface StackColumnsResult {
	/** `[y1, y2]` per item, parallel to the input: segment start (towards the baseline) and end; `[NaN, NaN]` when non-finite. */
	spans: [number, number][][];
	/** Series indices, bottom of the stack to top. */
	order: number[];
}

/**
 * Stacks every column's items in series order, then places each column by
 * `offset`.
 *
 * @param columns - One item list per position, in axis order (only `"wiggle"` reads the order).
 * @param seriesCount - How many series there are; items name theirs by index.
 * @category Math & helpers
 */
export function stackColumns(
	columns: readonly (readonly StackItem[])[],
	seriesCount: number,
	options: StackColumnsOptions = {},
): StackColumnsResult {
	const offset = options.offset ?? "zero";
	const diverging = options.diverging ?? true;
	const baseline = offset === "zero" ? (options.baseline ?? 0) : 0;
	const order = stackOrder(columns, seriesCount, options.order ?? "appearance");
	const rank = new Array<number>(seriesCount).fill(seriesCount);
	order.forEach((series, k) => {
		rank[series] = k;
	});
	const rankOf = (series: number) => rank[series] ?? seriesCount;

	const spans = columns.map((column) => {
		const sequence = column
			.map((_, k) => k)
			.sort(
				(a, b) => rankOf(column[a].series) - rankOf(column[b].series) || a - b,
			);
		const out: [number, number][] = new Array(column.length);
		let up = baseline;
		let down = baseline;
		for (const k of sequence) {
			const value = column[k].value;
			if (!Number.isFinite(value)) {
				out[k] = [Number.NaN, Number.NaN];
				continue;
			}
			if (diverging && value < 0) {
				out[k] = [down, down + value];
				down += value;
			} else {
				out[k] = [up, up + value];
				up += value;
			}
		}
		return out;
	});

	if (offset === "normalize") {
		for (const column of spans) {
			const [lo, hi] = columnExtent(column);
			if (!(hi > lo)) continue;
			shiftColumn(column, (y) => (y - lo) / (hi - lo));
		}
	} else if (offset === "center") {
		for (const column of spans) {
			const [lo, hi] = columnExtent(column);
			if (!(hi >= lo)) continue;
			const mid = (lo + hi) / 2;
			shiftColumn(column, (y) => y - mid);
		}
	} else if (offset === "wiggle") {
		const base = wiggleBaselines(columns, seriesCount, rank);
		spans.forEach((column, c) => {
			shiftColumn(column, (y) => y + base[c]);
		});
		const mids = spans.flatMap((column) => {
			const [lo, hi] = columnExtent(column);
			return hi >= lo ? [(lo + hi) / 2] : [];
		});
		const mean = mids.length > 0 ? sum(mids) / mids.length : 0;
		for (const column of spans) shiftColumn(column, (y) => y - mean);
	}
	return { spans, order };
}

/**
 * Series indices bottom to top for `order`; see {@link StackOrder}.
 *
 * @returns Every series index once, bottom of the stack first.
 * @category Math & helpers
 */
export function stackOrder(
	columns: readonly (readonly StackItem[])[],
	seriesCount: number,
	order: StackOrder,
): number[] {
	const appearance = Array.from({ length: seriesCount }, (_, i) => i);
	if (Array.isArray(order)) {
		const seen = new Set<number>();
		const given = (order as readonly number[]).filter(
			(s) =>
				Number.isInteger(s) &&
				s >= 0 &&
				s < seriesCount &&
				!seen.has(s) &&
				seen.add(s),
		);
		return [...given, ...appearance.filter((s) => !seen.has(s))];
	}
	if (order === "reverse") return appearance.reverse();
	if (order === "appearance") return appearance;

	// Per series: its total, and the column where it peaks.
	const totals = new Array<number>(seriesCount).fill(0);
	const peakValue = new Array<number>(seriesCount).fill(
		Number.NEGATIVE_INFINITY,
	);
	const peakAt = new Array<number>(seriesCount).fill(0);
	columns.forEach((column, c) => {
		const perSeries = new Map<number, number>();
		for (const item of column) {
			if (item.series < 0 || item.series >= seriesCount) continue;
			perSeries.set(
				item.series,
				(perSeries.get(item.series) ?? 0) + finiteOrZero(item.value),
			);
		}
		for (const [series, value] of perSeries) {
			totals[series] += value;
			if (value > peakValue[series]) {
				peakValue[series] = value;
				peakAt[series] = c;
			}
		}
	});
	if (order === "sum") {
		return appearance.sort((a, b) => totals[a] - totals[b] || a - b);
	}
	// insideOut (d3.stackOrderInsideOut): by peak position, each added to
	// whichever side of the middle is lighter so far.
	const byPeak = appearance.sort((a, b) => peakAt[a] - peakAt[b] || a - b);
	let top = 0;
	let bottom = 0;
	const tops: number[] = [];
	const bottoms: number[] = [];
	for (const series of byPeak) {
		if (top < bottom) {
			top += totals[series];
			tops.push(series);
		} else {
			bottom += totals[series];
			bottoms.push(series);
		}
	}
	return [...bottoms.reverse(), ...tops];
}

/** The lowest and highest end of any segment in a column; `[Infinity, -Infinity]` when it has none. */
function columnExtent(column: readonly [number, number][]): [number, number] {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (const [a, b] of column) {
		if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
		lo = Math.min(lo, a, b);
		hi = Math.max(hi, a, b);
	}
	return [lo, hi];
}

function shiftColumn(column: [number, number][], map: (y: number) => number) {
	for (const span of column) {
		span[0] = map(span[0]);
		span[1] = map(span[1]);
	}
}

/** The streamgraph wiggle baseline: each column's moves by minus the value-weighted mean slope of the layers. Columns evenly spaced; values non-negative. */
function wiggleBaselines(
	columns: readonly (readonly StackItem[])[],
	seriesCount: number,
	rank: readonly number[],
): number[] {
	const n = seriesCount;
	// v[c][r]: the value of the series at rank r in column c.
	const v = columns.map((column) => {
		const row = new Array<number>(n).fill(0);
		for (const item of column) {
			const r = rank[item.series];
			if (r !== undefined && r < n) row[r] += finiteOrZero(item.value);
		}
		return row;
	});
	const base = new Array<number>(columns.length).fill(0);
	let y = 0;
	for (let c = 1; c < columns.length; c++) {
		let s1 = 0;
		let s2 = 0;
		let below = 0;
		for (let r = 0; r < n; r++) {
			const now = v[c][r];
			const change = now - v[c - 1][r];
			const s3 = change / 2 + below;
			below += change;
			s1 += now;
			s2 += s3 * now;
		}
		if (s1) y -= s2 / s1;
		base[c] = y;
	}
	return base;
}
