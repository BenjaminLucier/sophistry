/**
 * Instants, wall clocks and time zones for time axes. Values are instants (epoch
 * milliseconds); ticks and labels are computed on *wall time* in a zone (that
 * zone's clock reading, written as a UTC instant) with d3's UTC intervals, and
 * `fromWallTime` maps back, handling daylight saving. Offsets come from
 * `Intl.DateTimeFormat`; Temporal values are recognised structurally, so no
 * global `Temporal` is needed.
 */

/**
 * A time zone: an IANA name (`"America/New_York"`, `"Asia/Kolkata"`),
 * `"UTC"`, or `"local"` for the viewer's own zone.
 *
 * @category Scales & ticks
 */
export type TimeZone = "UTC" | "local" | (string & {});

/**
 * A `Temporal.Instant` or `Temporal.ZonedDateTime`, read structurally: an
 * exact moment, so its zone (if any) does not change where it is plotted.
 *
 * @category Scales & ticks
 */
export interface TemporalInstantLike {
	readonly epochMilliseconds: number;
	readonly [Symbol.toStringTag]: "Temporal.Instant" | "Temporal.ZonedDateTime";
}

/**
 * A `Temporal.PlainDate`, read structurally: a calendar date with no zone,
 * placed at midnight in the zone it is read in.
 *
 * @category Scales & ticks
 */
export interface TemporalPlainDateLike {
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly [Symbol.toStringTag]: "Temporal.PlainDate";
}

/**
 * A `Temporal.PlainDateTime`, read structurally: a wall-clock date and time
 * with no zone, placed at that wall time in the zone it is read in.
 *
 * @category Scales & ticks
 */
export interface TemporalPlainDateTimeLike {
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
	readonly millisecond: number;
	readonly [Symbol.toStringTag]: "Temporal.PlainDateTime";
}

/**
 * The Temporal values a time axis takes, see {@link toEpochMs}.
 *
 * @category Scales & ticks
 */
export type TemporalValue =
	| TemporalInstantLike
	| TemporalPlainDateLike
	| TemporalPlainDateTimeLike;

/**
 * A moment as a time axis takes it: epoch milliseconds, a `Date`, or a
 * {@link TemporalValue}.
 *
 * @category Scales & ticks
 */
export type TimeValue = number | Date | TemporalValue;

const MINUTE = 60_000;
const DAY = 86_400_000;

/** One `formatToParts` formatter per zone: building one costs far more than using it. */
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
	let format = partsFormatters.get(timeZone);
	if (!format) {
		// Throws a RangeError naming the zone if it is not one Intl knows.
		format = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			era: "short",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		});
		partsFormatters.set(timeZone, format);
	}
	return format;
}

/** `Date.UTC` without its two-digit-year quirk: `year` 50 is 50 AD, not 1950. */
function utcFields(
	year: number,
	month: number,
	day: number,
	hour = 0,
	minute = 0,
	second = 0,
	millisecond = 0,
): number {
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(hour, minute, second, millisecond);
	return date.getTime();
}

/**
 * How far a zone's clocks run ahead of UTC at an instant, in milliseconds:
 * `-18_000_000` (−5 h) for New York in January, `19_800_000` (+5:30) for
 * Kolkata. Its wall time is the instant plus this.
 *
 * @param epochMs - The instant, in epoch milliseconds.
 * @param timeZone - Defaults to `"UTC"`, whose offset is always 0.
 * @returns The offset in milliseconds, or `NaN` for a non-finite instant.
 * @throws {RangeError} If `timeZone` is not a zone `Intl` knows.
 * @example
 * ```ts
 * import { timeZoneOffset } from "@sophistry/core/geometry";
 *
 * timeZoneOffset(Date.UTC(2024, 0, 15), "America/New_York"); // -18000000
 * timeZoneOffset(Date.UTC(2024, 6, 15), "America/New_York"); // -14400000
 * ```
 *
 * @category Scales & ticks
 */
export function timeZoneOffset(
	epochMs: number,
	timeZone: TimeZone = "UTC",
): number {
	if (!Number.isFinite(epochMs)) return Number.NaN;
	if (timeZone === "UTC") return 0;
	if (timeZone === "local")
		return -new Date(epochMs).getTimezoneOffset() * MINUTE;
	// Intl writes whole seconds, so measure from the second the instant is in.
	const second = Math.floor(epochMs / 1000) * 1000;
	const parts: Record<string, string> = {};
	for (const part of partsFormatter(timeZone).formatToParts(second))
		parts[part.type] = part.value;
	const year = Number(parts.year);
	const wall = utcFields(
		parts.era === "BC" || parts.era === "B" ? 1 - year : year,
		Number(parts.month),
		Number(parts.day),
		Number(parts.hour) % 24,
		Number(parts.minute),
		Number(parts.second),
	);
	return wall - second;
}

/**
 * An instant's wall time in a zone: what its clocks read, as the UTC instant
 * with those fields, so `new Date(toWallTime(t, zone)).getUTCHours()` is the
 * hour in `zone`. The inverse of {@link fromWallTime}.
 *
 * @param epochMs - The instant, in epoch milliseconds.
 * @param timeZone - Defaults to `"UTC"`, where wall time is the instant.
 * @example
 * ```ts
 * import { toWallTime } from "@sophistry/core/geometry";
 *
 * // 05:00 UTC is midnight in New York in winter.
 * toWallTime(Date.UTC(2024, 0, 15, 5), "America/New_York") === Date.UTC(2024, 0, 15); // true
 * ```
 *
 * @category Scales & ticks
 */
export function toWallTime(
	epochMs: number,
	timeZone: TimeZone = "UTC",
): number {
	return epochMs + timeZoneOffset(epochMs, timeZone);
}

/**
 * Every instant at which a zone's clocks read `wall`: one, normally; two
 * where clocks are set back (the earlier first); none in the hour skipped
 * when they spring forward. Offsets are read a day either side, which
 * assumes no zone changes its offset twice in two days.
 *
 * @internal
 */
export function wallTimeInstants(wall: number, timeZone: TimeZone): number[] {
	if (!Number.isFinite(wall)) return [];
	if (timeZone === "UTC") return [wall];
	const before = timeZoneOffset(wall - DAY, timeZone);
	const after = timeZoneOffset(wall + DAY, timeZone);
	const instants: number[] = [];
	// The larger offset gives the earlier instant.
	for (const offset of before >= after ? [before, after] : [after, before]) {
		const instant = wall - offset;
		if (
			timeZoneOffset(instant, timeZone) === offset &&
			!instants.includes(instant)
		)
			instants.push(instant);
	}
	return instants;
}

/**
 * The instant at which a zone's clocks read `wall` (a wall time, as
 * {@link toWallTime} gives). Daylight saving time is resolved the way
 * Temporal's default (`"compatible"`) does: a wall time that happens twice,
 * as clocks go back, is its earlier instant; one skipped as clocks spring
 * forward is moved on by the gap (02:30 becomes 03:30).
 *
 * @param wall - The wall time: the zone's clock fields, as a UTC instant.
 * @param timeZone - Defaults to `"UTC"`.
 * @returns The instant, in epoch milliseconds.
 * @example
 * ```ts
 * import { fromWallTime } from "@sophistry/core/geometry";
 *
 * // Midnight in New York, before and after the clocks go forward.
 * fromWallTime(Date.UTC(2024, 2, 10), "America/New_York"); // Date.UTC(2024, 2, 10, 5)
 * fromWallTime(Date.UTC(2024, 2, 11), "America/New_York"); // Date.UTC(2024, 2, 11, 4)
 * ```
 *
 * @category Scales & ticks
 */
export function fromWallTime(wall: number, timeZone: TimeZone = "UTC"): number {
	const instants = wallTimeInstants(wall, timeZone);
	if (instants.length > 0) return instants[0];
	if (!Number.isFinite(wall)) return Number.NaN;
	// In a gap: read the wall time with the offset from before it.
	return wall - timeZoneOffset(wall - DAY, timeZone);
}

/** A value's `Symbol.toStringTag`, if it is an object that has one. */
function tagOf(value: object): unknown {
	return (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
}

/** A plain Temporal value's fields in the ISO calendar, whatever calendar it carries. */
function isoFields<V extends object>(value: V): V {
	const own = value as V & {
		calendarId?: string;
		withCalendar?: (calendar: string) => V;
	};
	return own.calendarId !== undefined &&
		own.calendarId !== "iso8601" &&
		typeof own.withCalendar === "function"
		? own.withCalendar("iso8601")
		: value;
}

/**
 * A Temporal value's instant, or `undefined` for anything that is not one.
 * Detected by `Symbol.toStringTag` (and, for exact moments, any object with
 * numeric `epochMilliseconds`), never through the `Temporal` global.
 *
 * @internal
 */
export function temporalEpochMs(
	value: unknown,
	timeZone: TimeZone = "UTC",
): number | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const tag = tagOf(value);
	if (tag === "Temporal.PlainDate") {
		const d = isoFields(value as TemporalPlainDateLike);
		return fromWallTime(utcFields(d.year, d.month, d.day), timeZone);
	}
	if (tag === "Temporal.PlainDateTime") {
		const d = isoFields(value as TemporalPlainDateTimeLike);
		return fromWallTime(
			utcFields(
				d.year,
				d.month,
				d.day,
				d.hour,
				d.minute,
				d.second,
				d.millisecond,
			),
			timeZone,
		);
	}
	const exact = (value as { epochMilliseconds?: unknown }).epochMilliseconds;
	return typeof exact === "number" ? exact : undefined;
}

/**
 * A moment as epoch milliseconds, whatever form it comes in: a number as
 * is, a `Date` by `getTime()`, a `Temporal.Instant` or
 * `Temporal.ZonedDateTime` by its `epochMilliseconds`, and a
 * `Temporal.PlainDate` or `PlainDateTime` — wall-clock values with no zone
 * — at that wall time in `timeZone` (midnight, for a date). Temporal values
 * are recognised by shape, so this works with native Temporal and any
 * polyfill alike, and never needs either.
 *
 * @param value - The moment.
 * @param timeZone - Where a plain date or date-time is read. Defaults to `"UTC"`.
 * @returns Epoch milliseconds; `NaN` for anything else.
 * @example
 * ```ts
 * import { toEpochMs } from "@sophistry/core/geometry";
 *
 * toEpochMs(new Date(Date.UTC(2024, 0, 1))); // 1704067200000
 * // With Temporal available (natively, or a polyfill you load):
 * // toEpochMs(Temporal.PlainDate.from("2024-01-01"), "America/New_York")
 * //   === Date.UTC(2024, 0, 1, 5)
 * ```
 *
 * @category Scales & ticks
 */
export function toEpochMs(
	value: TimeValue,
	timeZone: TimeZone = "UTC",
): number {
	if (typeof value === "number") return value;
	if (value instanceof Date) return value.getTime();
	return temporalEpochMs(value, timeZone) ?? Number.NaN;
}

/**
 * The zone a time axis reads in: the one it names, else UTC for `"utc"` and
 * the viewer's own for `"time"`.
 *
 * @internal
 */
export function axisTimeZone(
	scale: "time" | "utc",
	timeZone: TimeZone | undefined,
): TimeZone {
	return timeZone ?? (scale === "utc" ? "UTC" : "local");
}
