/** `rankRace`: a bar chart race from long-format rows. */

import type { BandKey } from "@sophistry/core/geometry";
import type { Channel } from "../data/channels";
import { channelValues, numberValues } from "../data/channels";
import type { RaceOptions, RaceTimeline } from "../math/keyframes";
import { raceTimeline } from "../math/keyframes";
import { uniqueKeys } from "../math/ordinal";

/**
 * Options for {@link rankRace}.
 *
 * @category Charts
 */
export interface RankRaceOptions<T> extends RaceOptions {
	/** What races: a key of `T` or `(d, i) => key`. */
	key: Channel<T, BandKey>;
	/** When the row's value holds: a key of `T` or `(d, i) => number`. */
	time: Channel<T, number>;
	/** The value: a key of `T` or `(d, i) => number`. */
	value: Channel<T, number>;
}

/**
 * A bar chart race from long-format rows (one per key per moment): see
 * {@link raceTimeline}. Missing keys count as 0; duplicate rows are summed.
 * Pass `view(time)`'s `categories` and `slot` to the `chart`'s `yAxis` (with
 * `clip`) so bars and names slide together, and pin colours with
 * `chart.create({ color: { domain: race.keys } })`.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export function rankRace<T>(
	rows: readonly T[],
	options: RankRaceOptions<T>,
): RaceTimeline {
	const names = channelValues(rows, options.key, undefined, "key");
	const times = numberValues(rows, options.time, undefined, "time");
	const values = numberValues(rows, options.value, undefined, "value");
	const keys = uniqueKeys(names);
	const moments = [...new Set(times.filter((t) => Number.isFinite(t)))].sort(
		(a, b) => a - b,
	);
	const column = new Map<BandKey, number>();
	keys.forEach((key, i) => {
		column.set(key, i);
	});
	const row = new Map<number, number>();
	moments.forEach((time, i) => {
		row.set(time, i);
	});
	const table = moments.map(() => keys.map(() => 0));
	rows.forEach((_, i) => {
		const name = names[i];
		const k = row.get(times[i]);
		const e =
			name === null || name === undefined ? undefined : column.get(name);
		const v = values[i];
		if (k === undefined || e === undefined || !Number.isFinite(v)) return;
		table[k][e] += v;
	});
	return raceTimeline(keys, moments, table, {
		swap: options.swap,
		order: options.order,
		top: options.top,
	});
}
