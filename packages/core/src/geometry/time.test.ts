/**
 * Time zones on time axes: offsets and wall times from Intl, daylight saving
 * gaps and overlaps resolved as Temporal's "compatible" does, Temporal
 * values read by shape (hand-built fakes; sophistry never needs Temporal),
 * and zone-aware ticks, nicing and formats.
 */

import { describe, expect, it } from "vitest";
import { calendarAxis, timeScale } from "./scale/scales";
import { formatSpecifier } from "./scale/tick-format";
import {
	fromWallTime,
	type TemporalInstantLike,
	type TemporalPlainDateLike,
	type TemporalPlainDateTimeLike,
	timeZoneOffset,
	toEpochMs,
	toWallTime,
	wallTimeInstants,
} from "./time";

const HOUR = 3_600_000;
const NY = "America/New_York";
const LONDON = "Europe/London";
const KOLKATA = "Asia/Kolkata";

const instant = (ms: number): TemporalInstantLike => ({
	epochMilliseconds: ms,
	[Symbol.toStringTag]: "Temporal.Instant",
});
const plainDate = (
	year: number,
	month: number,
	day: number,
): TemporalPlainDateLike => ({
	year,
	month,
	day,
	[Symbol.toStringTag]: "Temporal.PlainDate",
});

/** Gaps between consecutive ticks, in hours. */
const gaps = (ticks: number[]) =>
	ticks.slice(1).map((t, i) => (t - ticks[i]) / HOUR);

describe("time zone offsets", () => {
	it("read the zone's offset at the instant", () => {
		expect(timeZoneOffset(Date.UTC(2024, 0, 15), NY)).toBe(-5 * HOUR);
		expect(timeZoneOffset(Date.UTC(2024, 6, 15), NY)).toBe(-4 * HOUR);
		expect(timeZoneOffset(Date.UTC(2024, 6, 15), LONDON)).toBe(HOUR);
		expect(timeZoneOffset(Date.UTC(2024, 0, 15), KOLKATA)).toBe(5.5 * HOUR);
		expect(timeZoneOffset(Date.UTC(2024, 0, 15), "UTC")).toBe(0);
		expect(timeZoneOffset(Number.NaN, NY)).toBeNaN();
		expect(() => timeZoneOffset(0, "Not/A_Zone")).toThrow(RangeError);
	});

	it("go to wall time and back", () => {
		const t = Date.UTC(2024, 0, 15, 5, 7, 9, 11);
		expect(toWallTime(t, NY)).toBe(Date.UTC(2024, 0, 15, 0, 7, 9, 11));
		expect(fromWallTime(toWallTime(t, NY), NY)).toBe(t);
		expect(fromWallTime(Date.UTC(2024, 0, 15, 12), KOLKATA)).toBe(
			Date.UTC(2024, 0, 15, 6, 30),
		);
	});

	it("resolve daylight saving gaps and overlaps like Temporal's default", () => {
		// 02:30 on 2024-03-10 never happens in New York: it reads as 03:30 EDT.
		const gap = Date.UTC(2024, 2, 10, 2, 30);
		expect(wallTimeInstants(gap, NY)).toEqual([]);
		expect(fromWallTime(gap, NY)).toBe(Date.UTC(2024, 2, 10, 7, 30));
		// 01:30 on 2024-11-03 happens twice: EDT first, then EST.
		const twice = Date.UTC(2024, 10, 3, 1, 30);
		expect(wallTimeInstants(twice, NY)).toEqual([
			Date.UTC(2024, 10, 3, 5, 30),
			Date.UTC(2024, 10, 3, 6, 30),
		]);
		expect(fromWallTime(twice, NY)).toBe(Date.UTC(2024, 10, 3, 5, 30));
	});
});

describe("toEpochMs", () => {
	it("reads numbers, Dates and exact Temporal values as instants", () => {
		const t = Date.UTC(2024, 0, 1, 12);
		expect(toEpochMs(t)).toBe(t);
		expect(toEpochMs(new Date(t))).toBe(t);
		expect(toEpochMs(instant(t), NY)).toBe(t);
		const zoned = {
			epochMilliseconds: t,
			timeZoneId: NY,
			[Symbol.toStringTag]: "Temporal.ZonedDateTime" as const,
		};
		expect(toEpochMs(zoned, KOLKATA)).toBe(t);
	});

	it("places plain dates and date-times in the zone given", () => {
		expect(toEpochMs(plainDate(2024, 1, 1))).toBe(Date.UTC(2024, 0, 1));
		expect(toEpochMs(plainDate(2024, 1, 1), NY)).toBe(Date.UTC(2024, 0, 1, 5));
		const dateTime: TemporalPlainDateTimeLike = {
			year: 2024,
			month: 7,
			day: 4,
			hour: 9,
			minute: 30,
			second: 15,
			millisecond: 250,
			[Symbol.toStringTag]: "Temporal.PlainDateTime",
		};
		expect(toEpochMs(dateTime, LONDON)).toBe(
			Date.UTC(2024, 6, 4, 8, 30, 15, 250),
		);
	});

	it("converts a plain value in another calendar to ISO first", () => {
		const iso = plainDate(2024, 1, 1);
		const other = {
			...plainDate(5784, 4, 20),
			calendarId: "hebrew",
			withCalendar: () => iso,
		};
		expect(toEpochMs(other)).toBe(Date.UTC(2024, 0, 1));
	});

	it("gives NaN for anything else", () => {
		expect(toEpochMs({} as never)).toBeNaN();
		expect(toEpochMs("2024-01-01" as never)).toBeNaN();
	});
});

describe("zoned time scales", () => {
	it("tick at New York midnights across both clock changes", () => {
		const spring = timeScale(
			[Date.UTC(2024, 2, 8, 5), Date.UTC(2024, 2, 13, 4)],
			{ timeZone: NY },
		);
		const ticks = spring.ticks?.(6).majors ?? [];
		expect(ticks.map((t) => toWallTime(t, NY) % (24 * HOUR))).toEqual(
			ticks.map(() => 0),
		);
		expect(gaps(ticks)).toEqual([24, 24, 23, 24, 24]);
		expect(ticks.map((t) => spring.tickFormat?.(t))).toEqual([
			"Fri 08",
			"Sat 09",
			"Mar 10",
			"Mon 11",
			"Tue 12",
			"Wed 13",
		]);

		const fall = timeScale(
			[Date.UTC(2024, 10, 2, 4), Date.UTC(2024, 10, 5, 5)],
			{ timeZone: NY },
		);
		expect(gaps(fall.ticks?.(4).majors ?? [])).toEqual([24, 25, 24]);
	});

	it("tick at London midnights, 23 and 25 hours apart", () => {
		const spring = timeScale(
			[Date.UTC(2024, 2, 30), Date.UTC(2024, 3, 1, 23)],
			{ timeZone: LONDON },
		);
		expect(spring.ticks?.(3).majors).toEqual([
			Date.UTC(2024, 2, 30),
			Date.UTC(2024, 2, 31),
			Date.UTC(2024, 2, 31, 23),
			Date.UTC(2024, 3, 1, 23),
		]);
		const fall = timeScale(
			[Date.UTC(2024, 9, 26, 23), Date.UTC(2024, 9, 28, 1)],
			{ timeZone: LONDON },
		);
		expect(gaps(fall.ticks?.(1).majors ?? [])).toEqual([25]);
	});

	it("keep both 1 AMs as the clocks go back, and skip the hour lost", () => {
		const back = timeScale(
			[Date.UTC(2024, 10, 3, 4), Date.UTC(2024, 10, 3, 8)],
			{ timeZone: NY },
		);
		const ticks = back.ticks?.(4).majors ?? [];
		expect(gaps(ticks)).toEqual([1, 1, 1, 1]);
		expect(ticks.map((t) => back.tickFormat?.(t))).toEqual([
			"Nov 03",
			"01 AM",
			"01 AM",
			"02 AM",
			"03 AM",
		]);
		const forward = timeScale(
			[Date.UTC(2024, 2, 10, 5), Date.UTC(2024, 2, 10, 9)],
			{ timeZone: NY },
		);
		expect(
			(forward.ticks?.(4).majors ?? []).map((t) => forward.tickFormat?.(t)),
		).toEqual(["Mar 10", "01 AM", "03 AM", "04 AM", "05 AM"]);
	});

	it("tick on the hour in a half-hour zone", () => {
		const scale = timeScale(
			[Date.UTC(2024, 0, 1, 0, 0), Date.UTC(2024, 0, 1, 6, 0)],
			{ timeZone: KOLKATA },
		);
		const ticks = scale.ticks?.(6).majors ?? [];
		expect(ticks[0]).toBe(Date.UTC(2024, 0, 1, 0, 30));
		expect(ticks.map((t) => scale.tickFormat?.(t))).toEqual([
			"06 AM",
			"07 AM",
			"08 AM",
			"09 AM",
			"10 AM",
			"11 AM",
		]);
	});

	it("leave UTC and local scales as d3 makes them", () => {
		const range: [number, number] = [
			Date.UTC(2024, 0, 1),
			Date.UTC(2024, 11, 31),
		];
		expect(timeScale(range, { timeZone: "UTC" }).ticks?.()).toEqual(
			timeScale(range).ticks?.(),
		);
		expect(timeScale(range, { timeZone: "local" }).ticks?.()).toEqual(
			timeScale(range, { utc: false }).ticks?.(),
		);
	});

	it("nice a fitted range to the zone's midnights", () => {
		// The calendar axis is what the charts' range fitting nices with.
		const [lo, hi] = calendarAxis(
			Date.UTC(2024, 2, 5, 12),
			Date.UTC(2024, 2, 14, 12),
			NY,
		).nice(5);
		expect(toWallTime(lo, NY) % (24 * HOUR)).toBe(0);
		expect(toWallTime(hi, NY) % (24 * HOUR)).toBe(0);
	});

	it("write a format specifier in the zone", () => {
		const t = Date.UTC(2024, 6, 4, 12);
		expect(formatSpecifier("%H:%M", { scale: "utc", timeZone: NY })(t)).toBe(
			"08:00",
		);
		expect(
			formatSpecifier("%H:%M", { scale: "utc", timeZone: KOLKATA })(t),
		).toBe("17:30");
		expect(formatSpecifier("%H:%M", { scale: "utc" })(t)).toBe("12:00");
	});
});
