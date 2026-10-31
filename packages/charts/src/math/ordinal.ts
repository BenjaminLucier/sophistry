/**
 * Categorical colour: an ordinal scale from category keys to colours, a few
 * categorical schemes, and the per-datum keys that give marks their identity.
 */

import type { BandKey } from "@sophistry/core/geometry";

/**
 * An ordinal colour scale: category keys to colours, in domain order,
 * cycling through `range` when there are more categories than colours.
 *
 * @category Math & helpers
 */
export interface OrdinalColorScale {
	/** The categories, in order, each once. */
	readonly domain: readonly BandKey[];
	/** The colours cycled over the domain. */
	readonly range: readonly string[];
	/** The colour of `key`; a key not in the domain gets `unknown`. */
	(key: BandKey | null | undefined): string;
	/** The position of `key` in the domain, or -1. */
	index(key: BandKey | null | undefined): number;
}

/**
 * Options for {@link ordinalColorScale}.
 *
 * @category Math & helpers
 */
export interface OrdinalColorScaleOptions {
	/**
	 * Colour for a key not in the domain, and for nullish keys. Defaults to the first colour of
	 * `range`.
	 */
	unknown?: string;
}

/**
 * The categories of `values` in first-seen order, each once; nullish
 * entries are skipped. Like a band scale, `1` and `"1"` are different keys.
 *
 * @category Math & helpers
 */
export function uniqueKeys(
	values: Iterable<BandKey | null | undefined>,
): BandKey[] {
	const seen = new Set<BandKey>();
	for (const value of values) {
		if (value === null || value === undefined) continue;
		if (typeof value === "number" && Number.isNaN(value)) continue;
		seen.add(value);
	}
	return [...seen];
}

/**
 * An ordinal colour scale: category `i` of `domain` gets
 * `range[i % range.length]`. Pin the full domain to keep colours stable
 * when data is filtered.
 *
 * @param domain - The categories, in order; duplicates and nullish entries are dropped.
 * @throws {RangeError} If `range` is empty.
 * @category Math & helpers
 */
export function ordinalColorScale(
	domain: Iterable<BandKey | null | undefined>,
	range: readonly string[],
	options: OrdinalColorScaleOptions = {},
): OrdinalColorScale {
	if (range.length === 0) {
		throw new RangeError(
			"ordinalColorScale: `range` needs at least one colour.",
		);
	}
	const keys = uniqueKeys(domain);
	const slots = new Map<BandKey, number>();
	keys.forEach((key, i) => {
		slots.set(key, i);
	});
	const unknown = options.unknown ?? range[0];
	const index = (key: BandKey | null | undefined): number =>
		key === null || key === undefined ? -1 : (slots.get(key) ?? -1);
	const scale = ((key: BandKey | null | undefined) => {
		const i = index(key);
		return i < 0 ? unknown : range[i % range.length];
	}) as OrdinalColorScale;
	Object.defineProperties(scale, {
		domain: { value: keys, enumerable: true },
		range: { value: range, enumerable: true },
		index: { value: index, enumerable: true },
	});
	return scale;
}

/**
 * Okabe & Ito's eight colours, distinct under common colour-vision
 * deficiencies, with black swapped for a mid grey so it reads on dark grounds.
 *
 * @category Math & helpers
 */
export const okabeIto: readonly string[] = Object.freeze([
	"#e69f00",
	"#56b4e9",
	"#009e73",
	"#f0e442",
	"#0072b2",
	"#d55e00",
	"#cc79a7",
	"#999999",
]);

/**
 * Tableau's ten categorical colours (2016 revision).
 *
 * @category Math & helpers
 */
export const tableau10: readonly string[] = Object.freeze([
	"#4e79a7",
	"#f28e2c",
	"#e15759",
	"#76b7b2",
	"#59a14f",
	"#edc949",
	"#af7aa1",
	"#ff9da7",
	"#9c755f",
	"#bab0ab",
]);

/**
 * Observable's ten categorical colours.
 *
 * @category Math & helpers
 */
export const observable10: readonly string[] = Object.freeze([
	"#4269d0",
	"#efb118",
	"#ff725c",
	"#6cc5b0",
	"#3ca951",
	"#ff8ab7",
	"#a463f2",
	"#97bbf5",
	"#9c6b4e",
	"#9498a0",
]);

/**
 * One identity per datum, so marks keep their node across data changes: an
 * explicit `key` wins (`"<key>#<n>"` for repeats), else the datum's place
 * within its `series`, else its index. Keys are strings or numbers,
 * compared with `===`, unique within the call.
 *
 * @param count - Number of data.
 * @category Math & helpers
 */
export function datumKeys(
	count: number,
	key?: (index: number) => BandKey | null | undefined,
	series?: (index: number) => BandKey | null | undefined,
): BandKey[] {
	const keys: BandKey[] = [];
	if (key) {
		const seen = new Map<BandKey, number>();
		for (let i = 0; i < count; i++) {
			const own = key(i);
			const base: BandKey = own === null || own === undefined ? `#${i}` : own;
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			keys.push(n === 0 ? base : `${String(base)}#${n + 1}`);
		}
		return keys;
	}
	if (series) {
		const counts = new Map<BandKey | null | undefined, number>();
		for (let i = 0; i < count; i++) {
			const group = series(i);
			const n = counts.get(group) ?? 0;
			counts.set(group, n + 1);
			keys.push(`${typeof group}:${String(group)}\u0001${n}`);
		}
		return keys;
	}
	for (let i = 0; i < count; i++) keys.push(i);
	return keys;
}
