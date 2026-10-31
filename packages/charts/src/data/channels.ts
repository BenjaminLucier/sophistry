/**
 * Data channels: how a chart reads one field out of each datum. A channel
 * is a key of the datum (`x="year"`, type-checked against `T`) or a function
 * `(d, i) => value`. Singular props are channels, plural ones (`xs`,
 * `colors`, `edges`) literal arrays. With `number[]` data the main numeric
 * channel defaults to the datum itself. Colour is a constant or a function,
 * never a key; colour by a field with `series`. Dates in positional
 * channels are read as epoch milliseconds.
 *
 * @packageDocumentation
 */

import type { ContextKey } from "@sophistry/core";
import { createContextKey } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { TemporalValue, TimeZone } from "@sophistry/core/geometry";
import { cssColor, temporalEpochMs } from "@sophistry/core/internal";

/**
 * A channel function: reads one value from a datum and its index.
 *
 * @category Channels
 */
export type ChannelFn<T, V> = (datum: T, index: number) => V;

/**
 * The keys of `T` whose values suit a `V`-valued channel (`V`, `null` or `undefined`).
 *
 * @category Channels
 */
export type ChannelKey<T, V> = [T] extends [object]
	? {
			// `keyof T & string`, not bare `keyof T`: a bare key makes the mapped
			// type homomorphic, which maps array and tuple members specially.
			[K in keyof T & string]-?: T[K] extends V | null | undefined ? K : never;
		}[keyof T & string]
	: never;

/**
 * Where a chart finds a `V` in each `T`: a key of `T` whose value is a `V`,
 * or a function `(d, i) => V`.
 *
 * @see https://sophistry.dev/guides/charts/#data-and-channels
 * @category Channels
 */
export type Channel<T, V> = ChannelKey<T, V> | ChannelFn<T, V>;

/**
 * A position on a continuous axis, as positional channels (`x`, `y`, `x1`,
 * …) accept it: a number, a `Date`, or a Temporal value (`Instant`,
 * `ZonedDateTime`, `PlainDate`, `PlainDateTime`).
 *
 * @see https://sophistry.dev/guides/charts/#dates-and-time-zones
 * @category Channels
 */
export type PositionValue = number | Date | TemporalValue;

/**
 * What a channel of `V`s reads once resolved: dates become epoch
 * milliseconds, anything else is as given.
 *
 * @category Channels
 */
export type ChannelRead<V> = V extends Date | TemporalValue ? number : V;

/**
 * A number: one constant for every datum, or a per-datum {@link Channel}.
 *
 * @category Channels
 */
export type Quantity<T> = number | Channel<T, number>;

/**
 * A colour: one constant (a CSS string or a `Color` such as `BLUE`) or
 * `(d, i) => colour`. No key form: a string is always a colour.
 *
 * @category Channels
 */
export type ColorChannel<T> = ColorInput | ChannelFn<T, ColorInput>;

/**
 * Placeholder type of a required channel prop; see {@link RequiredUnless}.
 * Its name is what a "missing property" error shows.
 *
 * @category Channels
 */
export interface RequiredChannel<T, V> {
	/** @internal */
	readonly __channel?: [T, V];
}

/**
 * Makes the channel prop `K` required unless `T` is already a `V` (then the
 * channel defaults to the datum itself; nullish members of `T` don't
 * count). Intersect it with a props interface declaring `K` as an optional
 * {@link Channel}; `T` stays inferred from `data`.
 *
 * @category Channels
 */
export type RequiredUnless<T, V, K extends string> = [NonNullable<T>] extends [
	V,
]
	? unknown
	: { [P in K]-?: RequiredChannel<T, V> };

/** The identity channel, the default for `number[]` data. */
export const identity = <T, V>(datum: T): V => datum as unknown as V;

/** Position of a datum: the default `x` channel for `number[]` data. */
export const indexOf = (_datum: unknown, index: number): number => index;

/**
 * Turns a {@link Channel} into a plain function: a key reads that property,
 * a function is called as is. Dates come back as epoch milliseconds (plain
 * Temporal dates in the axis's `timeZone`, else UTC); read through a
 * positional channel under a `<Chart>`, they also make that axis a time
 * axis. An omitted channel resolves to `fallback`, or `undefined`.
 *
 * A mark passes the {@link DateSink} it read from {@link dateSinkContext}.
 *
 * @param fallback - Used when `channel` is `undefined`.
 * @param name - Prop name for the error message.
 * @param sink - Where a positional channel notes dates (the enclosing chart's).
 * @throws {TypeError} If `channel` is neither a function nor a string or symbol key.
 * @category Channels
 */
export function resolveChannel<T, V>(
	channel: Channel<T, V>,
	fallback?: undefined,
	name?: string,
	sink?: DateSink | null,
): ChannelFn<T, ChannelRead<V>>;
export function resolveChannel<T, V>(
	channel: Channel<T, V> | undefined,
	fallback: ChannelFn<T, V>,
	name?: string,
	sink?: DateSink | null,
): ChannelFn<T, ChannelRead<V>>;
export function resolveChannel<T, V>(
	channel: Channel<T, V> | undefined,
	fallback?: undefined,
	name?: string,
	sink?: DateSink | null,
): ChannelFn<T, ChannelRead<V>> | undefined;
export function resolveChannel<T, V>(
	channel: Channel<T, V> | undefined,
	fallback?: ChannelFn<T, V>,
	name = "channel",
	dates?: DateSink | null,
): ChannelFn<T, ChannelRead<V>> | undefined {
	let read: ChannelFn<T, unknown> | undefined;
	if (channel === undefined) read = fallback;
	else if (typeof channel === "function") read = channel;
	else {
		const kind = typeof channel;
		if (kind !== "string" && kind !== "symbol") {
			throw new TypeError(
				`\`${name}\` must be a key of the datum or a function (d, i) => value, got ${
					channel === null ? "null" : kind
				}.`,
			);
		}
		const key = channel as keyof T;
		read = (datum) => (datum as T)[key];
	}
	if (!read) return undefined;
	const own = read;
	// Dates become their epoch milliseconds here, for every mark and
	// transform at once; a positional channel also tells the chart.
	const axis = DATE_AXIS.get(name);
	const sink = axis ? (dates ?? undefined) : undefined;
	return (datum, index) => {
		const value = own(datum, index);
		if (typeof value !== "object" || value === null)
			return value as ChannelRead<V>;
		const ms =
			value instanceof Date
				? value.getTime()
				: temporalEpochMs(value, axis && sink ? sink.timeZone(axis) : "UTC");
		if (ms === undefined) return value as ChannelRead<V>;
		if (axis) sink?.note(axis);
		return ms as ChannelRead<V>;
	};
}

/** The axis a positional channel's dates are noted on, by channel name. */
const DATE_AXIS: ReadonlyMap<string, DateAxis> = new Map([
	["x", "x"],
	["x1", "x"],
	["x2", "x"],
	["y", "y"],
	["y1", "y"],
	["y2", "y"],
]);

/** An axis a channel's dates can be noted on: a chart's own, or a secondary one. */
export type DateAxis = "x" | "y" | "x2" | "y2";

/**
 * Where positional channels note that they read dates, so `<Chart>` can
 * infer a `"utc"` scale; also gives the zone an axis reads plain Temporal
 * dates in.
 *
 * @category Extending
 */
export interface DateSink {
	note(axis: DateAxis): void;
	/** The zone `axis` names, if any, else `"UTC"`. */
	timeZone(axis: DateAxis): TimeZone;
}

/**
 * Provided by `chart` (and redirected by `secondaryX`/`secondaryY`); outside
 * one (3D charts, transforms) it is null. Marks read it with
 * `ctx.context(dateSinkContext)` and pass it to {@link resolveChannel}.
 *
 * @category Extending
 */
export const dateSinkContext: ContextKey<DateSink | null> =
	createContextKey<DateSink | null>("chartDates", null);

/**
 * A {@link Quantity} as a function: a constant ignores the datum. An omitted
 * quantity resolves to `fallback`, or `undefined`.
 *
 * @category Channels
 */
export function resolveQuantity<T>(quantity: Quantity<T>): ChannelFn<T, number>;
export function resolveQuantity<T>(
	quantity: Quantity<T> | undefined,
	fallback: ChannelFn<T, number>,
): ChannelFn<T, number>;
export function resolveQuantity<T>(
	quantity: Quantity<T> | undefined,
): ChannelFn<T, number> | undefined;
export function resolveQuantity<T>(
	quantity: Quantity<T> | undefined,
	fallback?: ChannelFn<T, number>,
): ChannelFn<T, number> | undefined {
	if (typeof quantity === "number") return () => quantity;
	return resolveChannel(quantity, fallback as ChannelFn<T, number>);
}

/**
 * Reads a channel across `data`.
 *
 * @param name - Prop name for the error message.
 * @returns One value per datum, in order (dates as epoch milliseconds).
 * @category Channels
 */
export function channelValues<T, V>(
	data: readonly T[],
	channel: Channel<T, V> | undefined,
	fallback?: ChannelFn<T, V>,
	name?: string,
	sink?: DateSink | null,
): (ChannelRead<V> | undefined)[] {
	const read = resolveChannel(channel, fallback as ChannelFn<T, V>, name, sink);
	return data.map((datum, i) => (read ? read(datum, i) : undefined));
}

/**
 * {@link channelValues} for a numeric channel: non-numbers become `NaN`
 * (which charts skip), dates epoch milliseconds.
 *
 * @category Channels
 */
export function numberValues<T, V extends PositionValue = PositionValue>(
	data: readonly T[],
	channel: Channel<T, V> | undefined,
	fallback?: ChannelFn<T, NoInfer<V>>,
	name?: string,
	sink?: DateSink | null,
): number[] {
	return channelValues(data, channel, fallback, name, sink).map((value) =>
		typeof value === "number" ? value : Number.NaN,
	);
}

/**
 * A {@link ColorChannel} as a function, or `undefined` when omitted.
 *
 * @category Channels
 */
export function resolveColor<T>(
	color: ColorChannel<T> | undefined,
): ChannelFn<T, string> | undefined {
	if (typeof color === "function")
		return (datum, index) => {
			const value = color(datum, index);
			// A function may return nothing for a datum (the palette then
			// applies), whatever its declared type says.
			return (value == null ? value : cssColor(value)) as string;
		};
	if (!color) return undefined;
	const css = cssColor(color);
	return () => css;
}

/**
 * Colour of datum `i`: the per-datum `color` if given, else the `colors`
 * palette cycled by index, else `fallback`.
 *
 * @param fallback - Used when the palette is empty.
 * @category Channels
 */
export function colorResolver<T>(
	color: ColorChannel<T> | undefined,
	palette: readonly ColorInput[],
	fallback: ColorInput,
): ChannelFn<T, string> {
	const read = resolveColor(color);
	return (datum, index) =>
		(read?.(datum, index) as string | undefined) ??
		cssColor(palette.length === 0 ? fallback : palette[index % palette.length]);
}
