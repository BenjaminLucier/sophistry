/**
 * Gauge geometry: where a value sits on a gauge's arc, and how threshold
 * bands divide it. Angles are radians from +x, counter-clockwise positive;
 * a gauge reads clockwise, so its default `endAngle` is less than its
 * `startAngle`.
 */

/**
 * The default gauge start, 210° from +x: with {@link GAUGE_END_ANGLE}, a 240°
 * arc opening downward, symmetric about 12 o'clock.
 *
 * @category Math & helpers
 */
export const GAUGE_START_ANGLE = (7 * Math.PI) / 6;

/**
 * The default gauge end: 120° clockwise of 12 o'clock (−30° from +x).
 *
 * @category Math & helpers
 */
export const GAUGE_END_ANGLE = -Math.PI / 6;

/**
 * Where `value` sits between `min` and `max`, clamped to 0..1. A non-finite
 * value, or `max <= min`, reads as 0.
 *
 * @category Math & helpers
 */
export function gaugeFraction(value: number, min: number, max: number): number {
	if (!Number.isFinite(value) || !(max > min)) return 0;
	const t = (value - min) / (max - min);
	return t > 0 ? (t < 1 ? t : 1) : 0;
}

/**
 * The angle at `fraction` (not clamped) of the way along a gauge's arc.
 *
 * @param startAngle - Defaults to {@link GAUGE_START_ANGLE}.
 * @param endAngle - Defaults to {@link GAUGE_END_ANGLE}.
 * @category Math & helpers
 */
export function gaugeAngle(
	fraction: number,
	startAngle = GAUGE_START_ANGLE,
	endAngle = GAUGE_END_ANGLE,
): number {
	return startAngle + (endAngle - startAngle) * fraction;
}

/**
 * One resolved threshold band of a gauge.
 *
 * @category Math & helpers
 */
export interface GaugeBandSpan {
	/** Position in the input `bands` array. */
	index: number;
	/** Where the band starts, in data units (the previous band's end, or `min`). */
	from: number;
	/** Where the band ends, in data units, clamped to `[min, max]`. */
	to: number;
	/** `from` as a fraction of the arc, 0..1. */
	startFraction: number;
	/** `to` as a fraction of the arc, 0..1. */
	endFraction: number;
}

/**
 * Resolves threshold bands, each given by where it ends, into arc spans:
 * band `i` runs from band `i - 1`'s end (or `min`) to its `to`, clamped to
 * `[min, max]`; `to: Infinity` runs to the end. Out-of-order bands keep zero
 * width so `index` stays aligned.
 *
 * @returns One {@link GaugeBandSpan} per band, or `[]` when `max <= min`.
 * @category Math & helpers
 */
export function gaugeBands(
	bands: readonly { readonly to: number }[],
	min: number,
	max: number,
): GaugeBandSpan[] {
	if (!(max > min)) return [];
	const spans: GaugeBandSpan[] = [];
	let from = min;
	for (let index = 0; index < bands.length; index++) {
		const raw = bands[index].to;
		const to = Number.isNaN(raw) ? from : Math.min(max, Math.max(from, raw));
		spans.push({
			index,
			from,
			to,
			startFraction: (from - min) / (max - min),
			endFraction: (to - min) / (max - min),
		});
		from = to;
	}
	return spans;
}

/**
 * Which band `value` falls in: the first non-empty band ending at or past
 * it, so a value on a threshold belongs to the band it closes.
 *
 * @returns The band's `index`, or -1 when none reaches the value or it is not finite.
 * @category Math & helpers
 */
export function gaugeBandIndex(
	value: number,
	spans: readonly GaugeBandSpan[],
): number {
	if (!Number.isFinite(value) || spans.length === 0) return -1;
	const min = spans[0].from;
	for (const span of spans) {
		if (span.to <= span.from) continue;
		if (Math.max(min, value) <= span.to) return span.index;
	}
	return -1;
}
