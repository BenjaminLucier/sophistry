/**
 * Shared by marks with a `series` channel: reading it, grouping data by it,
 * the colour-scale and legend report, and per-datum keys. Colours come from
 * the enclosing chart's scale (or the layer's own) unless an explicit colour
 * prop overrides it; an overridden layer adds nothing to the legend.
 * Internal.
 */

import type { BandKey } from "@sophistry/core/geometry";
import type { ChartLayer } from "./context.js";
import type { Channel, DateSink } from "./data/channels.js";
import { channelValues } from "./data/channels.js";
import type { ColorExtent, LegendMark } from "./frame/types.js";
import type { OrdinalColorScale } from "./math/ordinal.js";
import { datumKeys, uniqueKeys } from "./math/ordinal.js";
import { shallowEqual } from "./util.js";

/** The one group of a grouped mark drawn without a `series`. */
export const WHOLE = Symbol("whole");
/** A group of a grouped mark: a category, or {@link WHOLE}. */
export type GroupKey = BandKey | typeof WHOLE;

/** A datum's category, as read: nullish when the channel gives none. */
export type Category = BandKey | null | undefined;

/** One update's view of a layer's `series`. See {@link createSeries}. */
export interface SeriesState {
	/** Each datum's category, or undefined without a `series`. */
	of: Category[] | undefined;
	/** The categories, in first-seen order (empty without a `series`). */
	categories: readonly BandKey[];
	/** True when colours come from the scale: a `series`, and no override. */
	scaled: boolean;
	/** The layer's `color` report, or undefined when not scaled. */
	extent: ColorExtent | undefined;
	/** The scale (the frame's inside a chart, else the layer's own). */
	scale: OrdinalColorScale;
	/** A category's colour, or undefined when not scaled. */
	colorOf(category: Category): string | undefined;
}

/** What {@link createSeries}'s function takes on each update. */
export interface SeriesSpec<T> {
	data: readonly T[];
	series: Channel<T, BandKey> | undefined;
	/** An explicit colour prop is set: the scale (and legend) step aside. */
	overridden: boolean;
	mark: LegendMark;
	/** Only these indices count towards the categories. */
	counted?: readonly number[] | undefined;
	dates?: DateSink | null;
}

/**
 * Reads a layer's `series` channel and its colour scale. Call once, in
 * `setup`; call the result in each `update`. Caches the per-datum read by
 * `data` and channel identity, and the categories by value.
 */
export function createSeries<T>(
	layer: ChartLayer,
): (spec: SeriesSpec<T>) => SeriesState {
	let ofCache:
		| { data: readonly T[]; series: unknown; value: Category[] | undefined }
		| undefined;
	let categories: readonly BandKey[] = [];
	return (spec) => {
		if (ofCache?.data !== spec.data || ofCache.series !== spec.series) {
			ofCache = {
				data: spec.data,
				series: spec.series,
				value:
					spec.series === undefined
						? undefined
						: channelValues(
								spec.data,
								spec.series,
								undefined,
								"series",
								spec.dates,
							),
			};
		}
		const of = ofCache.value;
		const next: readonly BandKey[] = of
			? uniqueKeys(spec.counted ? spec.counted.map((i) => of[i]) : of)
			: [];
		if (!shallowEqual(categories, next)) categories = next;
		const scaled = of !== undefined && !spec.overridden;
		const scale = layer.colorScale(categories);
		return {
			of,
			categories,
			scaled,
			extent: scaled ? { categories, mark: spec.mark } : undefined,
			scale,
			colorOf: (category) => (scaled ? scale(category) : undefined),
		};
	};
}

/**
 * The indices of each group, in first-seen order: one {@link WHOLE} group of
 * every index without a `series`, else one per category (nullish and NaN
 * categories dropped).
 */
export function groupIndices(
	count: number,
	of: readonly Category[] | undefined,
): Map<GroupKey, number[]> {
	const out = new Map<GroupKey, number[]>();
	if (!of) {
		out.set(
			WHOLE,
			Array.from({ length: count }, (_, i) => i),
		);
		return out;
	}
	for (let i = 0; i < count; i++) {
		const key = of[i];
		if (key === null || key === undefined) continue;
		if (typeof key === "number" && Number.isNaN(key)) continue;
		const group = out.get(key);
		if (group) group.push(i);
		else out.set(key, [i]);
	}
	return out;
}

/**
 * Each datum's key: the `key` channel, else its place within its series,
 * else its index.
 */
export function datumKeysOf<T>(
	data: readonly T[],
	key: Channel<T, BandKey> | undefined,
	of: readonly Category[] | undefined,
	dates?: DateSink | null,
): BandKey[] {
	const own =
		key === undefined
			? undefined
			: channelValues(data, key, undefined, "key", dates);
	return datumKeys(
		data.length,
		own ? (i) => own[i] : undefined,
		of ? (i) => of[i] : undefined,
	);
}

/**
 * Dodge slots for a `series`: each category's slot in the colour scale's
 * order (categories the scale lacks go last).
 */
export function dodgeSlotsFor(
	of: readonly Category[],
	categories: readonly BandKey[],
	scale: OrdinalColorScale,
): { count: number; of: (index: number) => number | undefined } {
	const rank = (key: BandKey) => {
		const i = scale.index(key);
		return i < 0 ? Number.POSITIVE_INFINITY : i;
	};
	const order = [...categories].sort((a, b) => rank(a) - rank(b));
	const slot = new Map<BandKey, number>(order.map((key, i) => [key, i]));
	return {
		count: order.length,
		of: (index: number) => {
			const key = of[index];
			return key === null || key === undefined ? undefined : slot.get(key);
		},
	};
}

/** Each key's position in `keys`. */
export function slotsOf(keys: readonly BandKey[]): Map<BandKey, number> {
	const slots = new Map<BandKey, number>();
	keys.forEach((key, slot) => {
		slots.set(key, slot);
	});
	return slots;
}
