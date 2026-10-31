/**
 * Tick placement: nice steps, linear and log tick values, the per-scale
 * `axisTicks` dispatch, and label thinning.
 *
 * These stay hand-rolled rather than d3-array's: d3 rounds to different
 * 1-2-5 breakpoints (√2/√10/√50, not ≤1/≤2/≤5) and lacks the NaN/0/Infinity
 * fallbacks and `limit`-based thinning this codebase relies on — swapping
 * them would silently change every axis's tick spacing.
 */

import type { Range, Scale, ScaleTicks } from "./scales";

/**
 * Options for {@link logTicks}.
 *
 * @category Scales & ticks
 */
export interface LogTickOptions {
	/**
	 * Logarithm base.
	 *
	 * @default 10
	 */
	base?: number;
	/**
	 * Cap on majors; excess decades are thinned by stride.
	 * @default 500
	 */
	limit?: number;
}

/**
 * Ticks for a log axis: decades as majors, and the 2…(base−1) multiples inside
 * each decade as minors.
 *
 * Both are clipped to the range. Zoomed inside a decade, the integer multiples
 * (or the 1, 2, 3 and 5 multiples) become the majors, and a very narrow window
 * falls back to about five uniform ticks.
 *
 * @param range - `[min, max]` in data values, both positive; otherwise nothing is returned.
 * @param options - Base and cap.
 * @returns Major ticks (powers of the base) and minor ticks (multiples within each decade), in data values. Minors are omitted when majors were thinned.
 *
 * @category Scales & ticks
 */
export function logTicks(
	range: Range,
	options: LogTickOptions = {},
): { majors: number[]; minors: number[] } {
	const base = options.base ?? 10;
	const min = Math.min(range[0], range[1]);
	const max = Math.max(range[0], range[1]);
	if (!(min > 0) || !(max > 0) || !(base > 1))
		return { majors: [], minors: [] };

	const lb = Math.log(base);
	const first = Math.floor(Math.log(min) / lb);
	const last = Math.ceil(Math.log(max) / lb);
	const within = (value: number) =>
		value >= min * (1 - 1e-9) && value <= max * (1 + 1e-9);

	const decades: number[] = [];
	const limit = options.limit ?? MAX_TICKS;
	const span = last - first + 1;
	const stride = span > limit ? Math.ceil(span / limit) : 1;
	for (let e = first; e <= last; e += stride) decades.push(base ** e);

	const majors = decades.filter(within);
	if (majors.length < 2) return logTicksInsideDecade(min, max, base, decades);
	const minors: number[] = [];
	// Only worth drawing when every decade is present; a thinned axis has no
	// room for subdivisions anyway.
	if (stride === 1) {
		for (const decade of decades) {
			for (let multiple = 2; multiple < base; multiple++) {
				// Snapped like `tickValues`, so 0.1 * 3 reads 0.3, not 0.30000000000000004.
				const value = snap(decade * multiple, significantPlaces(decade));
				if (within(value)) minors.push(value);
			}
		}
	}
	return { majors, minors };
}

/** Decades in view above which a zoomed log axis labels only some multiples. */
const LOG_SUBSET_SPAN = 0.4;

/** The multiples a log axis spanning more than {@link LOG_SUBSET_SPAN} decades labels. */
const LOG_LABELLED_MULTIPLES = new Set([1, 2, 3, 5]);

/** Fewer in-range multiples than this and a log axis falls back to uniform ticks. */
const LOG_MIN_MULTIPLES = 3;

/**
 * {@link logTicks} for a range with fewer than two powers of the base in it
 * (an axis zoomed inside a decade), which would otherwise write at most one
 * number. The integer multiples in range become the majors, as matplotlib's
 * log formatter labels them: all of them when the range spans at most 0.4
 * of a decade, else the 1, 2, 3 and 5 multiples, the rest staying minors.
 * With fewer than three multiples in range (a narrow window, or a base with
 * none), uniform ticks of about five steps instead, as d3's log scale falls
 * back to linear ticks.
 */
function logTicksInsideDecade(
	min: number,
	max: number,
	base: number,
	decades: readonly number[],
): { majors: number[]; minors: number[] } {
	const within = (value: number) =>
		value >= min * (1 - 1e-9) && value <= max * (1 + 1e-9);
	const multiples: { value: number; multiple: number }[] = [];
	for (const decade of decades) {
		for (let multiple = 1; multiple < base; multiple++) {
			const value = snap(decade * multiple, significantPlaces(decade));
			if (within(value)) multiples.push({ value, multiple });
		}
	}
	if (multiples.length < LOG_MIN_MULTIPLES) {
		const step = niceStep(max - min, 5);
		return { majors: tickValues([min, max], { step }), minors: [] };
	}
	const span = Math.log(max / min) / Math.log(base);
	const labelled =
		span <= LOG_SUBSET_SPAN || base !== 10
			? multiples
			: multiples.filter((tick) => LOG_LABELLED_MULTIPLES.has(tick.multiple));
	const majors = (labelled.length >= 2 ? labelled : multiples).map(
		(tick) => tick.value,
	);
	const kept = new Set(majors);
	return {
		majors,
		minors: multiples
			.map((tick) => tick.value)
			.filter((value) => !kept.has(value)),
	};
}

/**
 * Beyond this a tick sequence is thinned rather than returned whole. A range
 * and a step are two independent numbers, so `[0, 1, 1e-6]` is one typo away
 * from a million `<Line>` nodes; a coarse axis is a better failure than a
 * wedged renderer.
 */
const MAX_TICKS = 500;

/**
 * Options for {@link tickValues} and {@link tickStep}.
 *
 * @category Scales & ticks
 */
export interface TickOptions {
	/** Overrides the range's own step. */
	step?: number;
	/**
	 * Target tick count when neither the range nor `step` names a step.
	 *
	 * @default 10
	 */
	count?: number;
	/**
	 * Cap on the returned count; excess is thinned by stride.
	 * @default 500
	 */
	limit?: number;
}

/**
 * A "nice" step covering `span` in roughly `count` ticks: 1, 2, or 5 times a
 * power of ten, so an axis reads 0 / 0.5 / 1 rather than 0 / 0.4286 / 0.8571.
 *
 * @param span - Length of the range (sign ignored).
 * @param count - Target number of ticks. Defaults to 10.
 * @returns The step; 1 if `span` is zero or not finite.
 *
 * @category Scales & ticks
 */
export function niceStep(span: number, count = 10): number {
	const rough = Math.abs(span) / Math.max(1, count);
	if (!(rough > 0) || !Number.isFinite(rough)) return 1;
	const power = 10 ** Math.floor(Math.log10(rough));
	const normalised = rough / power;
	const nice =
		normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
	return nice * power;
}

/**
 * The step a range will actually use: explicit if given, otherwise "nice".
 *
 * @param range - `[min, max, step?]`.
 * @param options - `step` overrides the range's own; `count` feeds the nice-step search.
 *
 * @category Scales & ticks
 */
export function tickStep(range: Range, options: TickOptions = {}): number {
	const explicit = options.step ?? range[2];
	if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
		return explicit;
	}
	return niceStep(range[1] - range[0], options.count);
}

/**
 * Decimal places worth keeping for a value built from `step`.
 *
 * Eight places past the step's own magnitude is far more precision than any
 * axis shows, and far less than the ~16 where binary representation error
 * lives — so rounding here erases `0.30000000000000004` without touching a
 * genuinely awkward step like 1/3.
 */
function significantPlaces(step: number): number {
	if (!Number.isFinite(step) || step === 0) return 0;
	const exponent = Math.floor(Math.log10(Math.abs(step)));
	// Capped well above 12 so a tiny step (< 1e-12) keeps distinct ticks;
	// the cap only exists to keep `10 ** places` finite.
	return Math.min(300, Math.max(0, 8 - exponent));
}

function snap(value: number, places: number): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

/**
 * The tick values for a range, in ascending order.
 *
 * Ticks land on multiples of the step (so 0 is a tick whenever it is in range),
 * each computed as `index * step` so they never drift.
 *
 * @param range - `[min, max, step?]` in data values (order does not matter).
 * @param options - Step, target count, and cap.
 * @returns Ascending values; empty if the range is not finite.
 *
 * @example
 * ```ts
 * import { tickValues } from "@sophistry/core/geometry";
 *
 * tickValues([-1, 1, 0.5]); // [-1, -0.5, 0, 0.5, 1]
 * ```
 *
 * @category Scales & ticks
 */
export function tickValues(range: Range, options: TickOptions = {}): number[] {
	const min = Math.min(range[0], range[1]);
	const max = Math.max(range[0], range[1]);
	const step = tickStep(range, options);
	if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];

	// A hair of slack so an endpoint that *should* land on a step isn't pushed
	// outside by the last bit of the division that put it there.
	const epsilon = step * 1e-9;
	const first = Math.ceil((min - epsilon) / step);
	const last = Math.floor((max + epsilon) / step);
	if (last < first) return [];

	const places = significantPlaces(step);
	const count = last - first + 1;
	const limit = options.limit ?? MAX_TICKS;
	const stride = count > limit ? Math.ceil(count / limit) : 1;

	const values: number[] = [];
	for (let i = first; i <= last; i += stride) {
		// `+ 0` turns -0 into 0 (`Math.ceil(-0.5)` is -0, and -0 * step stays -0).
		const value = snap(i * step, places) + 0;
		if (values.length === 0 || value !== values[values.length - 1])
			values.push(value);
	}
	return values;
}

/**
 * Options for {@link axisTicks}.
 *
 * @category Scales & ticks
 */
export interface AxisTickOptions {
	/** Major tick spacing, overriding the range's own step. Ignored by a scale with its own `ticks`. */
	step?: number;
	/** Target major count when no step is named; passed to a scale's own `ticks` too. */
	count?: number;
	/**
	 * Subdivisions between consecutive majors on a uniform axis. On a scale
	 * with its own ticks (log, time) only `0` means anything: it drops the
	 * scale's minors.
	 */
	minorTickCount?: number;
}

/**
 * The ticks an axis over `range` draws under `scale`: the scale's own when it
 * has them (decades, calendar intervals), otherwise uniform steps from
 * {@link tickValues} with `minorTickCount` subdivisions between majors.

 *
 * @param scale - The axis's mapping.
 * @param range - `[min, max, step?]` in data values.
 * @param options - See {@link AxisTickOptions}.
 * @returns Majors and minors in data values, ascending.
 *
 * @category Scales & ticks
 */
export function axisTicks(
	scale: Scale,
	range: Range,
	options: AxisTickOptions = {},
): ScaleTicks {
	const own = scale.ticks?.(options.count);
	if (own) {
		return options.minorTickCount === 0
			? { majors: own.majors, minors: [] }
			: own;
	}
	const step = tickStep(range, { step: options.step, count: options.count });
	const majors = tickValues(range, { step });
	const subdivisions = options.minorTickCount ?? 0;
	if (subdivisions <= 0) return { majors, minors: [] };
	// Both sequences sit on multiples of their own step, so "is this one a
	// major" is exact index arithmetic rather than a float comparison.
	const fine = step / (subdivisions + 1);
	const minors = tickValues(range, { step: fine }).filter(
		(value) => Math.round(value / fine) % (subdivisions + 1) !== 0,
	);
	return { majors, minors };
}

/**
 * Which tick labels to keep so none collide: the "parity" rule Vega-Lite uses.
 * While neighbours overlap, keep every second label, then every fourth, and so
 * on, so the survivors stay evenly spaced.
 *
 * @param centers - Each label's centre along the axis, in ascending order (scene units).
 * @param extents - Each label's length along the axis (scene units).
 * @param gap - Clear space wanted between neighbours. Defaults to 0.
 * @returns Indices of the labels to draw, ascending.
 *
 * @category Scales & ticks
 */
export function thinTickLabels(
	centers: readonly number[],
	extents: readonly number[],
	gap = 0,
): number[] {
	const all = centers.map((_, i) => i);
	for (let stride = 1; stride < Math.max(2, centers.length); stride *= 2) {
		const kept = all.filter((i) => i % stride === 0);
		const clear = kept.every((index, k) => {
			if (k === 0) return true;
			const previous = kept[k - 1];
			const room = Math.abs(centers[index] - centers[previous]);
			return room >= (extents[index] + extents[previous]) / 2 + gap;
		});
		if (clear) return kept;
	}
	return all.length > 0 ? [0] : [];
}
