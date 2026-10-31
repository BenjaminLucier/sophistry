/** Bullet-chart geometry: one row's scale, qualitative bands, measure bar and target marker, as data values and as fractions of the row. */

import type { Range } from "@sophistry/core/geometry";
import { clamp, niceStep, tickValues } from "@sophistry/core/geometry";
import { fitRange } from "./range";

const DEFAULT_TARGET_TICKS = 5;

/**
 * Options for {@link bulletDomain}.
 *
 * @category Math & helpers
 */
export interface BulletDomainOptions {
	/**
	 * The scale's start, in data units. Defaults to 0, or below the smallest value when one is
	 * negative.
	 */
	min?: number;
	/**
	 * The scale's end, in data units. Defaults to the largest value (0 when every value is
	 * negative).
	 */
	max?: number;
	/** Round default ends out to tick values; an explicit `min`/`max` is kept. @default true */
	nice?: boolean;
	/** Roughly how many ticks the scale should offer. @default 5 */
	targetTicks?: number;
}

/**
 * The scale one bullet (or several sharing a scale) spans: from 0, or the
 * smallest value when negative, to the largest, rounded out to ticks.
 * Non-finite values are ignored; with nothing to fit it reads `0..1`.
 *
 * @param values - Everything the scale must show: values, targets, thresholds.
 * @returns `[min, max, step]`, with `step` the tick spacing.
 * @category Math & helpers
 */
export function bulletDomain(
	values: readonly number[],
	options: BulletDomainOptions = {},
): Range {
	const targetTicks = options.targetTicks ?? DEFAULT_TARGET_TICKS;
	const fitted = fitRange(values, {
		zero: true,
		nice: options.nice !== false,
		targetTicks,
	});
	let low = Number.isFinite(options.min) ? (options.min as number) : fitted[0];
	let high = Number.isFinite(options.max) ? (options.max as number) : fitted[1];
	if (!(high > low)) {
		// An explicit end on the wrong side of the other: keep the explicit one
		// and give the scale some length rather than none.
		const span = Math.abs(fitted[1] - fitted[0]) || 1;
		if (Number.isFinite(options.max) && !Number.isFinite(options.min))
			low = high - span;
		else high = low + span;
	}
	const step =
		low === fitted[0] && high === fitted[1] && fitted[2] !== undefined
			? fitted[2]
			: niceStep(high - low, targetTicks);
	return [low, high, step];
}

/**
 * A stretch of a bullet's scale, in data units and as fractions of its
 * length (0 at the scale's start, 1 at its end).
 *
 * @category Math & helpers
 */
export interface BulletSpan {
	/** Start, in data units. */
	from: number;
	/** End, in data units. */
	to: number;
	/** `from` as a fraction of the scale, 0..1. */
	startFraction: number;
	/** `to` as a fraction of the scale, 0..1. */
	endFraction: number;
}

/**
 * One qualitative band of a bullet: a {@link BulletSpan} and its place in the
 * input `ranges`.
 *
 * @category Math & helpers
 */
export interface BulletBand extends BulletSpan {
	/** Position in the input `ranges` array: 0 is the worst band. */
	index: number;
}

/**
 * Options for {@link bulletRow}.
 *
 * @category Math & helpers
 */
export interface BulletRowOptions extends BulletDomainOptions {
	/** The comparative measure the value is judged against, in data units. */
	target?: number;
	/**
	 * Qualitative thresholds in ascending order, each where a band ends:
	 * `[150, 225, 300]` is poor to 150, satisfactory to 225, good beyond. The
	 * last band runs on to the scale's end.
	 */
	ranges?: readonly number[];
	/** Use this scale as is, ignoring `min`, `max`, `nice` and `targetTicks`, so several bullets share one ({@link bulletDomain}). */
	domain?: Range;
}

/**
 * One bullet's resolved geometry.
 *
 * @category Math & helpers
 */
export interface BulletRowGeometry {
	/** The scale, `[min, max, step]`. */
	domain: Range;
	/** Tick values along the scale, ascending. */
	ticks: number[];
	/** One band per input threshold, in input order (worst first). */
	bands: BulletBand[];
	/** Where the measure bar starts: 0, or the scale end nearest it when the scale has no zero. */
	baseline: number;
	/** Whether the scale contains zero, so the bar can grow from it (otherwise it fades in). */
	zero: boolean;
	/** The measure bar from `baseline` to the value (clamped to the scale), or null for a non-finite value. */
	measure: BulletSpan | null;
	/** The target (clamped to the scale) and its fraction, or null when there is none. */
	target: { value: number; fraction: number } | null;
}

/**
 * Resolves one bullet: scale (covering value, target and thresholds), ticks,
 * bands, measure bar and target marker, clamped to the scale. Non-finite
 * inputs drop their part; a bad threshold leaves an empty band so `index`
 * stays aligned.
 *
 * @param value - The featured measure, in data units.
 * @category Math & helpers
 */
export function bulletRow(
	value: number,
	options: BulletRowOptions = {},
): BulletRowGeometry {
	const ranges = options.ranges ?? [];
	const target = options.target;
	const domain = usableDomain(options.domain)
		? (options.domain as Range)
		: bulletDomain([value, target ?? Number.NaN, ...ranges], options);
	const lo = Math.min(domain[0], domain[1]);
	const hi = Math.max(domain[0], domain[1]);
	const fraction = (v: number) => (v - lo) / (hi - lo);
	const clampIn = (v: number) => clamp(v, lo, hi);

	const bands: BulletBand[] = [];
	let from = lo;
	ranges.forEach((raw, index) => {
		const last = index === ranges.length - 1;
		const to = Number.isNaN(raw)
			? from
			: last
				? Math.max(from, hi)
				: clampIn(Math.max(from, raw));
		bands.push({
			index,
			from,
			to,
			startFraction: fraction(from),
			endFraction: fraction(to),
		});
		from = to;
	});

	const zero = lo <= 0 && hi >= 0;
	const baseline = zero ? 0 : hi < 0 ? hi : lo;
	const measure: BulletSpan | null = Number.isFinite(value)
		? {
				from: baseline,
				to: clampIn(value),
				startFraction: fraction(baseline),
				endFraction: fraction(clampIn(value)),
			}
		: null;
	const marker =
		target !== undefined && Number.isFinite(target)
			? { value: clampIn(target), fraction: fraction(clampIn(target)) }
			: null;

	const given = domain[2];
	const step =
		given !== undefined && given > 0 && Number.isFinite(given)
			? given
			: niceStep(hi - lo, DEFAULT_TARGET_TICKS);
	return {
		domain: [lo, hi, step],
		ticks: tickValues([lo, hi], { step }),
		bands,
		baseline,
		zero,
		measure,
		target: marker,
	};
}

/** A given domain with two finite, distinct ends. */
function usableDomain(domain: Range | undefined): boolean {
	return (
		domain !== undefined &&
		Number.isFinite(domain[0]) &&
		Number.isFinite(domain[1]) &&
		domain[0] !== domain[1]
	);
}
