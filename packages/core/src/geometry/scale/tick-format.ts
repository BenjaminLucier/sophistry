/**
 * Tick label formatting: the default `formatTick`, the named formatters
 * (SI, scientific, percent, multiples of π), d3-style format specifiers and
 * the formatter resolver.
 */

import { scaleLinear } from "d3-scale";
import { createResolver } from "../resolver.js";
import { axisTimeZone, type TimeZone } from "../time.js";
import { calendarAxis, type Range, type ScaleSpec } from "./scales.js";

/**
 * A tick's text. Without `decimalPlaces` the number is written as short as it
 * can be — an axis reads `0, 0.5, 1`, not `0.00, 0.50, 1.00` — after rounding
 * away representation noise. With `decimalPlaces` the caller has asked for a
 * fixed width and gets exactly that, trailing zeros included.
 *
 * @param value - The tick value.
 * @param decimalPlaces - Fixed number of decimals (clamped to 0..20). Omit for the shortest form.
 *
 * @category Scales & ticks
 */
export function formatTick(value: number, decimalPlaces?: number): string {
	// -0 prints as "-0", which nobody wants at the origin of an axis.
	const safe = Object.is(value, -0) ? 0 : value;
	if (decimalPlaces !== undefined) {
		const fixed = safe.toFixed(Math.max(0, Math.min(20, decimalPlaces)));
		// A tiny negative rounds to "-0.00"; the sign is noise once nothing is left.
		return /^-0(\.0*)?$/.test(fixed) ? fixed.slice(1) : fixed;
	}
	const rounded = Number(safe.toPrecision(12));
	if (Number.isInteger(rounded)) return String(rounded);
	return String(Number(rounded.toFixed(6)));
}

/* ------------------------------------------------------------- formatters */

/**
 * A tick's text, given its value and (for `"plain"`) the same
 * `decimalPlaces` `formatTick` takes. Resolved by the same idiom as this
 * package's other five registries — see `geometry/resolver.ts` — so an
 * `<Axes>`'s `tickFormat` prop accepts a name or a caller's own
 * `(value, decimalPlaces?) => string` on equal footing.
 *
 * @category Scales & ticks
 */
export type TickFormatter = (value: number, decimalPlaces?: number) => string;

const SI_PREFIXES: readonly [exponent: number, symbol: string][] = [
	[-9, "n"],
	[-6, "µ"],
	[-3, "m"],
	[0, ""],
	[3, "k"],
	[6, "M"],
	[9, "G"],
	[12, "T"],
];

/**
 * SI-prefixed: `1500` reads `1.5k`, `0.0025` reads `2.5m`. Scales by the
 * nearest power of a thousand this package bothers naming (nano through
 * tera — an axis spanning further than that is a sign the range itself is
 * wrong, not that this table needs another row) and formats the mantissa
 * through `formatTick`, so `decimalPlaces` means the same thing it does for
 * `"plain"`.
 */
function siFormatter(value: number, decimalPlaces?: number): string {
	const safe = Object.is(value, -0) ? 0 : value;
	if (safe === 0) return "0";
	const raw = Math.floor(Math.log10(Math.abs(safe)) / 3) * 3;
	let exponent = Math.max(-9, Math.min(12, raw));
	// Pick the prefix *after* rounding: 999999 at 0 places rounds its mantissa
	// to 1000, which belongs to the next prefix up ("1M", not "1000k").
	const roundedMantissa = (e: number): number => {
		const m = safe / 10 ** e;
		return decimalPlaces === undefined
			? Number(m.toPrecision(12))
			: Number(m.toFixed(Math.max(0, Math.min(20, decimalPlaces))));
	};
	if (exponent < 12 && Math.abs(roundedMantissa(exponent)) >= 1000)
		exponent += 3;
	const prefix = SI_PREFIXES.find(([e]) => e === exponent)?.[1] ?? "";
	const scaled = safe / 10 ** exponent;
	return `${formatTick(scaled, decimalPlaces)}${prefix}`;
}

/**
 * `1500` reads `1.5e3`, `0.0025` reads `2.5e-3` — mantissa and exponent, no
 * unicode superscripts (a `<Text>` renders through KaTeX or a plain font
 * depending on context, and this stays legible in both). `decimalPlaces`
 * fixes the mantissa's width, same as every other formatter here; without it
 * the mantissa defaults to two places, since `toExponential()`'s own
 * default (as many digits as double precision has) is never what an axis
 * wants.
 */
function scientificFormatter(value: number, decimalPlaces?: number): string {
	const safe = Object.is(value, -0) ? 0 : value;
	if (safe === 0) return "0";
	const places = decimalPlaces ?? 2;
	return safe
		.toExponential(Math.max(0, Math.min(20, places)))
		.replace("e+", "e")
		.replace(/e(-?)0*(\d)/, "e$1$2");
}

/** `0.5` reads `50%` — the value scaled by 100 and formatted through
 * `formatTick`, for an axis whose data is already a fraction. */
function percentFormatter(value: number, decimalPlaces?: number): string {
	return `${formatTick(value * 100, decimalPlaces)}%`;
}

function gcd(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y > 0) {
		const remainder = x % y;
		x = y;
		y = remainder;
	}
	return x || 1;
}

/**
 * The largest denominator (out of twelfths, the finest split a polar axis in
 * this package ever divides a turn into) worth searching for a clean
 * `nπ/d` reading of a tick value before giving up and falling back to plain
 * decimal.
 */
const MAX_PI_DENOMINATOR = 12;

const PI_TOLERANCE = 1e-6;

/**
 * Writes a value as a multiple of π the way a person would — `π/2`, `2π/3`,
 * `π`, `3π/2` — folding in the `PolarPlane.piMultipleLabel` (which
 * takes the exact rational a polar axis already knows, since its angles are
 * k/n of a turn by construction) as a named formatter that instead
 * *recovers* the rational from a plain tick value, by searching denominators
 * 1..12 for the closest fit. A tick that isn't cleanly a small multiple of
 * π/12 (within `PI_TOLERANCE`) falls back to `formatTick` rather than
 * printing a misleading near-miss fraction.
 */
function piMultipleFormatter(value: number, decimalPlaces?: number): string {
	if (!Number.isFinite(value)) return "";
	if (value === 0) return "0";
	const turns = value / Math.PI;

	let bestNumerator = Math.round(turns);
	let bestDenominator = 1;
	let bestError = Math.abs(turns - bestNumerator);
	for (let denominator = 2; denominator <= MAX_PI_DENOMINATOR; denominator++) {
		const numerator = Math.round(turns * denominator);
		const error = Math.abs(turns - numerator / denominator);
		if (error < bestError - 1e-9) {
			bestNumerator = numerator;
			bestDenominator = denominator;
			bestError = error;
		}
	}
	if (bestError > PI_TOLERANCE) return formatTick(value, decimalPlaces);
	if (bestNumerator === 0) return "0";

	const sign = bestNumerator < 0 ? "-" : "";
	const top = Math.abs(bestNumerator);
	const divisor = gcd(top, bestDenominator);
	const reducedTop = top / divisor;
	const reducedBottom = bestDenominator / divisor;
	const coefficient = reducedTop === 1 ? "" : String(reducedTop);
	const denominatorPart = reducedBottom === 1 ? "" : `/${reducedBottom}`;
	return `${sign}${coefficient}π${denominatorPart}`;
}

/** The named formatters `resolveTickFormatter` looks names up in. `"plain"`
 * is `formatTick` itself, so the default behaviour is unchanged either way
 * it's reached.
 *
 * @category Scales & ticks
 */
export const tickFormatters = Object.freeze({
	plain: formatTick,
	si: siFormatter,
	scientific: scientificFormatter,
	percent: percentFormatter,
	piMultiple: piMultipleFormatter,
} satisfies Record<string, TickFormatter>);

/**
 * Names of the built-in tick formatters: `plain`, `si`, `scientific`, `percent`, `piMultiple`.
 *
 * @category Scales & ticks
 */
export type TickFormatterName = keyof typeof tickFormatters;

/**
 * A tick formatter as a function, a built-in name, or a format string: a
 * [d3-format](https://d3js.org/d3-format) specifier on a numeric axis
 * (`",.2f"`, `".0%"`, `"$.2s"`, `"~s"`) or a
 * [d3-time-format](https://d3js.org/d3-time-format) one on a time axis
 * (`"%b %Y"`). See {@link formatSpecifier}.
 *
 * @category Scales & ticks
 */
export type TickFormatterSpec =
	| TickFormatter
	| TickFormatterName
	// Any other string is a format specifier; `string & {}` keeps the names
	// above in autocomplete.
	| (string & {});

/**
 * What a format specifier needs to know about the axis it writes for: a
 * specifier without a precision (`","`, `"$"`, `"~s"`) gets the precision
 * the axis's tick step calls for, as d3's own axes do.
 *
 * @category Scales & ticks
 */
export interface TickFormatContext {
	/** The axis's scale; `"time"`/`"utc"` read the specifier as a date format. */
	scale?: ScaleSpec;
	/** A time axis's zone, which a date format writes in; see {@link TimeScaleOptions.timeZone}. */
	timeZone?: TimeZone;
	/**
	 * The axis's range.
	 * @default `[0, 1]`
	 */
	range?: Range;
	/**
	 * Roughly how many ticks the axis shows.
	 * @default 10
	 */
	count?: number;
}

const tickFormatterResolver = createResolver<TickFormatter>(
	"tick formatter",
	tickFormatters,
);

/**
 * A tick formatter from a d3-format specifier (numeric axes) or d3-time-format
 * specifier (time axes), formatted by d3 itself. A specifier with no precision
 * takes the one the axis's tick step calls for (`context`).
 *
 * @param specifier - The format string.
 * @param context - The axis it formats for.
 * @returns The formatter.
 * @throws If `specifier` is not a valid format string.
 * @example
 * ```ts
 * import { formatSpecifier } from "@sophistry/core/geometry";
 *
 * formatSpecifier(",.2f")(1234.5); // "1,234.50"
 * formatSpecifier(".0%")(0.25); // "25%"
 * formatSpecifier(",f", { range: [0, 20000], count: 4 })(15000); // "15,000"
 * formatSpecifier("%H:%M", { scale: "utc", timeZone: "Asia/Kolkata" })(0); // "05:30"
 * ```
 *
 * @category Scales & ticks
 */
export function formatSpecifier(
	specifier: string,
	context: TickFormatContext = {},
): TickFormatter {
	const range = context.range ?? [0, 1];
	const count = context.count ?? 10;
	const scale = context.scale;
	if (scale === "time" || scale === "utc")
		return calendarAxis(
			range[0],
			range[1],
			axisTimeZone(scale, context.timeZone),
		).format(count, specifier);
	const format = scaleLinear()
		.domain([range[0], range[1]])
		.tickFormat(count, specifier);
	return (value) => format(value);
}

/**
 * A name is sugar for a function — `resolveEasing`, for tick formatters. A
 * string that is not a built-in name is read as a format specifier
 * ({@link formatSpecifier}); one that is neither throws, listing the names.
 *
 * @param spec - A formatter, a built-in name, a format string, or undefined.
 * @param fallback - Used when `spec` is undefined. Defaults to `"plain"`.
 * @param context - The axis a format string formats for; see {@link TickFormatContext}.
 *
 * @category Scales & ticks
 */
export function resolveTickFormatter(
	spec: TickFormatterSpec | undefined,
	fallback: TickFormatter = tickFormatters.plain,
	context?: TickFormatContext,
): TickFormatter {
	if (!spec) return fallback;
	if (typeof spec === "string" && !Object.hasOwn(tickFormatters, spec)) {
		try {
			return formatSpecifier(spec, context);
		} catch {
			// Neither a name nor a specifier: the resolver's error lists the names.
			return tickFormatterResolver.resolve(spec);
		}
	}
	return tickFormatterResolver.resolve(spec);
}
