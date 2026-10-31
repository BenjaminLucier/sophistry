/**
 * Data ↔ axis-fraction mapping: the `Scale` interface and its linear, log,
 * pow/sqrt, symlog, diverging and calendar-time implementations, plus the
 * name resolver. Each `Scale` speaks in **fractions of an axis** (0..1); the
 * scene layer knows how long the axis is, so a non-linear scale drops in with
 * no change above this file. The value↔fraction math delegates to d3-scale.
 *
 * Categorical axes are `bandScale` (`geometry/band.ts`).
 */

import { scaleLog, scalePow, scaleSymlog, scaleTime, scaleUtc } from "d3-scale";
import { createResolver } from "../resolver";
import {
	fromWallTime,
	type TimeZone,
	toWallTime,
	wallTimeInstants,
} from "../time";
import type { TickFormatter } from "./tick-format";
import { axisTicks, logTicks } from "./ticks";

/**
 * A data range, as in Manim's `x_range`. The step is the major tick spacing.
 *
 * @category Value types
 */
export type Range = [min: number, max: number, step?: number];

/**
 * A value ↔ axis-fraction mapping. `toUnit` answers "how far along the axis
 * does this value sit", where 0 is the range minimum and 1 the maximum;
 * `fromUnit` is its inverse. Values outside the range map outside 0..1 rather
 * than clamping, so a graph may legitimately run off the plotting area.
 *
 * @category Scales & ticks
 */
export interface Scale {
	/** Data value to axis fraction (0 at the range minimum, 1 at the maximum). */
	toUnit(value: number): number;
	/** Axis fraction back to a data value. */
	fromUnit(fraction: number): number;
	/**
	 * The scale's own tick placement, for a scale where a uniform step is the
	 * wrong idea — decades on a log axis, calendar intervals on a time axis.
	 * {@link axisTicks} (and so every axis and grid) asks for this first and
	 * falls back to {@link tickValues} when it is absent. `count` is a target,
	 * not a promise.
	 */
	ticks?(count?: number): ScaleTicks;
	/**
	 * The scale's default tick text — a time axis writes dates, not
	 * milliseconds. An axis's own `tickFormat` still wins.
	 */
	tickFormat?: TickFormatter;
}

/**
 * Tick values in data units: majors carry numbers, minors are subdivisions.
 *
 * @category Scales & ticks
 */
export interface ScaleTicks {
	majors: number[];
	minors: number[];
}

/**
 * The straight-line mapping. A degenerate range collapses to fraction 0.
 *
 * @param range - `[min, max]` in data values; the step is ignored here.
 * @returns A {@link Scale}.
 *
 * @example
 * ```ts
 * import { linearScale } from "@sophistry/core/geometry";
 *
 * const scale = linearScale([0, 10]);
 * scale.toUnit(2.5); // 0.25
 * scale.fromUnit(0.5); // 5
 * ```
 *
 * @category Scales & ticks
 */
export function linearScale(range: Range): Scale {
	const [min, max] = range;
	if (min === max) {
		return { toUnit: () => 0, fromUnit: () => min };
	}
	// Closed form of d3's `scaleLinear().domain([min, max]).range([0, 1])`,
	// with the same arithmetic so results match bit for bit: d3 normalises
	// against the domain in ascending order (flipping a descending one), and
	// its `0 → 1` interpolation turns an infinite fraction into NaN (a break)
	// and -0 into 0. Building the d3 scale is what cost: coordinate systems
	// resolve a scale on every `coordsToPoint`. Unlike d3, which answers
	// `undefined` for NaN, a NaN value maps to NaN.
	const span = max - min;
	const toUnit =
		span > 0 || Number.isNaN(span)
			? (value: number) => {
					const unit = (value - min) / span;
					return Number.isFinite(unit) ? unit + 0 : Number.NaN;
				}
			: (value: number) => {
					const unit = (value - max) / -span;
					return Number.isFinite(unit) ? 1 - unit : Number.NaN;
				};
	return {
		toUnit,
		fromUnit: (fraction) => min * (1 - fraction) + max * fraction,
	};
}

/**
 * A logarithmic mapping — Manim's `LogBase`. The range is given in **data**
 * values, not exponents: `[1, 1000]` spans three decades.
 *
 * A range that isn't wholly positive degenerates (every value maps to 0, no
 * ticks). A non-positive *value* maps to `NaN`, which graphs treat as a break.
 *
 * @param range - `[min, max]` in data values, both positive.
 * @param base - Logarithm base. Defaults to 10.
 * @returns A {@link Scale}.
 *
 * @category Scales & ticks
 */
export function logScale(range: Range, base = 10): Scale {
	const [min, max] = range;
	const lb = Math.log(base);
	const valid =
		min > 0 && max > 0 && base > 1 && Number.isFinite(lb) && min !== max;
	if (!valid) {
		return { toUnit: () => 0, fromUnit: () => min };
	}
	// d3's own log transform maps Math.log(0) to -Infinity rather than NaN, so
	// the non-positive-value guard stays explicit here.
	const scale = scaleLog().base(base).domain([min, max]).range([0, 1]);
	return {
		toUnit: (value) => (value > 0 ? scale(value) : Number.NaN),
		fromUnit: (fraction) => scale.invert(fraction),
		ticks: () => logTicks(range, { base }),
	};
}

/**
 * A power mapping, `value ** exponent`, mirrored through zero so negative
 * values keep their sign (d3's convention). Ticks stay uniform in data space,
 * as d3's do: a sqrt axis still reads 0 / 20 / 40, just unevenly spaced.
 *
 * @param range - `[min, max]` in data values; the step is ignored here.
 * @param exponent - The power. Defaults to 1 (linear).
 * @returns A {@link Scale}.
 *
 * @category Scales & ticks
 */
export function powScale(range: Range, exponent = 1): Scale {
	const [min, max] = range;
	if (min === max || !Number.isFinite(exponent) || exponent === 0) {
		return { toUnit: () => 0, fromUnit: () => min };
	}
	const scale = scalePow().exponent(exponent).domain([min, max]).range([0, 1]);
	return {
		toUnit: (value) => scale(value),
		fromUnit: (fraction) => scale.invert(fraction),
	};
}

/**
 * `powScale(range, 0.5)` — the scale to size things by when their *area*
 * should be proportional to the value, so a bubble twice the value looks
 * twice as big rather than four times.
 *
 * @param range - `[min, max]` in data values.
 * @returns A {@link Scale}.
 *
 * @category Scales & ticks
 */
export function sqrtScale(range: Range): Scale {
	return powScale(range, 0.5);
}

/**
 * A symmetric log mapping (d3's `scaleSymlog`): linear near zero, logarithmic
 * further out, and defined for zero and negatives — the scale for data
 * spanning orders of magnitude on both sides of zero, where `"log"` cannot go.
 *
 * @param range - `[min, max]` in data values; any sign.
 * @param constant - Width of the linear region around zero. Defaults to 1.
 * @returns A {@link Scale}.
 *
 * @category Scales & ticks
 */
export function symlogScale(range: Range, constant = 1): Scale {
	const [min, max] = range;
	if (min === max) {
		return { toUnit: () => 0, fromUnit: () => min };
	}
	const scale = scaleSymlog()
		.constant(constant > 0 ? constant : 1)
		.domain([min, max])
		.range([0, 1]);
	return {
		toUnit: (value) => scale(value),
		fromUnit: (fraction) => scale.invert(fraction),
	};
}

/**
 * The mappings a {@link divergingScale}'s two halves may use.
 *
 * @category Scales & ticks
 */
export type DivergingKind = "linear" | "log" | "sqrt" | "symlog";

/**
 * Options for {@link divergingScale}.
 *
 * @category Scales & ticks
 */
export interface DivergingScaleOptions {
	/**
	 * The mapping inside each half: `"linear"` (the default; matplotlib's
	 * `TwoSlopeNorm`), `"log"` (a ratio centred on 1, say), `"sqrt"` or
	 * `"symlog"`.
	 */
	kind?: DivergingKind;
	/**
	 * The log base when `kind` is `"log"`; it only moves the ticks.
	 * @default 10
	 */
	base?: number;
}

/**
 * A two-slope mapping around a centre — matplotlib's `TwoSlopeNorm`, Vega-Lite's
 * `domainMid`: `[min, center]` fills the first half (fraction 0 to 0.5) and
 * `[center, max]` the second (0.5 to 1), each half through its own `kind`
 * mapping, so the centre always lands mid-way however lopsided the range.
 * Use it to colour a diverging colormap so its neutral colour sits on the centre.
 * Each half ticks on its own, with the centre always a tick. Keep the centre
 * inside the range.
 *
 * @param range - `[min, max]` in data values.
 * @param center - The value that maps to 0.5.
 * @param options - See {@link DivergingScaleOptions}.
 * @returns A {@link Scale} with its own `ticks`.
 *
 * @example
 * ```ts
 * import { divergingScale } from "@sophistry/core/geometry";
 *
 * const scale = divergingScale([-2, 10], 0);
 * scale.toUnit(-2); // 0
 * scale.toUnit(0); // 0.5
 * scale.toUnit(5); // 0.75
 * ```
 *
 * @category Scales & ticks
 */
export function divergingScale(
	range: Range,
	center: number,
	options: DivergingScaleOptions = {},
): Scale {
	const [min, max] = range;
	const kind = options.kind ?? "linear";
	const base = options.base ?? 10;
	const half = (a: number, b: number): Scale =>
		kind === "log"
			? logScale([a, b], base)
			: kind === "sqrt"
				? sqrtScale([a, b])
				: kind === "symlog"
					? symlogScale([a, b])
					: linearScale([a, b]);
	const lower = half(min, center);
	const upper = half(center, max);
	const lowerFlat = min === center;
	const upperFlat = max === center;
	return {
		toUnit: (value) => {
			if (Number.isNaN(value)) return Number.NaN;
			if (value <= center) return lowerFlat ? 0.5 : 0.5 * lower.toUnit(value);
			return upperFlat ? 0.5 : 0.5 + 0.5 * upper.toUnit(value);
		},
		fromUnit: (fraction) =>
			fraction <= 0.5
				? lowerFlat
					? center
					: lower.fromUnit(fraction * 2)
				: upperFlat
					? center
					: upper.fromUnit(fraction * 2 - 1),
		ticks: (count = 6) => {
			const each = Math.max(2, Math.round(count / 2));
			const lo = Math.min(min, center);
			const hi = Math.max(max, center);
			const majors = new Set<number>([center]);
			const minors = new Set<number>();
			const add = (scale: Scale, a: number, b: number) => {
				if (!(b > a)) return;
				const ticks = axisTicks(scale, [a, b], { count: each });
				for (const value of ticks.majors) majors.add(value);
				for (const value of ticks.minors) minors.add(value);
			};
			add(lower, min, center);
			add(upper, center, max);
			const inside = (value: number) => value >= lo && value <= hi;
			const sorted = (values: Set<number>) =>
				[...values].filter(inside).sort((a, b) => a - b);
			return {
				majors: sorted(majors),
				minors: sorted(minors).filter((value) => !majors.has(value)),
			};
		},
	};
}

/**
 * Options for {@link timeScale}.
 *
 * @category Scales & ticks
 */
export interface TimeScaleOptions {
	/**
	 * Calendar arithmetic in UTC rather than the viewer's local time zone.
	 * UTC is the default because it renders the same everywhere, on a server
	 * and in a test; pass `false` for wall-clock ticks. A `timeZone` wins.
	 *
	 * @default true
	 */
	utc?: boolean;
	/**
	 * The zone whose calendar the ticks follow and whose clocks the labels
	 * read: an IANA name (`"America/New_York"`), `"UTC"` or `"local"`. Ticks
	 * land on that zone's midnights, month starts and hours, through
	 * daylight saving time (a day tick after the clocks change is 23 or 25
	 * hours on). Omitted, `utc` decides between `"UTC"` and `"local"`.
	 */
	timeZone?: TimeZone;
}

/** Ticks a time axis asks for when the caller names no count. */
const DEFAULT_TIME_TICKS = 6;

const DAY = 86_400_000;

/**
 * A time axis's calendar over `[lo, hi]` in one zone: its ticks, its niced
 * ends and its formats, all in epoch milliseconds.
 *
 * UTC and the viewer's own zone are d3's `scaleUtc` and `scaleTime`. Any
 * other zone is d3's UTC calendar run on *wall time* ({@link toWallTime}):
 * d3 picks the interval and steps it on the zone's clock readings, where
 * every day has 24 hours, and each tick comes back through
 * {@link wallTimeInstants}. A wall time skipped as clocks spring forward
 * moves on by the gap (a tick at 02:00 lands on 03:00, and repeats are
 * dropped); one that happens twice as they go back is both instants for
 * ticks under a day apart (two "01 AM"s, as d3's local hours give), its
 * first otherwise. Labels are d3's formats on the wall time, so `%Z`/`%z`
 * would read UTC's.
 *
 * @internal
 */
export interface CalendarAxis {
	/** Ticks inside `[lo, hi]`, ascending. */
	ticks(count: number): number[];
	/** `[lo, hi]` stretched to calendar boundaries in the zone. */
	nice(count: number): [number, number];
	/** d3's multi-scale tick format, or a d3-time-format `specifier`, written in the zone. */
	format(count?: number, specifier?: string): (value: number) => string;
}

/** @internal See {@link CalendarAxis}. */
export function calendarAxis(
	lo: number,
	hi: number,
	timeZone: TimeZone,
): CalendarAxis {
	if (hi < lo) [lo, hi] = [hi, lo];
	if (timeZone === "local") {
		const scale = scaleTime().domain([new Date(lo), new Date(hi)]);
		return {
			ticks: (count) => scale.ticks(count).map((date) => date.getTime()),
			nice: (count) => {
				const [start, end] = scale.copy().nice(count).domain();
				return [start.getTime(), end.getTime()];
			},
			format: (count, specifier) => {
				const format = scale.tickFormat(count, specifier);
				return (value) => format(new Date(value));
			},
		};
	}
	const wall = scaleUtc().domain([
		new Date(toWallTime(lo, timeZone)),
		new Date(toWallTime(hi, timeZone)),
	]);
	return {
		ticks: (count) => {
			const walls = wall.ticks(count).map((date) => date.getTime());
			const subDay = walls.length > 1 && walls[1] - walls[0] < DAY;
			const instants = new Set<number>();
			for (const at of walls) {
				const all = wallTimeInstants(at, timeZone);
				if (all.length === 0) instants.add(fromWallTime(at, timeZone));
				else for (const t of subDay ? all : all.slice(0, 1)) instants.add(t);
			}
			return [...instants]
				.filter((t) => t >= lo && t <= hi)
				.sort((a, b) => a - b);
		},
		nice: (count) => {
			const [start, end] = wall.copy().nice(count).domain();
			return [
				fromWallTime(start.getTime(), timeZone),
				fromWallTime(end.getTime(), timeZone),
			];
		},
		format: (count, specifier) => {
			const format = wall.tickFormat(count, specifier);
			return (value) => format(new Date(toWallTime(value, timeZone)));
		},
	};
}

/**
 * A time mapping over milliseconds since the epoch (`Date.getTime()`), with
 * calendar-aware ticks — whole days, months, years — instead of round
 * numbers of milliseconds, and dates as its default tick text ("2024",
 * "Feb", "Mar 03", "12 PM", chosen per tick by d3's multi-scale format).
 * Calendar arithmetic is UTC's by default; a `timeZone` puts the ticks on
 * that zone's wall-clock boundaries and writes its labels in it.
 *
 * Data stays numeric (`date.getTime()`); a zone moves the ticks, never the data.
 *
 * @param range - `[min, max]` in epoch milliseconds; the step is ignored.
 * @param options - See {@link TimeScaleOptions}.
 * @returns A {@link Scale} with `ticks` and `tickFormat`.
 *
 * @example
 * ```ts
 * import { timeScale } from "@sophistry/core/geometry";
 *
 * const scale = timeScale([Date.UTC(2024, 0, 1), Date.UTC(2024, 11, 31)]);
 * scale.ticks?.().majors.map((t) => scale.tickFormat?.(t)); // ["2024", "Mar", "May", ...]
 *
 * // Midnights in New York, 23 hours apart where the clocks go forward.
 * const ny = timeScale([Date.UTC(2024, 2, 9, 5), Date.UTC(2024, 2, 12, 4)], {
 *   timeZone: "America/New_York",
 * });
 * ny.ticks?.().majors; // [Mar 9 05:00Z, Mar 10 05:00Z, Mar 11 04:00Z, Mar 12 04:00Z] in ms
 * ```
 *
 * @category Scales & ticks
 */
export function timeScale(range: Range, options: TimeScaleOptions = {}): Scale {
	const [min, max] = range;
	if (!(Number.isFinite(min) && Number.isFinite(max)) || min === max) {
		return {
			toUnit: () => 0,
			fromUnit: () => min,
			ticks: () => ({ majors: [], minors: [] }),
		};
	}
	const scale = scaleUtc()
		.domain([new Date(min), new Date(max)])
		.range([0, 1]);
	const calendar = calendarAxis(
		min,
		max,
		options.timeZone ?? (options.utc === false ? "local" : "UTC"),
	);
	const format = calendar.format();
	return {
		// An instant's place along the axis does not depend on the zone.
		toUnit: (value) => scale(new Date(value)),
		fromUnit: (fraction) => scale.invert(fraction).getTime(),
		ticks: (count = DEFAULT_TIME_TICKS) => ({
			majors: calendar.ticks(count),
			minors: [],
		}),
		tickFormat: format,
	};
}

/**
 * How a caller picks a mapping: a name, or a `Scale` they built themselves.
 *
 * @category Scales & ticks
 */
export type ScaleSpec = ScaleName | Scale;

/**
 * The scales {@link resolveScale} knows by name. `"time"` is local time and
 * `"utc"` UTC (unless a time zone is named, which either then reads in);
 * both take ranges in epoch milliseconds.
 *
 * @category Scales & ticks
 */
export type ScaleName = "linear" | "log" | "sqrt" | "symlog" | "time" | "utc";

/**
 * The named scales aren't `Scale`s themselves — each needs `range` (and `log`
 * needs `base`) before it becomes one — so the frozen map this resolver looks
 * names up in holds *constructors*, `(range, base) => Scale`, rather than
 * values. `resolveScale` is otherwise the same shape as the package's other
 * five resolvers: a string looks up a named constructor (and throws, listing
 * valid names, if it doesn't recognise one), anything else — a caller's own
 * `Scale` — passes through unchanged.
 */
const scaleConstructors = Object.freeze({
	linear: (range: Range) => linearScale(range),
	log: (range: Range, base: number) => logScale(range, base),
	sqrt: (range: Range) => sqrtScale(range),
	symlog: (range: Range) => symlogScale(range),
	time: (range: Range, _base: number, timeZone?: TimeZone) =>
		timeScale(range, { utc: false, timeZone }),
	utc: (range: Range, _base: number, timeZone?: TimeZone) =>
		timeScale(range, { timeZone }),
} satisfies Record<
	ScaleName,
	(range: Range, base: number, timeZone?: TimeZone) => Scale
>);

const scaleResolver = createResolver<
	(range: Range, base: number, timeZone?: TimeZone) => Scale
>("scale", scaleConstructors);

/**
 * Resolves a `ScaleSpec` against a range. `base` applies only to `"log"`,
 * `timeZone` only to `"time"` and `"utc"`.
 *
 * @param spec - A scale name, a ready-made {@link Scale}, or undefined for linear.
 * @param range - Data range the scale should cover.
 * @param base - Log base. Defaults to 10.
 * @param timeZone - A time scale's zone, see {@link TimeScaleOptions.timeZone}.
 * @returns The scale. An unknown name throws, listing the valid ones.
 *
 * @category Scales & ticks
 */
export function resolveScale(
	spec: ScaleSpec | undefined,
	range: Range,
	base = 10,
	timeZone?: TimeZone,
): Scale {
	if (spec === undefined) return linearScale(range);
	if (typeof spec === "string")
		return scaleResolver.resolve(spec)(range, base, timeZone);
	return spec;
}
