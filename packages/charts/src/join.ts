/**
 * Keyed data transitions (`to` + `blend`) shared by chart marks: the join
 * between the two datasets' keys and each stage's progress. A key in both
 * ends updates (interpolates in data space), one only in `to` enters at its
 * new place, one only in `data` exits at its old place. Stages come from the
 * enclosing chart, or from the join alone outside one.
 *
 * Each is a factory called once in
 * a composite's `setup` that returns a function to call in every `update`.
 * The factory keeps last-input caches (keys compared by value), so a frame
 * of a blend recomputes the stage progress and nothing else. Internal.
 */

import type { BandKey, Point } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { Channel, DateSink } from "./data/channels.js";
import { channelValues } from "./data/channels.js";
import type {
	AxisExtent,
	ColorExtent,
	LayerTransition,
} from "./frame/types.js";
import type { JoinStages, JoinStaging, KeyedJoin } from "./math/join.js";
import {
	joinStages,
	keyedJoin,
	stageProgress,
	staggeredStageProgress,
} from "./math/join.js";
import { datumKeys, uniqueKeys } from "./math/ordinal.js";
import {
	clipPolylineToX,
	clipRingToX,
	revealCutoff,
	xExtent,
} from "./math/reveal.js";
import type { Category, GroupKey } from "./series.js";
import { slotsOf, WHOLE } from "./series.js";
import { shallowEqual } from "./util.js";

/** One update's view of a keyed join. See {@link createJoin}. */
export interface JoinState {
	/** True while a transition is requested (`to` given). */
	active: boolean;
	/** Every key to keep an item for: the union while active, else `data`'s keys. */
	keys: readonly BandKey[];
	/** The join, while active. */
	join: KeyedJoin | undefined;
	/** Where each key sits in `data`'s keys. */
	fromSlots: Map<BandKey, number>;
	/** Where each key sits in `to`'s keys, while active. */
	toSlots: Map<BandKey, number> | undefined;
	/** The blend, clamped (0 when inactive). */
	t: number;
	/** The stages in use, while active. */
	stages: JoinStages | undefined;
	/** Progress of the update stage, 0..1 (0 when inactive). */
	update: number;
	/** Progress of the enter stage, 0..1 (0 when inactive). */
	enter: number;
	/** One entering key's progress through the enter stage: its own sub-window under `enterStagger`, else `enter`. */
	enterOf(key: BandKey): number;
	/** Progress of the exit stage, 0..1 (0 when inactive). */
	exit: number;
	/** Whether anything enters or exits, including the mark's own `more` (false when inactive). */
	flags: { enters: boolean; exits: boolean };
}

/** What {@link createJoin}'s function takes on each update. */
export interface JoinSpec {
	fromKeys: readonly BandKey[];
	/** `to`'s keys, or undefined without a transition. */
	toKeys: readonly BandKey[] | undefined;
	blend: number | undefined;
	staging: JoinStaging | undefined;
	/** The enclosing chart's stages (`frame.join`), which win over the join's own. */
	chartStages?: JoinStages | undefined;
	/** Enters and exits beyond the keys (a radar's axes), so the stages make room. */
	more?: { enters?: boolean; exits?: boolean } | undefined;
	/** Fraction of the enter stage spent staggering entering keys, 0..0.95. */
	enterStagger?: number | undefined;
	/** Each entering key's stagger rank; defaults to `to`'s order. */
	enterRanks?: (
		entering: readonly BandKey[],
		join: KeyedJoin,
	) => readonly number[];
}

function sameOptional(
	a: readonly BandKey[] | undefined,
	b: readonly BandKey[] | undefined,
): boolean {
	return a === b || (a !== undefined && b !== undefined && shallowEqual(a, b));
}

function sameStages(a: JoinStages | undefined, b: JoinStages | undefined) {
	return (
		a === b ||
		(!!a &&
			!!b &&
			a.eased === b.eased &&
			shallowEqual(a.update, b.update) &&
			shallowEqual(a.enter, b.enter) &&
			shallowEqual(a.exit, b.exit))
	);
}

/**
 * Makes a keyed join for one mark. Call once, in `setup`; call the result
 * in every `update` with that update's keys and blend.
 *
 * @returns `(spec) => JoinState`, caching the join while the keys are equal
 *   by value.
 */
export function createJoin(): (spec: JoinSpec) => JoinState {
	let fromKeys: readonly BandKey[] = [];
	let toKeys: readonly BandKey[] | undefined;
	let joined: KeyedJoin | undefined;
	let fromSlots = new Map<BandKey, number>();
	let toSlots: Map<BandKey, number> | undefined;
	let started = false;
	let own: JoinStages | undefined;
	let staggerCache:
		| {
				join: KeyedJoin;
				spread: number;
				ranks: JoinSpec["enterRanks"];
				value:
					| { rank: Map<BandKey, number>; count: number; spread: number }
					| undefined;
		  }
		| undefined;
	return (spec) => {
		const fromChanged = !started || !shallowEqual(fromKeys, spec.fromKeys);
		const toChanged = !started || !sameOptional(toKeys, spec.toKeys);
		started = true;
		if (fromChanged) {
			fromKeys = spec.fromKeys;
			fromSlots = slotsOf(fromKeys);
		}
		if (toChanged) {
			toKeys = spec.toKeys;
			toSlots = toKeys ? slotsOf(toKeys) : undefined;
		}
		if (fromChanged || toChanged)
			joined = toKeys ? keyedJoin(fromKeys, toKeys) : undefined;
		const active = toKeys !== undefined;
		const more = joined ? spec.more : undefined;
		const flags = {
			enters: !!(joined?.enters || more?.enters),
			exits: !!(joined?.exits || more?.exits),
		};
		const next = joined
			? joinStages({
					enters: flags.enters,
					exits: flags.exits,
					staging: spec.staging,
				})
			: undefined;
		if (!sameStages(own, next)) own = next;
		const stages = active ? (spec.chartStages ?? own) : undefined;
		const t = active ? clamp01(spec.blend ?? 0) : 0;
		const progressOf = (
			pick: (stages: JoinStages) => readonly [number, number],
		) => (stages ? stageProgress(t, pick(stages), stages.eased) : 0);
		const enter = progressOf((s) => s.enter);
		// The enter stagger's ranks, count and spread; from the join alone so
		// it holds still through a scrub.
		const spread = spec.enterStagger ?? 0;
		let entering:
			| { rank: Map<BandKey, number>; count: number; spread: number }
			| undefined;
		if (joined && spread > 0) {
			if (
				staggerCache &&
				staggerCache.join === joined &&
				staggerCache.spread === spread &&
				staggerCache.ranks === spec.enterRanks
			) {
				entering = staggerCache.value;
			} else {
				const current = joined;
				const list = current.keys.filter((key) => !current.from.has(key));
				if (list.length >= 2) {
					const order = spec.enterRanks?.(list, current);
					const rank = new Map<BandKey, number>();
					list.forEach((key, i) => {
						rank.set(key, order?.[i] ?? i);
					});
					entering = { rank, count: list.length, spread };
				}
				staggerCache = {
					join: current,
					spread,
					ranks: spec.enterRanks,
					value: entering,
				};
			}
		}
		return {
			active,
			keys: joined?.keys ?? fromKeys,
			join: joined,
			fromSlots,
			toSlots,
			t,
			stages,
			update: progressOf((s) => s.update),
			enter,
			enterOf: (key) => {
				const rank = entering?.rank.get(key);
				if (!entering || rank === undefined || !stages) return enter;
				return staggeredStageProgress(
					t,
					stages.enter,
					stages.eased,
					rank,
					entering.count,
					entering.spread,
				);
			},
			exit: progressOf((s) => s.exit),
			flags,
		};
	};
}

/** Which end of a transition a key's datum is read from. */
export type JoinEnd = "from" | "to";

/** What one key is on one frame of a keyed transition. See {@link joinFrame}. */
export interface JoinFrame<S> {
	/** Its state: `data`'s, `to`'s, or the two blended by the update stage. */
	state: S;
	/** 0..1 presence: `1 − exit` while leaving, `enter` while arriving, else 1. */
	presence: number;
	/** The end its datum is read from: the nearer one while it updates. */
	end: JoinEnd;
	/** That datum's index in its end's data. */
	index: number;
	/**
	 * While an axis changes kind, for a key in both ends mid-update: each end's
	 * own state and the update progress, so the mark can blend them in scene
	 * units; `state` is then only the data-unit blend.
	 */
	pair?: { a: S; b: S; u: number };
}

/**
 * One key's frame: in both ends it blends from `a` to `b` on the update
 * stage; only in `data` it stays at `a` as presence falls; only in `to` it
 * stands at `b` as presence rises. Marks spend `presence` like their reveal
 * spends `progress`, so exit is the reveal reversed.
 *
 * @param blend - Blends two states at update progress `u`.
 * @param key - The key, so an entering one reads its staggered enter.
 * @param pair - Keep both ends' states mid-swap: pass `space.swapping`.
 * @returns The frame, or undefined when neither end has the key.
 */
export function joinFrame<S>(
	join: JoinState,
	a: { state: S; index: number } | undefined,
	b: { state: S; index: number } | undefined,
	blend: (a: S, b: S, u: number) => S,
	key?: BandKey,
	pair = false,
): JoinFrame<S> | undefined {
	if (!join.active) {
		return a
			? { state: a.state, presence: 1, end: "from", index: a.index }
			: undefined;
	}
	if (a && b) {
		const u = join.update;
		const near = u < 0.5;
		const frame: JoinFrame<S> = {
			state: u <= 0 ? a.state : u >= 1 ? b.state : blend(a.state, b.state, u),
			presence: 1,
			end: near ? "from" : "to",
			index: near ? a.index : b.index,
		};
		if (pair && u > 0 && u < 1) frame.pair = { a: a.state, b: b.state, u };
		return frame;
	}
	if (a)
		return {
			state: a.state,
			presence: 1 - join.exit,
			end: "from",
			index: a.index,
		};
	if (b)
		return {
			state: b.state,
			presence: key === undefined ? join.enter : join.enterOf(key),
			end: "to",
			index: b.index,
		};
	return undefined;
}

/** One update's keyed data: the join, plus where each key's datum is at each end. */
export interface KeyedData extends JoinState {
	/** Each `to` datum's category, with a `series` and a transition. */
	toOf: Category[] | undefined;
	/** A key's datum index in `data`, or -1 (entering). */
	fromIndex(key: BandKey): number;
	/** A key's datum index in `to`, or -1 (leaving, or no transition). */
	toIndex(key: BandKey): number;
}

/** What {@link createKeyedData}'s function takes on each update. */
export interface KeyedDataSpec<T> {
	data: readonly T[];
	to: readonly T[] | undefined;
	key: Channel<T, BandKey> | undefined;
	series: Channel<T, BandKey> | undefined;
	/** `data`'s categories (the `series` channel read across it), if any. */
	of: readonly Category[] | undefined;
	/** The indices a dataset draws, in draw order; defaults to all. */
	drawn?: (data: readonly T[]) => readonly number[];
	blend: number | undefined;
	staging: JoinStaging | undefined;
	chartStages?: JoinStages | undefined;
	more?: { enters?: boolean; exits?: boolean } | undefined;
	enterStagger?: number | undefined;
	/** As {@link JoinSpec.enterRanks}, also given each entering key's index in `to`. */
	enterRanks?: (
		entering: readonly BandKey[],
		join: KeyedJoin,
		toIndex: (key: BandKey) => number,
	) => readonly number[];
	/** The chart's date sink, for channels reading dates. */
	dates?: DateSink | null;
}

/**
 * The keyed join of a per-datum mark (dots, stems, error bars, ticks): each
 * end's keys (the `key` channel, else place within series, else index),
 * restricted to what the mark draws. Call once, in `setup`; call the result
 * in each `update`, draw its `keys` and read each key's frame with
 * {@link joinFrame} (or all of them with {@link joinFrames}).
 */
export function createKeyedData<T>(): (spec: KeyedDataSpec<T>) => KeyedData {
	const join = createJoin();
	/** One end's drawn indices and their keys, cached by its inputs. */
	const endCache = () => {
		let last:
			| {
					data: readonly T[];
					of: readonly Category[] | undefined;
					key: unknown;
					drawn: unknown;
					value: { indices: readonly number[]; keys: BandKey[] };
			  }
			| undefined;
		return (
			data: readonly T[],
			of: readonly Category[] | undefined,
			spec: KeyedDataSpec<T>,
		) => {
			if (
				last &&
				last.data === data &&
				last.of === of &&
				last.key === spec.key &&
				last.drawn === spec.drawn
			)
				return last.value;
			const channel = spec.key;
			const own =
				channel === undefined
					? undefined
					: channelValues(data, channel, undefined, "key", spec.dates);
			const all = datumKeys(
				data.length,
				own ? (i) => own[i] : undefined,
				of ? (i) => of[i] : undefined,
			);
			const indices = spec.drawn?.(data) ?? all.map((_, i) => i);
			const value = { indices, keys: indices.map((i) => all[i] as BandKey) };
			last = { data, of, key: spec.key, drawn: spec.drawn, value };
			return value;
		};
	};
	const fromEnd = endCache();
	const toEnd = endCache();
	/** The `enterRanks` wrapper, kept while its inputs are, so the join's stagger cache holds. */
	let ranksCache:
		| {
				own: KeyedDataSpec<T>["enterRanks"];
				to: { indices: readonly number[] } | undefined;
				value: JoinSpec["enterRanks"];
		  }
		| undefined;
	let toOfCache:
		| { to: readonly T[]; series: unknown; value: Category[] }
		| undefined;
	return (spec) => {
		let toOf: Category[] | undefined;
		if (spec.to !== undefined && spec.series !== undefined) {
			if (toOfCache?.to !== spec.to || toOfCache.series !== spec.series) {
				toOfCache = {
					to: spec.to,
					series: spec.series,
					value: channelValues(
						spec.to,
						spec.series,
						undefined,
						"series",
						spec.dates,
					),
				};
			}
			toOf = toOfCache.value;
		}
		const ranksFor = (
			own: KeyedDataSpec<T>["enterRanks"],
			end: { indices: readonly number[] } | undefined,
		): JoinSpec["enterRanks"] => {
			if (ranksCache && ranksCache.own === own && ranksCache.to === end)
				return ranksCache.value;
			const value: JoinSpec["enterRanks"] = own
				? (entering, joined) =>
						own(entering, joined, (key) => {
							const slot = joined.to.get(key);
							return slot === undefined ? -1 : (end?.indices[slot] ?? -1);
						})
				: undefined;
			ranksCache = { own, to: end, value };
			return value;
		};
		const from = fromEnd(spec.data, spec.of, spec);
		const to = spec.to === undefined ? undefined : toEnd(spec.to, toOf, spec);
		const state = join({
			fromKeys: from.keys,
			toKeys: to?.keys,
			blend: spec.blend,
			staging: spec.staging,
			chartStages: spec.chartStages,
			more: spec.more,
			enterStagger: spec.enterStagger,
			enterRanks: ranksFor(spec.enterRanks, to),
		});
		return {
			...state,
			toOf,
			fromIndex: (key) => {
				const slot = state.fromSlots.get(key);
				return slot === undefined ? -1 : (from.indices[slot] ?? -1);
			},
			toIndex: (key) => {
				const slot = state.toSlots?.get(key);
				return slot === undefined ? -1 : (to?.indices[slot] ?? -1);
			},
		};
	};
}

/**
 * Every key's {@link joinFrame} for a per-datum mark, in key order.
 * `stateOf(end, index)` reads one end's datum, or undefined where it draws
 * nothing.
 *
 * @param pair - Mid-swap, keep both ends' states (`space.swapping`).
 */
export function joinFrames<S>(
	keyed: KeyedData,
	stateOf: (end: JoinEnd, index: number) => S | undefined,
	blend: (a: S, b: S, u: number) => S,
	pair = false,
): Map<BandKey, JoinFrame<S>> {
	const out = new Map<BandKey, JoinFrame<S>>();
	const end = (side: JoinEnd, index: number) => {
		if (index < 0) return undefined;
		const state = stateOf(side, index);
		return state === undefined ? undefined : { state, index };
	};
	for (const key of keyed.keys) {
		const frame = joinFrame(
			keyed,
			end("from", keyed.fromIndex(key)),
			keyed.active ? end("to", keyed.toIndex(key)) : undefined,
			blend,
			key,
			pair,
		);
		if (frame) out.set(key, frame);
	}
	return out;
}

/** Each key's place in a per-datum mark's reveal order: `data`'s keys, then those only in `to`. */
export function keyRanks(keys: readonly BandKey[]): Map<BandKey, number> {
	return new Map(keys.map((key, i) => [key, i]));
}

/**
 * A layer's `transition` report: the far end's extents, the blend and what
 * the join contains. Undefined without a transition.
 *
 * @param far - The `to` data's extents (omit axes the layer doesn't report),
 * and `enters` / `exits` when the layer decides them rather than the join.
 */
export function layerTransition(
	join: JoinState,
	staging: JoinStaging | undefined,
	far: {
		x?: AxisExtent;
		y?: AxisExtent;
		enters?: boolean;
		exits?: boolean;
	},
): LayerTransition | undefined {
	if (!join.active) return undefined;
	const { enters, exits } = join.flags;
	return { t: join.t, staging, enters, exits, ...far };
}

/**
 * A layer's `color` report across a keyed transition: both ends' categories,
 * `data`'s first (so colours hold still), with each end's as `ends` (so the
 * legend fades entries). Otherwise the report as given.
 */
export function transitionColor(
	own: ColorExtent | undefined,
	toCategories: readonly Category[] | undefined,
): ColorExtent | undefined {
	if (!own || !toCategories) return own;
	const to = uniqueKeys(toCategories);
	return {
		...own,
		categories: uniqueKeys([...own.categories, ...to]),
		ends: { from: own.categories, to },
	};
}

/* ------------------------------------------------- grouped (summarising) marks */

/** The keyed join of a grouped mark (one shape per `series` category, or one {@link WHOLE} shape). */
export interface GroupJoin extends JoinState {
	/** Every group to draw: both ends' while a transition runs (`data`'s first), else `data`'s. */
	groups: readonly GroupKey[];
	/** The categories `to` draws (its groups, less {@link WHOLE}), while a transition runs. */
	toCategories: readonly BandKey[] | undefined;
	/** Whether a group is only in `to`: it enters, on the enter stage. */
	entering(key: GroupKey): boolean;
	/** A group's fade: `1 − exit` for one only `data` has (it leaves), else 1. */
	fade(key: GroupKey): number;
}

/** What {@link createGroupJoin}'s function takes on each update. */
export interface GroupJoinSpec {
	fromGroups: readonly GroupKey[];
	toGroups: readonly GroupKey[] | undefined;
	blend: number | undefined;
	staging: JoinStaging | undefined;
	chartStages?: JoinStages | undefined;
	enterStagger?: number | undefined;
	enterRanks?: (
		entering: readonly BandKey[],
		join: KeyedJoin,
	) => readonly number[];
}

/**
 * The keyed join of a grouped mark: groups matched by category. A group in
 * both ends morphs on the update stage, one only in `to` enters, one only
 * in `data` exits. Without `to`, `groups` is `data`'s and every stage reads
 * 0. Call once, in `setup`.
 */
export function createGroupJoin(): (spec: GroupJoinSpec) => GroupJoin {
	const join = createJoin();
	return (spec) => {
		// Group keys are categories, or the one `WHOLE` group: compared by
		// identity like any key, so the join treats the symbol as one more key.
		const state = join({
			fromKeys: spec.fromGroups as BandKey[],
			toKeys: spec.toGroups as BandKey[] | undefined,
			blend: spec.blend,
			staging: spec.staging,
			chartStages: spec.chartStages,
			enterStagger: spec.enterStagger,
			enterRanks: spec.enterRanks,
		});
		const toCategories = spec.toGroups?.filter((key) => key !== WHOLE) as
			| BandKey[]
			| undefined;
		return {
			...state,
			groups: state.keys as readonly GroupKey[],
			toCategories,
			entering: (key) => !!state.join && !state.join.from.has(key as BandKey),
			fade: (key) =>
				state.join && !state.join.to.has(key as BandKey) ? 1 - state.exit : 1,
		};
	};
}

/**
 * An entering shape swept in along x (along y when `vertical`): its lines
 * and rings cut at the front `enter` of the way across their extent.
 */
export function sweepIn(
	shape: {
		lines: readonly (readonly Point[])[];
		rings: readonly (readonly Point[])[];
	},
	enter: number,
	vertical = false,
): { lines: Point[][]; rings: Point[][] } {
	if (enter >= 1)
		return {
			lines: shape.lines.map((line) => [...line]),
			rings: shape.rings.map((ring) => [...ring]),
		};
	if (!(enter > 0)) return { lines: [], rings: [] };
	// Transposed, a sweep up y is a sweep along x.
	const flip = (run: readonly Point[]): Point[] =>
		vertical ? run.map((p) => ({ x: p.y, y: p.x })) : [...run];
	const lines = shape.lines.map(flip);
	const rings = shape.rings.map(flip);
	const extent = xExtent([...lines, ...rings]);
	if (!extent) return { lines: [], rings: [] };
	const cut = revealCutoff(enter, extent);
	return {
		lines: lines.flatMap((line) => clipPolylineToX(line, cut)).map(flip),
		rings: rings
			.map((ring) => clipRingToX(ring, cut))
			.filter((ring) => ring.length > 0)
			.map(flip),
	};
}
