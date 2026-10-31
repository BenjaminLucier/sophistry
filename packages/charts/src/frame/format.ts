/** How a `chart` writes a channel's value in a tooltip (`frame.format`). */

import type { BandKey, TimeZone } from "@sophistry/core/geometry";
import {
	formatSpecifier,
	formatTick,
	toWallTime,
} from "@sophistry/core/geometry";
import { axisFormatter, axisTimeZone } from "@sophistry/core/internal";
import type { OrdinalColorScale } from "../math/ordinal";
import type { MergedAxisOptions, ResolvedAxis } from "./fit";
import { numberLineOptions } from "./layout";
import type { SecondaryFlags } from "./secondary";
import type {
	ChartColorOptions,
	ChartFormatChannel,
	ChartSizeLegendOptions,
} from "./types";

/** A formatter of one channel's values. */
export type ValueFormat = (value: number | BandKey) => string;

/**
 * How an axis writes a value in a tooltip: a band axis a category's name, a
 * continuous one through its `tickFormat` at its current range (a full date,
 * by default, on a time axis).
 */
export function axisValueFormat(
	options: MergedAxisOptions,
	axis: ResolvedAxis,
): ValueFormat {
	if (axis.kind === "band") {
		const domain = axis.band.domain;
		return (value) => {
			const index = domain.indexOf(value);
			if (index < 0)
				return typeof value === "number" ? formatTick(value) : String(value);
			// `""` hides the axis label, not the category: a tooltip still names it.
			const label = options.categoryLabel?.(value, index);
			return label === undefined || label === "" ? String(value) : label;
		};
	}
	const scale = axis.scale;
	const timeZone = axis.timeZone ?? options.timeZone;
	if (
		options.tickFormat === undefined &&
		(scale === "time" || scale === "utc")
	) {
		const zone = axisTimeZone(scale, timeZone);
		return (value) =>
			typeof value === "number" ? dateText(value, zone) : String(value);
	}
	const format = axisFormatter(
		{
			...numberLineOptions(options),
			scale,
			base: axis.base ?? options.base,
			timeZone,
		},
		axis.range,
	);
	return (value) =>
		typeof value === "number"
			? format(value, options.decimalPlaces)
			: String(value);
}

/** A moment written in full on `timeZone`'s clock, to the precision it carries: the day, then the minute or the second. */
export function dateText(value: number, timeZone: TimeZone): string {
	if (!Number.isFinite(value)) return formatTick(value);
	// The zone's wall time, read with UTC getters.
	const date = new Date(toWallTime(value, timeZone));
	const seconds = date.getUTCSeconds() * 1000 + date.getUTCMilliseconds();
	const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
	const specifier =
		seconds > 0
			? "%b %-d, %Y, %H:%M:%S"
			: minutes > 0
				? "%b %-d, %Y, %H:%M"
				: "%b %-d, %Y";
	return formatSpecifier(specifier, { scale: "utc", timeZone })(value);
}

/** An axis whose values a chart formats. */
export interface FormatAxis {
	options: MergedAxisOptions;
	axis: ResolvedAxis;
}

/** What a chart's formats read on one update. */
export interface ChartFormatsInput {
	x: FormatAxis;
	y: FormatAxis;
	x2: FormatAxis;
	y2: FormatAxis;
	color: ChartColorOptions | undefined;
	colorScale: OrdinalColorScale;
	sizeOptions: ChartSizeLegendOptions;
}

/**
 * The formatters a chart's contexts write values with, by secondary flags.
 * Make one per chart; each update passes its axes, and a formatter is built
 * lazily (when a tooltip asks) and kept while its axis keeps its identity.
 *
 * @returns `(input) => (flags) => format`: `format(channel)` for the context
 *   through `flags`.
 */
export function createChartFormats(): (
	input: ChartFormatsInput,
) => (flags: SecondaryFlags) => (channel: ChartFormatChannel) => ValueFormat {
	const lazyAxis = () => {
		let last: {
			options: MergedAxisOptions;
			axis: ResolvedAxis;
			format: ValueFormat;
		} | null = null;
		return (own: FormatAxis): ValueFormat => {
			if (!last || last.options !== own.options || last.axis !== own.axis)
				last = { ...own, format: axisValueFormat(own.options, own.axis) };
			return last.format;
		};
	};
	const xFormat = lazyAxis();
	const yFormat = lazyAxis();
	const x2Format = lazyAxis();
	const y2Format = lazyAxis();
	let series: { label: unknown; domain: unknown; format: ValueFormat } | null =
		null;
	let size: { format: unknown; value: ValueFormat } | null = null;
	return (input) => {
		const seriesFormat = (): ValueFormat => {
			const label = input.color?.label;
			const domain = input.colorScale.domain;
			if (!series || series.label !== label || series.domain !== domain)
				series = {
					label,
					domain,
					format: (key) => label?.(key, domain.indexOf(key)) ?? String(key),
				};
			return series.format;
		};
		const sizeFormat = (): ValueFormat => {
			const format = input.sizeOptions.format;
			if (!size || size.format !== format)
				size = {
					format,
					value: (value) =>
						typeof value === "number"
							? (format ?? formatTick)(value)
							: String(value),
				};
			return size.value;
		};
		return (flags) => (channel) => {
			switch (channel) {
				case "x":
					return flags.x2 ? x2Format(input.x2) : xFormat(input.x);
				case "y":
					return flags.y2 ? y2Format(input.y2) : yFormat(input.y);
				case "series":
					return seriesFormat();
				default:
					return sizeFormat();
			}
		};
	};
}
