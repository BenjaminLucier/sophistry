/**
 * Keyed data transitions: which marks enter, update and exit between two
 * datasets, and how one blend `t` splits into stages. Pure, so a transition
 * is a function of `t` and scrubs backwards exactly as it plays.
 */

import type { BandKey, Range } from "@sophistry/core/geometry";

/**
 * Which keys of a keyed join are in which dataset.
 *
 * @category Math & helpers
 */
export interface KeyedJoin {
	/** Every key once: `from`'s in order, then the keys only `to` has, in `to`'s order. */
	readonly keys: readonly BandKey[];
	/** Each key's index in the `from` keys. Missing: the key enters. */
	readonly from: ReadonlyMap<BandKey, number>;
	/** Each key's index in the `to` keys. Missing: the key exits. */
	readonly to: ReadonlyMap<BandKey, number>;
	/** True when some key is only in `to`. */
	readonly enters: boolean;
	/** True when some key is only in `from`. */
	readonly exits: boolean;
}

/**
 * Matches two key lists: keys in both update, keys only in `to` enter,
 * keys only in `from` exit. Keys are compared with `===`.
 *
 * @param from - The keys at `t = 0`, one per datum.
 * @param to - The keys at `t = 1`, one per datum.
 * @category Math & helpers
 */
export function keyedJoin(
	from: readonly BandKey[],
	to: readonly BandKey[],
): KeyedJoin {
	const fromAt = new Map<BandKey, number>();
	from.forEach((key, i) => {
		if (!fromAt.has(key)) fromAt.set(key, i);
	});
	const toAt = new Map<BandKey, number>();
	to.forEach((key, i) => {
		if (!toAt.has(key)) toAt.set(key, i);
	});
	const keys: BandKey[] = [...fromAt.keys()];
	let enters = false;
	for (const key of toAt.keys()) {
		if (fromAt.has(key)) continue;
		keys.push(key);
		enters = true;
	}
	let exits = false;
	for (const key of fromAt.keys()) {
		if (!toAt.has(key)) {
			exits = true;
			break;
		}
	}
	return { keys, from: fromAt, to: toAt, enters, exits };
}

/**
 * How a keyed transition spends its blend: `"staged"` runs exit, then
 * update, then enter (domains grow before the update and shrink after),
 * each stage eased; `"together"` runs everything at once, linearly, so the
 * driving track's easing applies.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Math & helpers
 */
export type JoinStaging = "staged" | "together";

/**
 * A stage's share of the blend, `[start, end]` within 0..1.
 *
 * @category Math & helpers
 */
export type StageWindow = readonly [start: number, end: number];

/**
 * Where each stage of a keyed transition falls within its blend. See
 * {@link joinStages}.
 *
 * @category Math & helpers
 */
export interface JoinStages {
	/** Exiting marks shrink or fade at their old place. */
	readonly exit: StageWindow;
	/** Domains that grow rescale here, before the update. */
	readonly expand: StageWindow;
	/** Matched marks move from old to new values; domains that shift without growing or shrinking rescale here too. */
	readonly update: StageWindow;
	/** Domains that shrink rescale here, after the update. */
	readonly contract: StageWindow;
	/** Entering marks grow or fade in at their new place. */
	readonly enter: StageWindow;
	/** Whether each stage eases in and out on its own (`"staged"`). */
	readonly eased: boolean;
}

/**
 * Options for {@link joinStages}.
 *
 * @category Math & helpers
 */
export interface JoinStageOptions {
	/** Some mark exits. */
	exits?: boolean;
	/** Some mark enters. */
	enters?: boolean;
	/** Some domain grows (the new range contains the old). */
	expand?: boolean;
	/** Some domain shrinks (the old range contains the new). */
	contract?: boolean;
	/** See {@link JoinStaging}. @default "staged" */
	staging?: JoinStaging;
}

const WHOLE: StageWindow = [0, 1];

/** Cubic in-out, the `"smooth"` easing. */
function smooth(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Splits a keyed transition's blend into up to three equal phases, each
 * present only when it has work: exits and growing domains, then the update
 * (always), then shrinking domains and enters.
 *
 * @category Math & helpers
 */
export function joinStages(options: JoinStageOptions = {}): JoinStages {
	if (options.staging === "together") {
		return {
			exit: WHOLE,
			expand: WHOLE,
			update: WHOLE,
			contract: WHOLE,
			enter: WHOLE,
			eased: false,
		};
	}
	const first = !!(options.exits || options.expand);
	const last = !!(options.enters || options.contract);
	const count = 1 + (first ? 1 : 0) + (last ? 1 : 0);
	const share = 1 / count;
	const a = first ? share : 0;
	const b = last ? 1 - share : 1;
	const before: StageWindow = [0, a];
	const middle: StageWindow = [a, b];
	const after: StageWindow = [b, 1];
	return {
		exit: before,
		expand: before,
		update: middle,
		contract: after,
		enter: after,
		eased: true,
	};
}

/**
 * The window a key's entries fade on: the exit (or enter) stage, or the
 * update when the transition has none, so an entry one end shows is still
 * whole at its end.
 *
 * @internal
 */
export function keyWindow(own: StageWindow, update: StageWindow): StageWindow {
	return own[1] > own[0] ? own : update;
}

/**
 * How far a stage has got at blend `t`, 0..1: 0 before its window, 1 after,
 * eased within it when `eased`. An empty window is a step at its start.
 *
 * @param eased - Ease within the window. Defaults to false.
 * @category Math & helpers
 */
export function stageProgress(
	t: number,
	window: StageWindow,
	eased = false,
): number {
	const [start, end] = window;
	if (!(t > start)) return t >= start && end <= start ? 1 : 0;
	if (t >= end) return 1;
	const local = (t - start) / (end - start);
	return eased ? smooth(local) : local;
}

/**
 * One item's progress through a staggered stage: item `rank` of `count`
 * starts `spread · rank / (count − 1)` of the way in and takes `1 − spread`
 * of the window, eased on its own sub-window when `eased`. The total spread
 * is fixed, so 5 or 500 items take the same time, and every item is exact at
 * the window's ends.
 *
 * @param spread - 0 (all together, as {@link stageProgress}) to 0.95.
 * @category Math & helpers
 */
export function staggeredStageProgress(
	t: number,
	window: StageWindow,
	eased: boolean,
	rank: number,
	count: number,
	spread: number,
): number {
	const s = Math.min(0.95, Math.max(0, spread || 0));
	if (s === 0 || count <= 1) return stageProgress(t, window, eased);
	const linear = stageProgress(t, window, false);
	const start = (s * Math.min(Math.max(rank, 0), count - 1)) / (count - 1);
	const raw = (linear - start) / (1 - s);
	const local = raw > 0 ? (raw < 1 ? raw : 1) : 0;
	return eased ? smooth(local) : local;
}

/**
 * How a domain changes between two ranges: `"expand"` when the new contains
 * the old, `"contract"` when the old contains the new, `"none"` when equal,
 * `"shift"` otherwise.
 *
 * @category Math & helpers
 */
export function rescaleKind(
	from: Readonly<Range>,
	to: Readonly<Range>,
): "none" | "expand" | "contract" | "shift" {
	const f0 = Math.min(from[0], from[1]);
	const f1 = Math.max(from[0], from[1]);
	const t0 = Math.min(to[0], to[1]);
	const t1 = Math.max(to[0], to[1]);
	if (f0 === t0 && f1 === t1) return "none";
	if (t0 <= f0 && t1 >= f1) return "expand";
	if (f0 <= t0 && f1 >= t1) return "contract";
	return "shift";
}

/**
 * The window a domain change rescales in: growing before the update,
 * shrinking after it, a shift with it.
 *
 * @category Math & helpers
 */
export function rescaleWindow(
	stages: JoinStages,
	kind: "none" | "expand" | "contract" | "shift",
): StageWindow {
	return kind === "expand"
		? stages.expand
		: kind === "contract"
			? stages.contract
			: stages.update;
}
