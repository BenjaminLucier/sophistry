/**
 * Data transforms: plain functions from rows to rows, applied to `data`
 * before it reaches a mark, composing by nesting (`stack(group(rows, ...))`).
 * Derived rows share field names (`x` position, `y` value, `z` series, the
 * input kept as `datum` or `rows`), so they chain without renaming. Dates
 * in an `x` or `by` channel are read as epoch milliseconds.
 *
 * @packageDocumentation
 */

import type { BandKey } from "@sophistry/core/geometry";
import type { Channel, PositionValue } from "../data/channels";
import { identity, indexOf, resolveChannel } from "../data/channels";
import type {
	NormalizeBasis,
	Reducer,
	RollingOptions,
} from "../math/aggregate";
import {
	normalizeValues,
	reduceValues,
	rollingValues,
} from "../math/aggregate";
import { dodgeSpan } from "../math/dodge";
import type { HistogramOptions } from "../math/histogram";
import { histogramBins } from "../math/histogram";
import { jitterOffsets } from "../math/jitter";
import { meanInterval } from "../math/regression";
import { binIndex } from "../math/shared/binning";
import type { StackItem, StackOffset } from "../math/stack";
import { stackColumns } from "../math/stack";

/** Reads a numeric channel (`Date`s as epoch milliseconds); anything not a number is `NaN`. */
function numberReader<T, V extends PositionValue = PositionValue>(
	channel: Channel<T, V> | undefined,
	name: string,
): (datum: T, index: number) => number {
	const read = resolveChannel<T, V>(channel, identity, name);
	return (d, i) => {
		const value = read(d, i);
		return typeof value === "number" ? value : Number.NaN;
	};
}

/** First-seen order of the keys, and each key's index in it. */
function keyIndex(keys: readonly unknown[]): {
	domain: unknown[];
	indexOf: Map<unknown, number>;
} {
	const indexOfKey = new Map<unknown, number>();
	const domain: unknown[] = [];
	for (const key of keys) {
		if (indexOfKey.has(key)) continue;
		indexOfKey.set(key, domain.length);
		domain.push(key);
	}
	return { domain, indexOf: indexOfKey };
}

/* ------------------------------------------------------------------ stack */

/** @category Transforms */
export interface StackOptions<T> {
	/** The position rows stack at; rows sharing an `x` stack on each other. Omitted, all rows stack in one column. */
	x?: Channel<T, BandKey | PositionValue>;
	/** The value. Defaults to the datum itself, for `number[]` data. */
	y?: Channel<T, number>;
	/** The series a row belongs to; series stack in `order`. Omitted, rows stack in data order. */
	z?: Channel<T, BandKey>;
	/**
	 * `"zero"`, `"normalize"` (each column 0..1), `"center"` or `"wiggle"` (a
	 * streamgraph). See {@link StackOffset}.
	 * @default "zero"
	 */
	offset?: StackOffset;
	/**
	 * Which series sits at the bottom: `"appearance"`, `"reverse"`, `"sum"`
	 * (largest on top), `"insideOut"`, or the series keys bottom to top.
	 * @default "appearance"
	 */
	order?: "appearance" | "reverse" | "sum" | "insideOut" | readonly BandKey[];
}

/** @category Transforms */
export interface StackedRow<T> {
	/** The input row. */
	datum: T;
	/** Its index in the input. */
	index: number;
	/** Its position, as given (undefined without `x`). */
	x: BandKey | undefined;
	/** Its series, as given (undefined without `z`). */
	z: BandKey | undefined;
	/** Its series' 0-based place in first-seen order: cycle a palette by this. */
	zIndex: number;
	/** Its value, as given. */
	y: number;
	/** Where its segment starts (towards the baseline); `NaN` when `y` is not finite. */
	y1: number;
	/** Where its segment ends; `NaN` when `y` is not finite. */
	y2: number;
}

/**
 * Stacks rows sharing an `x`, series by series, giving each a `y1` (segment
 * start) and `y2` (segment end): feed them to `bars.create({ base: "y1", value: "y2" })`
 * or any mark with lower and upper channels. Positive values stack up from
 * zero and negative ones down, so diverging stacks need nothing extra.
 *
 * @returns One {@link StackedRow} per input row, in input order.
 * @see https://sophistry.dev/guides/charts/#transforms
 * @category Transforms
 */
export function stack<T>(
	data: readonly T[],
	options: StackOptions<T> = {},
): StackedRow<T>[] {
	const readX = resolveChannel(options.x, undefined, "x");
	const readZ = resolveChannel(options.z, undefined, "z");
	const readY = numberReader(options.y, "y");
	const xs = data.map((d, i) => readX?.(d, i));
	const zs = data.map((d, i) => readZ?.(d, i));
	const ys = data.map((d, i) => readY(d, i));

	const columns = keyIndex(xs);
	if (columns.domain.every((key) => typeof key === "number")) {
		const sorted = [...(columns.domain as number[])].sort((a, b) => a - b);
		columns.indexOf = new Map(sorted.map((key, i) => [key, i]));
	}
	const series = keyIndex(zs);
	const order = options.order;
	const resolvedOrder = Array.isArray(order)
		? (order as readonly BandKey[])
				.map((key) => series.indexOf.get(key))
				.filter((i): i is number => i !== undefined)
		: (order as "appearance" | "reverse" | "sum" | "insideOut" | undefined);

	const items: StackItem[][] = Array.from(
		{ length: columns.domain.length },
		() => [],
	);
	const slot: [number, number][] = data.map((_, i) => {
		const column = columns.indexOf.get(xs[i]) ?? 0;
		items[column].push({
			series: series.indexOf.get(zs[i]) ?? 0,
			value: ys[i],
		});
		return [column, items[column].length - 1];
	});
	const { spans } = stackColumns(items, series.domain.length, {
		offset: options.offset,
		order: resolvedOrder,
	});
	return data.map((datum, index) => {
		const [column, k] = slot[index];
		const [y1, y2] = spans[column][k];
		return {
			datum,
			index,
			x: xs[index],
			z: zs[index],
			zIndex: series.indexOf.get(zs[index]) ?? 0,
			y: ys[index],
			y1,
			y2,
		};
	});
}

/* ------------------------------------------------------------------ dodge */

/** @category Transforms */
export interface DodgeOptions<T> {
	/** The category whose band the rows share; required for `compact`. */
	x?: Channel<T, BandKey | PositionValue>;
	/** The value, copied to each row as `y`. Defaults to the datum itself, for `number[]` data. */
	y?: Channel<T, number>;
	/** The series that split a band, side by side in first-seen order. */
	z: Channel<T, BandKey>;
	/** Fraction of each sub-band left empty between neighbours, 0..1. @default 0.1 */
	padding?: number;
	/**
	 * Split each band only among the series present in it. Off, every series
	 * keeps its place in every band, so it reads at the same position across
	 * categories.
	 * @default false
	 */
	compact?: boolean;
}

/** @category Transforms */
export interface DodgedRow<T> {
	datum: T;
	index: number;
	x: BandKey | undefined;
	z: BandKey;
	/** Its series' 0-based place in first-seen order. */
	zIndex: number;
	y: number;
	/** The part of its category's band this row takes, as fractions `[from, to]`: `bars.create({ subband: "subband" })`. */
	subband: [number, number];
}

/**
 * Splits each category's band among its series, for grouped bars: each row
 * gets a `subband` that `bars` (`subband`) draws.
 *
 * @returns One {@link DodgedRow} per input row, in input order.
 * @see https://sophistry.dev/guides/charts/#transforms
 * @category Transforms
 */
export function dodge<T>(
	data: readonly T[],
	options: DodgeOptions<T>,
): DodgedRow<T>[] {
	const readX = resolveChannel(options.x, undefined, "x");
	const readZ = resolveChannel<T, BandKey>(options.z, undefined, "z");
	const readY = numberReader(options.y, "y");
	const xs = data.map((d, i) => readX?.(d, i));
	const zs = data.map((d, i) => readZ(d, i));
	const series = keyIndex(zs);
	const present = new Map<unknown, number[]>();
	if (options.compact) {
		data.forEach((_, i) => {
			const list = present.get(xs[i]) ?? [];
			const s = series.indexOf.get(zs[i]) ?? 0;
			if (!list.includes(s)) list.push(s);
			present.set(xs[i], list);
		});
		for (const list of present.values()) list.sort((a, b) => a - b);
	}
	return data.map((datum, index) => {
		const zIndex = series.indexOf.get(zs[index]) ?? 0;
		const list = present.get(xs[index]);
		const subband = list
			? dodgeSpan(list.indexOf(zIndex), list.length, options.padding)
			: dodgeSpan(zIndex, series.domain.length, options.padding);
		return {
			datum,
			index,
			x: xs[index],
			z: zs[index],
			zIndex,
			y: readY(datum, index),
			subband,
		};
	});
}

/* ------------------------------------------------------------------ group */

/** @category Transforms */
export interface GroupOptions<T> {
	/** What to group by: one channel (the key becomes `x`), or two (`[x, z]`, ready for `stack` or `dodge`). */
	by:
		| Channel<T, BandKey | PositionValue>
		| readonly [
				Channel<T, BandKey | PositionValue>,
				Channel<T, BandKey | PositionValue>,
		  ];
	/** The values to reduce. Defaults to the datum itself, for `number[]` data. */
	y?: Channel<T, number>;
	/** How each group's values become its `y`. @default "count" */
	reduce?: Reducer;
}

/** @category Transforms */
export interface GroupedRow<T> {
	/** The group's (first) key. */
	x: BandKey;
	/** The group's second key, when grouped by two. */
	z: BandKey | undefined;
	/** The reduced value. */
	y: number;
	/** The input rows in the group, in input order. */
	rows: T[];
	/** Their indices in the input. */
	indexes: number[];
}

/**
 * Groups rows by one or two keys and reduces each group to one number:
 * counts per category, sums per category and series, means, medians, ...
 *
 * @returns One {@link GroupedRow} per group, in first-seen order.
 * @see https://sophistry.dev/guides/charts/#transforms
 * @category Transforms
 */
export function group<T>(
	data: readonly T[],
	options: GroupOptions<T>,
): GroupedRow<T>[] {
	const by = options.by;
	const pair = Array.isArray(by)
		? (by as readonly [
				Channel<T, BandKey | PositionValue>,
				Channel<T, BandKey | PositionValue>,
			])
		: undefined;
	const readX = resolveChannel<T, BandKey | PositionValue>(
		pair ? pair[0] : (by as Channel<T, BandKey | PositionValue>),
		undefined,
		"by",
	);
	const readZ = pair
		? resolveChannel<T, BandKey | PositionValue>(pair[1], undefined, "by")
		: undefined;
	const readY = numberReader(options.y, "y");
	const groups = new Map<unknown, Map<unknown, GroupedRow<T>>>();
	const out: GroupedRow<T>[] = [];
	const values = new Map<GroupedRow<T>, number[]>();
	data.forEach((datum, index) => {
		const x = readX(datum, index);
		const z = readZ?.(datum, index);
		let inner = groups.get(x);
		if (!inner) {
			inner = new Map();
			groups.set(x, inner);
		}
		let row = inner.get(z);
		if (!row) {
			row = { x, z, y: Number.NaN, rows: [], indexes: [] };
			inner.set(z, row);
			out.push(row);
			values.set(row, []);
		}
		row.rows.push(datum);
		row.indexes.push(index);
		values.get(row)?.push(readY(datum, index));
	});
	const reducer = options.reduce ?? "count";
	for (const row of out) row.y = reduceValues(values.get(row) ?? [], reducer);
	return out;
}

/* -------------------------------------------------------------------- bin */

/** @category Transforms */
export interface BinOptions<T, X extends PositionValue = PositionValue>
	extends HistogramOptions {
	/**
	 * The value binned along x; dates bin in equal spans of milliseconds. Defaults to the datum
	 * itself, for `number[]` data.
	 */
	x?: Channel<T, X>;
	/** The values `reduce` reads in each bin. Defaults to `x`'s. */
	y?: Channel<T, number>;
	/** How each bin's rows become its `y`. @default "count" */
	reduce?: Reducer;
}

/** @category Transforms */
export interface BinnedRow<T> {
	/** The bin's lower edge. */
	x1: number;
	/** Its upper edge. */
	x2: number;
	/** Its centre. */
	x: number;
	/** The reduced value: the count, by default. */
	y: number;
	rows: T[];
	indexes: number[];
}

/**
 * Bins rows into equal-width buckets along x (`binCount`, or a `range`
 * step) and reduces each bin: a histogram of counts, sums or means. Rows
 * with a non-finite or out-of-range `x` fall in no bin.
 *
 * @returns One {@link BinnedRow} per bin, left to right, empty bins included.
 * @see https://sophistry.dev/guides/charts/#transforms
 * @category Transforms
 */
export function bin<T, X extends PositionValue = PositionValue>(
	data: readonly T[],
	options: BinOptions<T, X> = {},
): BinnedRow<T>[] {
	const readX = numberReader(options.x, "x");
	const readY = options.y ? numberReader(options.y, "y") : readX;
	const xs = data.map((d, i) => readX(d, i));
	const { edges } = histogramBins(xs, options);
	const n = edges.length - 1;
	const min = edges[0];
	const max = edges[n];
	const bins: BinnedRow<T>[] = Array.from({ length: n }, (_, i) => ({
		x1: edges[i],
		x2: edges[i + 1],
		x: (edges[i] + edges[i + 1]) / 2,
		y: Number.NaN,
		rows: [],
		indexes: [],
	}));
	const values: number[][] = bins.map(() => []);
	xs.forEach((x, index) => {
		if (!Number.isFinite(x) || x < min || x > max) return;
		const k = binIndex(x, min, max, n);
		bins[k].rows.push(data[index]);
		bins[k].indexes.push(index);
		values[k].push(readY(data[index], index));
	});
	const reducer = options.reduce ?? "count";
	bins.forEach((b, k) => {
		b.y = reduceValues(values[k], reducer);
	});
	return bins;
}

/* -------------------------------------------------------------- summarize */

/** @category Transforms */
export interface SummarizeOptions<T> {
	/** The position rows are pooled at: rows sharing an `x` form one sample. */
	x: Channel<T, BandKey | PositionValue>;
	/** The value. Defaults to the datum itself, for `number[]` data. */
	y?: Channel<T, number>;
	/** `"ci"` (a t-based confidence interval of the mean), `"se"` or `"sd"`. @default "ci" */
	interval?: "ci" | "se" | "sd";
	/** Confidence level for `"ci"`, 0..1. @default 0.95 */
	level?: number;
}

/** @category Transforms */
export interface SummaryRow<T> {
	x: BandKey;
	/** The mean. */
	y: number;
	low: number;
	high: number;
	/** Finite values pooled. */
	n: number;
	rows: T[];
}

/**
 * Pools replicate rows by `x` into a mean and an interval around it. Draw
 * `y` with a `LinePlot` and the interval with `fillBetween` (`y1: "high", y2: "low"`) for a confidence band.
 *
 * @returns One {@link SummaryRow} per `x`: ascending when every `x` is a number, else first-seen.
 * @see https://sophistry.dev/guides/charts/#transforms
 * @category Transforms
 */
export function summarize<T>(
	data: readonly T[],
	options: SummarizeOptions<T>,
): SummaryRow<T>[] {
	const readX = resolveChannel<T, BandKey | PositionValue>(
		options.x,
		undefined,
		"x",
	);
	const readY = numberReader(options.y, "y");
	const pools = new Map<BandKey, { rows: T[]; values: number[] }>();
	data.forEach((datum, index) => {
		const x = readX(datum, index);
		const pool = pools.get(x) ?? { rows: [], values: [] };
		pool.rows.push(datum);
		pool.values.push(readY(datum, index));
		pools.set(x, pool);
	});
	const keys = [...pools.keys()];
	if (keys.every((k) => typeof k === "number"))
		(keys as number[]).sort((a, b) => a - b);
	return keys.map((x) => {
		const pool = pools.get(x) as { rows: T[]; values: number[] };
		const { mean, low, high, n } = meanInterval(
			pool.values,
			options.interval ?? "ci",
			options.level,
		);
		return { x, y: mean, low, high, n, rows: pool.rows };
	});
}

/* ------------------------------------------------------------------- maps */

/** @category Transforms */
export interface RollingTransformOptions<T> extends RollingOptions {
	/** The series, in order. Defaults to the datum itself, for `number[]` data. */
	y?: Channel<T, number>;
}

/**
 * A moving-window reduction down the rows (a rolling mean by default), in
 * the order given: one number per row, for a channel such as
 * `y={(_, i) => smooth[i]}`.
 *
 * @category Transforms
 */
export function rolling<T>(
	data: readonly T[],
	options: RollingTransformOptions<T> = {},
): number[] {
	const readY = numberReader(options.y, "y");
	return rollingValues(
		data.map((d, i) => readY(d, i)),
		options,
	);
}

/** @category Transforms */
export interface NormalizeOptions<T> {
	/** The series. Defaults to the datum itself, for `number[]` data. */
	y?: Channel<T, number>;
	/** What to normalize against. See {@link NormalizeBasis}. @default "first" */
	basis?: NormalizeBasis;
}

/**
 * Normalizes a series against a basis (its first value, sum, extent, ...):
 * one number per row.
 *
 * @category Transforms
 */
export function normalize<T>(
	data: readonly T[],
	options: NormalizeOptions<T> = {},
): number[] {
	const readY = numberReader(options.y, "y");
	return normalizeValues(
		data.map((d, i) => readY(d, i)),
		options.basis,
	);
}

/** @category Transforms */
export interface JitterTransformOptions<T> {
	/**
	 * What each row's offset hashes: something stable, such as an id. Defaults to the row's index.
	 */
	key?: Channel<T, string | number>;
	/** Total width the offsets spread over, centred on 0. @default 1 */
	width?: number;
	/** Varies the pattern. @default 0 */
	seed?: number;
}

/**
 * Seeded jitter: one offset per row in `[-width / 2, width / 2)`, hashed
 * from the row's `key` and `seed`, so it is stable across frames and scrubs.
 *
 * @category Transforms
 */
export function jitter<T>(
	data: readonly T[],
	options: JitterTransformOptions<T> = {},
): number[] {
	const readKey = resolveChannel<T, string | number>(
		options.key,
		indexOf,
		"key",
	);
	return jitterOffsets(
		data.map((d, i) => readKey(d, i)),
		options,
	);
}
