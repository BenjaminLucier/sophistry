/** Axis ranging for data plotted from raw values rather than a function. */

import type { Range, ScaleName, TimeZone } from "@sophistry/core/geometry";
import { niceStep } from "@sophistry/core/geometry";
import {
	axisTimeZone,
	calendarAxis,
	maxOf,
	minOf,
} from "@sophistry/core/internal";

/** @category Math */
export interface AutoRangeOptions {
	/** Roughly how many ticks the rounded range should offer. @default 5 */
	targetTicks?: number;
}

const DEFAULT_TARGET_TICKS = 5;
/** Under `nice: "tight"`, the most a fitted end may pass the data by, in tick steps. */
const TIGHT_SLACK = 0.25;

/** `nice: "tight"` rounding: `low`/`high` are the data's ends, `lo`/`hi` the nice ones, `step` the tick step. */
function tighten(
	low: number,
	high: number,
	lo: number,
	hi: number,
	step: number,
): [number, number] {
	const slack = TIGHT_SLACK * step * (1 + 1e-9);
	return [low - lo <= slack ? lo : low, hi - high <= slack ? hi : high];
}

/**
 * Rounds a data span out to a whole number of nice steps, always including
 * zero (an axis starting at 90 exaggerates differences). For charts whose
 * caller gave no explicit range.
 *
 * @param values - The data the axis must cover; non-finite entries are ignored.
 * @returns `[min, max, step]` containing 0; `[0, 1, 1]` when there is no spread.
 * @category Math & helpers
 */
export function autoRange(
	values: readonly number[],
	options: AutoRangeOptions = {},
): Range {
	return fitRange(values, { zero: true, targetTicks: options.targetTicks });
}

/**
 * Options for {@link fitRange}.
 *
 * @category Math & helpers
 */
export interface FitRangeOptions {
	/**
	 * The scale the range is for, which decides what "round" means: a 1-2-5
	 * step for linear, sqrt and symlog, whole decades for log, calendar units
	 * for time and utc.
	 * @default "linear"
	 */
	type?: ScaleName;
	/**
	 * Stretch the range to include zero, for marks whose length encodes value
	 * (bars, areas, histograms). Ignored by log and time scales.
	 * @default false
	 */
	zero?: boolean;
	/**
	 * Round the ends out to tick values. `false` keeps the data's ends;
	 * `"tight"` rounds an end out only when the next tick is within a quarter
	 * step of the data (weeks 0–11 fit `[0, 11]`, not `[0, 15]`).
	 * @default true
	 */
	nice?: boolean | "tight";
	/** Roughly how many ticks the rounded range should offer. @default 5 */
	targetTicks?: number;
	/** Log base, when `type` is `"log"`. @default 10 */
	base?: number;
	/**
	 * The zone whose calendar a time range rounds to: an IANA name, `"UTC"` or
	 * `"local"`. Omitted, `"utc"` rounds in UTC and `"time"` in local time.
	 */
	timeZone?: TimeZone;
	/**
	 * Pad the data's extent by this fraction of its span on each side before
	 * rounding; a side pinned at zero by `zero` stays there. Ignored by log.
	 * @default 0
	 */
	margin?: number;
}

/**
 * The range an axis should span to show `values`: their extent, stretched to
 * zero if asked, rounded out to ticks for the scale type. This is how
 * `<Chart>` fits its axes. Non-finite values (and non-positive ones on a
 * log scale) are ignored; one value or none still gets a usable span.
 *
 * @returns `[min, max, step]` on a nice linear-family range, `[min, max]` otherwise.
 * @category Math & helpers
 */
export function fitRange(
	values: readonly number[],
	options: FitRangeOptions = {},
): Range {
	const type = options.type ?? "linear";
	const usable = values.filter((v) =>
		type === "log" ? v > 0 && Number.isFinite(v) : Number.isFinite(v),
	);
	const dataMin = usable.length > 0 ? minOf(usable) : undefined;
	const dataMax = usable.length > 0 ? maxOf(usable) : undefined;

	if (type === "log")
		return fitLog(dataMin, dataMax, options.base ?? 10, options.nice);
	if (type === "time" || type === "utc") {
		return fitTime(
			dataMin,
			dataMax,
			axisTimeZone(type, options.timeZone),
			options,
		);
	}

	let low = dataMin ?? 0;
	let high = dataMax ?? 0;
	if (options.zero) {
		low = Math.min(0, low);
		high = Math.max(0, high);
	}
	[low, high] = padded(low, high, options.margin, options.zero);
	if (low === high) {
		// Nothing to fit: an all-zero (or empty) axis reads 0..1, and a lone
		// value gets room either side so it is not drawn on the frame.
		if (low === 0) return [0, 1, 1];
		const pad = Math.abs(low) * 0.1;
		low -= options.zero && low >= 0 ? 0 : pad;
		high += options.zero && high <= 0 ? 0 : pad;
	}
	if (options.nice === false) return [low, high];
	const step = niceStep(
		high - low,
		options.targetTicks ?? DEFAULT_TARGET_TICKS,
	);
	const lo = Math.floor(low / step) * step;
	const hi = Math.ceil(high / step) * step;
	if (options.nice === "tight")
		return [...tighten(low, high, lo, hi, step), step];
	return [lo, hi, step];
}

/**
 * Options for {@link alignedRange}.
 *
 * @category Math & helpers
 */
export interface AlignedRangeOptions {
	/** Keep zero in range (bars, areas). @default false */
	zero?: boolean;
	/**
	 * Pad the data's extent by this fraction of its span first, as {@link FitRangeOptions.margin}.
	 * @default 0
	 */
	margin?: number;
	/** The two axes run opposite ways (one is reversed). @default false */
	opposite?: boolean;
}

/** Nice step mantissas for an aligned axis. */
const ALIGNED_MANTISSAS = [1, 2, 2.5, 5];

/**
 * A secondary axis range whose ticks fall exactly where the primary's do,
 * so one grid serves both: the same number of tick intervals, with the
 * smallest nice step (1, 2, 2.5 or 5 × 10ⁿ) that covers `values`. Linear
 * axes only.
 *
 * @param primary - The primary axis's range, `[min, max, step?]` (either order).
 * @param primaryTicks - The primary's major tick values, evenly spaced (at least two).
 * @param values - The data the secondary axis must show.
 * @returns `[min, max, step]` ascending, or undefined when the primary has fewer than two ticks.
 * @category Math & helpers
 */
export function alignedRange(
	primary: Range,
	primaryTicks: readonly number[],
	values: readonly number[],
	options: AlignedRangeOptions = {},
): Range | undefined {
	const a = Math.min(primary[0], primary[1]);
	const b = Math.max(primary[0], primary[1]);
	const span = b - a;
	const ticks = primaryTicks.filter((t) => Number.isFinite(t));
	if (!(span > 0) || !Number.isFinite(span) || ticks.length < 2)
		return undefined;
	const first = minOf(ticks);
	const last = maxOf(ticks);
	// Tick spacing and the lowest tick's offset, as fractions of the axis.
	const unit = (last - first) / (ticks.length - 1) / span;
	if (!(unit > 0)) return undefined;
	const offset = options.opposite ? (b - last) / span : (first - a) / span;
	/** The lowest tick's offset in tick intervals, 0..1. */
	const phase = offset / unit - Math.floor(offset / unit + 1e-9);

	const usable = values.filter((v) => Number.isFinite(v));
	let low = usable.length > 0 ? minOf(usable) : 0;
	let high = usable.length > 0 ? maxOf(usable) : 0;
	if (options.zero) {
		low = Math.min(0, low);
		high = Math.max(0, high);
	}
	[low, high] = padded(low, high, options.margin, options.zero);
	if (low === high) {
		if (low === 0) high = 1;
		else {
			const pad = Math.abs(low) * 0.1;
			low -= options.zero && low >= 0 ? 0 : pad;
			high += options.zero && high <= 0 ? 0 : pad;
		}
	}
	// The axis spans `step / unit`; the smallest step that covers the data.
	const least = (high - low) * unit;
	let exponent = Math.floor(Math.log10(least)) - 1;
	const round = (value: number) => Number(value.toPrecision(12)) + 0;
	for (let tries = 0; tries < 40; tries++, exponent++) {
		for (const mantissa of ALIGNED_MANTISSAS) {
			const step = mantissa * 10 ** exponent;
			if (step < least * (1 - 1e-9)) continue;
			const length = step / unit;
			// Ticks sit on multiples of the step; the lowest one `phase` of a
			// step above the axis's start.
			const k = Math.floor(low / step + phase + 1e-9);
			const start = step * (k - phase);
			if (start + length >= high - Math.abs(high) * 1e-12)
				return [round(start), round(start + length), step];
		}
	}
	return undefined;
}

/** `[low, high]` widened by `margin` of its span each side; a side held at zero stays put. */
function padded(
	low: number,
	high: number,
	margin: number | undefined,
	zero: boolean | undefined,
): [number, number] {
	const span = high - low;
	if (!(margin && margin > 0) || !(span > 0)) return [low, high];
	const pad = span * margin;
	return [
		zero && low === 0 ? low : low - pad,
		zero && high === 0 ? high : high + pad,
	];
}

/** Whole decades around the data; one decade, `[1, base]`, when there is none. */
function fitLog(
	dataMin: number | undefined,
	dataMax: number | undefined,
	base: number,
	nice: boolean | "tight" | undefined,
): Range {
	if (dataMin === undefined || dataMax === undefined || !(base > 1)) {
		return [1, base > 1 ? base : 10];
	}
	const lb = Math.log(base);
	if (nice === "tight" && dataMax > dataMin) {
		// In decades: an end rounds out only when the next power is close.
		const low = Math.log(dataMin) / lb;
		const high = Math.log(dataMax) / lb;
		const [lo, hi] = tighten(
			low,
			high,
			Math.floor(low + 1e-9),
			Math.ceil(high - 1e-9),
			1,
		);
		// The data's own ends exactly, not through a log round trip.
		return [
			lo === low ? dataMin : base ** lo,
			hi === high ? dataMax : base ** hi,
		];
	}
	// The epsilon keeps an exact power (1000) from rounding out to the next decade.
	const low = base ** Math.floor(Math.log(dataMin) / lb + 1e-9);
	let high = base ** Math.ceil(Math.log(dataMax) / lb - 1e-9);
	if (high <= low) high = low * base;
	return [low, high];
}

const DAY = 86_400_000;

/** The data's extent in epoch milliseconds, niced to calendar units. */
function fitTime(
	dataMin: number | undefined,
	dataMax: number | undefined,
	timeZone: TimeZone,
	options: FitRangeOptions,
): Range {
	if (dataMin === undefined || dataMax === undefined) return [0, DAY];
	let low = dataMin;
	let high = dataMax;
	if (low === high) {
		low -= DAY / 2;
		high += DAY / 2;
	}
	[low, high] = padded(low, high, options.margin, false);
	if (options.nice === false) return [low, high];
	const count = options.targetTicks ?? DEFAULT_TARGET_TICKS;
	const [start, end] = calendarAxis(low, high, timeZone).nice(count);
	if (options.nice === "tight") {
		// The calendar step the niced axis ticks at, as a length.
		const ticks = calendarAxis(start, end, timeZone).ticks(count);
		const step =
			ticks.length > 1
				? (ticks[ticks.length - 1] - ticks[0]) / (ticks.length - 1)
				: end - start;
		return tighten(low, high, start, end, step);
	}
	return [start, end];
}
