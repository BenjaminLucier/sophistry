/**
 * `createSlots`: a headless model of which key sits in which slot, for sorts,
 * queues and traversals. Motion is caller-supplied (`Motion`; eased straight by
 * default, `arcMotion`).
 *
 * Operations are planned against a cursor (`SlotPlan`), not the live order, so a
 * whole run can be built up front and scrubbed. Each is a pure transition
 * `orderBefore -> orderAfter`: positions move between explicit layout endpoints,
 * and the live order flips in a zero-length leaf that `restore()` rewinds.
 * `items` is in stable registration order so a keyed list never remounts; slot
 * order is `order`.
 */

import type { Point } from "../geometry";
import type { Readable, Track } from "../reactive";
import { derive, track } from "../reactive";
import type { Easing } from "../tween";
import { resolveInterpolator } from "../tween";
import type { Animation } from "./animation";
import { animation } from "./animation";
import { lagged, parallel, sequence } from "./sequence";
import { driveProgress, driveTrack } from "./types";

/**
 * Maps a slot index to a point in scene units.
 *
 * `count` is the number of slots *in the order the point is asked for*, so
 * layouts that depend on it (a centred row, a circle) reflow when items are
 * inserted or removed.
 *
 * @category Layout
 */
export type SlotLayout = (index: number, count: number) => Point;

/** Options for {@link rowSlots}. @category Layout */
export interface RowSlotsOptions {
	/**
	 * Distance between neighbouring slot centres.
	 * @default 1.2
	 */
	spacing?: number;
	/**
	 * Row height (y).
	 * @default 0
	 */
	y?: number;
	/**
	 * `"center"` (default) keeps the row centred on `x` as its length changes;
	 * `"start"` pins slot 0 at `x` and grows to the right.
	 */
	align?: "center" | "start";
	/**
	 * Centre (or start, for `align: "start"`) x.
	 * @default 0
	 */
	x?: number;
}

/**
 * A horizontal row of slots, left to right.
 *
 * @param options - See {@link RowSlotsOptions}.
 * @returns A {@link SlotLayout}.
 * @category Layout
 */
export function rowSlots(options: RowSlotsOptions = {}): SlotLayout {
	const { spacing = 1.2, y = 0, align = "center", x = 0 } = options;
	return (index, count) => ({
		x:
			align === "center"
				? x + (index - (count - 1) / 2) * spacing
				: x + index * spacing,
		y,
	});
}

/** Options for {@link gridSlots}. @category Layout */
export interface GridSlotsOptions {
	/** Number of columns. Defaults to `ceil(sqrt(count))`. */
	columns?: number;
	/**
	 * Horizontal distance between slot centres.
	 * @default 1.2
	 */
	columnSpacing?: number;
	/** Vertical distance between slot centres. Defaults to `columnSpacing`. */
	rowSpacing?: number;
	/** Centre of the grid. Defaults to the origin. */
	center?: Point;
}

/**
 * A row-major grid of slots (rows run downward, since y is up), centred on
 * `center`.
 *
 * @param options - See {@link GridSlotsOptions}.
 * @returns A {@link SlotLayout}.
 *
 * @category Layout
 */
export function gridSlots(options: GridSlotsOptions = {}): SlotLayout {
	const columnSpacing = options.columnSpacing ?? 1.2;
	const rowSpacing = options.rowSpacing ?? columnSpacing;
	const center = options.center ?? { x: 0, y: 0 };
	return (index, count) => {
		const columns = Math.max(
			1,
			options.columns ?? Math.ceil(Math.sqrt(Math.max(1, count))),
		);
		const rows = Math.ceil(count / columns);
		const col = index % columns;
		const row = Math.floor(index / columns);
		return {
			x: center.x + (col - (columns - 1) / 2) * columnSpacing,
			y: center.y - (row - (rows - 1) / 2) * rowSpacing,
		};
	};
}

/** Options for {@link circleSlots}. @category Layout */
export interface CircleSlotsOptions {
	/**
	 * Circle radius.
	 * @default 3
	 */
	radius?: number;
	/**
	 * Angle of slot 0 in radians, counter-clockwise from +x. The top by default.
	 * @default Math.PI / 2
	 */
	start?: number;
	/** Go clockwise (default) or counter-clockwise. */
	clockwise?: boolean;
	/** Centre of the circle. Defaults to the origin. */
	center?: Point;
}

/**
 * Slots evenly spaced round a circle; the layout of a ring buffer, a round
 * table, or a cycle of states.
 *
 * @param options - See {@link CircleSlotsOptions}.
 * @returns A {@link SlotLayout}.
 *
 * @category Layout
 */
export function circleSlots(options: CircleSlotsOptions = {}): SlotLayout {
	const { radius = 3, start = Math.PI / 2, clockwise = true } = options;
	const center = options.center ?? { x: 0, y: 0 };
	return (index, count) => {
		const angle =
			start +
			(clockwise ? -1 : 1) * ((2 * Math.PI * index) / Math.max(1, count));
		return {
			x: center.x + radius * Math.cos(angle),
			y: center.y + radius * Math.sin(angle),
		};
	};
}

/**
 * One keyed element of a {@link Slots} model: its key plus the tracks a view
 * reads. `position` is written by motions; `opacity` and `scale` (starting at 1)
 * only by the default enter and exit hooks.
 *
 * @category Layout
 */
export interface SlotItem<K = string | number> {
	/** The caller's identity for this item. */
	readonly key: K;
	/** Where the item is drawn, in scene units. */
	readonly position: Track<Point>;
	/** Opacity, 1 by default; the default enter and exit hooks drive it. */
	readonly opacity: Track<number>;
	/** Uniform scale, 1 by default; the default enter and exit hooks drive it. */
	readonly scale: Track<number>;
	/** The item's current slot index, or `undefined` while it is not in the order. */
	readonly slot: Readable<number | undefined>;
}

/**
 * What a {@link Motion}, enter or exit hook is told about the item it moves.
 *
 * @category Layout
 */
export interface MotionContext<K = string | number> {
	/** The item (and so its tracks). */
	item: SlotItem<K>;
	/** Slot index before the operation; `undefined` for an entering item. */
	fromSlot: number | undefined;
	/** Slot index after the operation; `undefined` for an exiting item. */
	toSlot: number | undefined;
	/** The operation's `duration` option (or the model default), in seconds. */
	duration: number;
	/** The operation's `easing` option (or the model default). */
	easing: Easing;
}

/**
 * Moves one item between two points. Return a seekable animation that writes
 * `ctx.item.position` from `from` to `to` using those endpoints (not the track),
 * ideally lasting `ctx.duration`.
 *
 * @category Layout
 */
export type Motion<K = string | number> = (
	key: K,
	from: Point,
	to: Point,
	ctx: MotionContext<K>,
) => Animation;

/**
 * Brings an item in (`enter`, at its slot point `at`) or takes it out (`exit`,
 * from `at`). Same rules as a {@link Motion}: write explicit start values, not
 * values read from tracks.
 *
 * @category Layout
 */
export type Presence<K = string | number> = (
	key: K,
	at: Point,
	ctx: MotionContext<K>,
) => Animation;

/**
 * Options every operation accepts; each overrides the model default for that
 * operation only.
 *
 * @category Layout
 */
export interface SlotOpOptions<K = string | number> {
	/** How each moved item travels. Defaults to the model's, itself an eased straight move. */
	motion?: Motion<K>;
	/** Seconds per item motion. Defaults to the model's (0.5). */
	duration?: number;
	/** Easing handed to the motion. Defaults to the model's (`"smooth"`). */
	easing?: Easing;
	/**
	 * Seconds between consecutive item starts (in slot order), for a ripple
	 * through a rotate or permute. Defaults to 0 (all together).
	 */
	lag?: number;
	/**
	 * When the live order flips for a reordering: `"end"` as the motion
	 * finishes, or `"start"` as it begins. `insert` and `remove` ignore it; they
	 * change membership as the enter begins or the exit ends.
	 * @default "end"
	 */
	commit?: "start" | "end";
}

/**
 * Options for {@link createSlots}.
 *
 * @category Layout
 */
export interface SlotsOptions<K = string | number> extends SlotOpOptions<K> {
	/** Slot index to point. Defaults to a centred {@link rowSlots}. */
	layout?: SlotLayout;
	/** How inserted items appear. Defaults to opacity 0 to 1 and scale 0.6 to 1. */
	enter?: Presence<K>;
	/** How removed items disappear. Defaults to opacity 1 to 0 and scale 1 to 0.6. */
	exit?: Presence<K>;
}

/**
 * The planned operations; each reads the cursor, advances it and returns the
 * animation. Obtain one from {@link Slots.plan}.
 *
 * @category Layout
 */
export interface SlotPlan<K = string | number> {
	/** The order after every operation built so far: the algorithm's working copy. */
	readonly order: readonly K[];
	/** Index of `key` in the planned order, or -1. */
	indexOf(key: K): number;
	/** Exchanges two keys' slots. */
	swap(a: K, b: K, options?: SlotOpOptions<K>): Animation;
	/** Exchanges the keys at two slot indices. */
	swapAt(i: number, j: number, options?: SlotOpOptions<K>): Animation;
	/**
	 * Takes `key` out of its slot and puts it at `toIndex` (index in the order
	 * *after* the move), shifting the keys between.
	 */
	move(key: K, toIndex: number, options?: SlotOpOptions<K>): Animation;
	/**
	 * Re-slots to exactly `order`, which must contain the same keys. The
	 * general case every other reordering is a special case of.
	 */
	permute(order: readonly K[], options?: SlotOpOptions<K>): Animation;
	/**
	 * Cyclic shift: every key moves `by` slots toward the end (negative toward
	 * the start), wrapping round. `rotate(-1)` dequeues the head to the tail.
	 */
	rotate(by?: number, options?: SlotOpOptions<K>): Animation;
	/**
	 * Adds a new key at `index` (default: the end). Others open a gap, then
	 * the new item enters.
	 */
	insert(
		key: K,
		index?: number,
		options?: SlotOpOptions<K> & { enter?: Presence<K> },
	): Animation;
	/**
	 * Removes a key. The item exits, then the others close the gap. The item
	 * (and its tracks) is kept, so it can be inserted again.
	 */
	remove(
		key: K,
		options?: SlotOpOptions<K> & { exit?: Presence<K> },
	): Animation;
}

/**
 * The live model: identity, slots and positions.
 *
 * Everything here reflects the animations that have run (or been scrubbed)
 * so far; `order` and `items` are Readables to bind or watch, the lookups
 * answer for now. See the module header for the planning model.
 *
 * @category Layout
 */
export interface Slots<K = string | number> {
	/** Keys by slot index. */
	readonly order: Readable<readonly K[]>;
	/** Present items in stable (first-registered) order, for a keyed list. */
	readonly items: Readable<readonly SlotItem<K>[]>;
	/** Slot index of `key` now, or `undefined` if it is not present. */
	slotOf(key: K): number | undefined;
	/** Whether `key` is in the order now. */
	has(key: K): boolean;
	/** The item for `key`, present or not (items outlive removal), or `undefined` if never registered. */
	item(key: K): SlotItem<K> | undefined;
	/** The layout's point for a slot in the current order. */
	positionOf(index: number): Point;
	/** Starts a plan from the current live order. */
	plan(): SlotPlan<K>;
}

/** An immutable order plus its derived lookups. */
interface Snapshot<K> {
	order: readonly K[];
	slot: ReadonlyMap<K, number>;
	members: readonly SlotItem<K>[];
}

function samePoint(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

/**
 * An eased straight-line {@link Motion}; what operations use unless told
 * otherwise. Start and end are explicit, so it never reads the track.
 */
function straightMotion<K>(
	_key: K,
	from: Point,
	to: Point,
	ctx: MotionContext<K>,
): Animation {
	return driveTrack(ctx.item.position, to, {
		from,
		duration: ctx.duration,
		easing: ctx.easing,
		interpolate: resolveInterpolator("point"),
	});
}

/**
 * Options for {@link arcMotion}.
 *
 * @category Layout
 */
export interface ArcMotionOptions {
	/**
	 * How far the path bulges sideways at its midpoint, as a fraction of the
	 * distance travelled. Positive bends to the left of the direction of
	 * travel (counter-clockwise, y up), negative to the right. Defaults to 0.5.
	 */
	bend?: number;
}

/**
 * A {@link Motion} along an arc that bulges `bend` of the chord length. The side
 * is relative to travel, so the two items of a swap pass on opposite sides.
 *
 * @param options - See {@link ArcMotionOptions}.
 * @returns A motion for `createSlots({ motion })` or any operation's options.
 * @category Layout
 */
export function arcMotion<K = string | number>(
	options: ArcMotionOptions = {},
): Motion<K> {
	const bend = options.bend ?? 0.5;
	return (_key, from, to, ctx) => {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		// Left-hand normal of the travel direction, scaled to `bend` chords.
		const nx = -dy * bend;
		const ny = dx * bend;
		return driveProgress(
			(t) => {
				// A quadratic Bezier whose control point sits `2 * bend` chords off
				// the chord, so the curve itself peaks at `bend` chords.
				const side = 4 * t * (1 - t);
				ctx.item.position.set({
					x: from.x + dx * t + nx * side,
					y: from.y + dy * t + ny * side,
				});
			},
			{ duration: ctx.duration, easing: ctx.easing },
		);
	};
}

const defaultEnter: Presence<never> = (_key, _at, ctx) =>
	parallel(
		driveTrack(ctx.item.opacity, 1, {
			from: 0,
			duration: ctx.duration,
			easing: ctx.easing,
		}),
		driveTrack(ctx.item.scale, 1, {
			from: 0.6,
			duration: ctx.duration,
			easing: ctx.easing,
		}),
	);

const defaultExit: Presence<never> = (_key, _at, ctx) =>
	parallel(
		driveTrack(ctx.item.opacity, 0, {
			from: 1,
			duration: ctx.duration,
			easing: ctx.easing,
		}),
		driveTrack(ctx.item.scale, 0.6, {
			from: 1,
			duration: ctx.duration,
			easing: ctx.easing,
		}),
	);

/**
 * Creates a slots model: keyed items that keep their identity while changing
 * slot. Keys must be unique. Render from `items()` and build seekable operations
 * with {@link Slots.plan}.
 *
 * @param keys - The initial order, one key per slot.
 * @param options - Layout, default motion and pacing; see {@link SlotsOptions}.
 * @returns The live {@link Slots} model.
 * @see {@link https://sophistry.dev/guides/layout/#items-that-change-slots}
 * @category Layout
 */
export function createSlots<K = string | number>(
	keys: readonly K[],
	options: SlotsOptions<K> = {},
): Slots<K> {
	const layout = options.layout ?? rowSlots();
	const defaults = {
		motion: options.motion ?? (straightMotion as Motion<K>),
		duration: options.duration ?? 0.5,
		easing: options.easing ?? ("smooth" as Easing),
		lag: options.lag ?? 0,
		commit: options.commit ?? ("end" as const),
	};
	const defaultEnterHook = (options.enter ?? defaultEnter) as Presence<K>;
	const defaultExitHook = (options.exit ?? defaultExit) as Presence<K>;

	/** Every item ever registered, in registration order (append-only). */
	const registry: SlotItem<K>[] = [];
	const byKey = new Map<K, SlotItem<K>>();
	/** The live snapshot: order, lookups and present items. */
	const state = track<Snapshot<K>>({ order: [], slot: new Map(), members: [] });

	const snapshot = (order: readonly K[]): Snapshot<K> => {
		const slot = new Map<K, number>();
		order.forEach((key, i) => {
			slot.set(key, i);
		});
		return {
			order,
			slot,
			members: registry.filter((item) => slot.has(item.key)),
		};
	};

	const register = (key: K, at: Point): SlotItem<K> => {
		const existing = byKey.get(key);
		if (existing) return existing;
		const item: SlotItem<K> = {
			key,
			position: track(at),
			opacity: track(1),
			scale: track(1),
			slot: derive(state, (current) => current.slot.get(key)),
		};
		byKey.set(key, item);
		registry.push(item);
		return item;
	};

	if (new Set(keys).size !== keys.length) {
		throw new Error("createSlots: keys must be unique");
	}
	keys.forEach((key, i) => {
		register(key, layout(i, keys.length));
	});
	state.set(snapshot([...keys]));

	const need = (key: K): SlotItem<K> => {
		const item = byKey.get(key);
		if (!item) throw new Error(`slots: unknown key ${String(key)}`);
		return item;
	};

	const plan = (): SlotPlan<K> => {
		let current = state.peek();
		/** Last planned point of items that left, so re-entry can restore it on rewind. */
		const lastAt = new Map<K, Point>();

		const resolve = (o: SlotOpOptions<K> = {}) => ({
			motion: o.motion ?? defaults.motion,
			duration: o.duration ?? defaults.duration,
			easing: o.easing ?? defaults.easing,
			lag: o.lag ?? defaults.lag,
			commit: o.commit ?? defaults.commit,
		});
		type Resolved = ReturnType<typeof resolve>;

		/** Zero-length leaf: the order is `after` once reached, `before` once rewound. */
		const commitLeaf = (
			before: Snapshot<K>,
			after: Snapshot<K>,
			also?: { seek?: () => void; restore?: () => void },
		) =>
			animation({
				duration: 0,
				seek: () => {
					state.set(after);
					also?.seek?.();
				},
				restore: () => {
					state.set(before);
					also?.restore?.();
				},
			});

		/** Motions for every item present in both orders whose point changes. */
		const motionsBetween = (
			before: Snapshot<K>,
			after: Snapshot<K>,
			r: Resolved,
		): Animation[] => {
			const moves: Animation[] = [];
			after.order.forEach((key, toSlot) => {
				const fromSlot = before.slot.get(key);
				if (fromSlot === undefined) return;
				const from = layout(fromSlot, before.order.length);
				const to = layout(toSlot, after.order.length);
				if (samePoint(from, to)) return;
				moves.push(
					r.motion(key, from, to, {
						item: need(key),
						fromSlot,
						toSlot,
						duration: r.duration,
						easing: r.easing,
					}),
				);
			});
			return moves;
		};

		const together = (moves: Animation[], r: Resolved): Animation =>
			r.lag > 0 ? lagged(moves, { lag: r.lag }) : parallel(...moves);

		const reorder = (order: readonly K[], o?: SlotOpOptions<K>): Animation => {
			const r = resolve(o);
			const before = current;
			const after = snapshot(order);
			// Build first, advance last: a motion that throws must not leave the plan
			// ahead of an animation that was never returned.
			const moves = motionsBetween(before, after, r);
			const commit = commitLeaf(before, after);
			current = after;
			if (moves.length === 0) return commit;
			const travel = together(moves, r);
			return r.commit === "start"
				? parallel(commit, travel)
				: sequence(travel, commit);
		};

		const indexOf = (key: K): number => current.slot.get(key) ?? -1;
		const slotOrThrow = (key: K): number => {
			const i = indexOf(key);
			if (i < 0) throw new Error(`slots: ${String(key)} is not in the order`);
			return i;
		};
		const checkIndex = (i: number, max: number, what: string) => {
			if (!Number.isInteger(i) || i < 0 || i > max) {
				throw new RangeError(`slots: ${what} ${i} is out of range 0..${max}`);
			}
		};

		const api: SlotPlan<K> = {
			get order() {
				return current.order;
			},
			indexOf,
			swapAt(i, j, o) {
				const last = current.order.length - 1;
				checkIndex(i, last, "swapAt index");
				checkIndex(j, last, "swapAt index");
				const next = [...current.order];
				[next[i], next[j]] = [next[j] as K, next[i] as K];
				return reorder(next, o);
			},
			swap(a, b, o) {
				return api.swapAt(slotOrThrow(a), slotOrThrow(b), o);
			},
			move(key, toIndex, o) {
				const from = slotOrThrow(key);
				checkIndex(toIndex, current.order.length - 1, "move target");
				const next = [...current.order];
				next.splice(from, 1);
				next.splice(toIndex, 0, key);
				return reorder(next, o);
			},
			permute(order, o) {
				const known = current.slot;
				if (
					order.length !== known.size ||
					new Set(order).size !== order.length ||
					order.some((key) => !known.has(key))
				) {
					throw new Error(
						"slots: permute needs exactly the keys currently in the order",
					);
				}
				return reorder([...order], o);
			},
			rotate(by = 1, o) {
				if (!Number.isInteger(by)) {
					throw new RangeError(
						`slots: rotate by ${by} must be an integer number of slots`,
					);
				}
				const n = current.order.length;
				if (n === 0) return reorder([], o);
				const shift = ((by % n) + n) % n;
				const next = current.order.map(
					(_, i) => current.order[(i - shift + n) % n] as K,
				);
				return reorder(next, o);
			},
			insert(key, index, o) {
				if (current.slot.has(key)) {
					throw new Error(`slots: ${String(key)} is already in the order`);
				}
				const at = index ?? current.order.length;
				checkIndex(at, current.order.length, "insert index");
				const r = resolve(o);
				const before = current;
				const next = [...before.order];
				next.splice(at, 0, key);
				const point = layout(at, next.length);
				const item = register(key, point);
				const snap = snapshot(next);
				const previousAt = lastAt.get(key) ?? point;
				const enter = o?.enter ?? defaultEnterHook;
				const gap = motionsBetween(before, snap, r);
				const arrive = parallel(
					commitLeaf(before, snap, {
						// The item may have sat elsewhere when it left.
						seek: () => item.position.set(point),
						restore: () => item.position.set(previousAt),
					}),
					enter(key, point, {
						item,
						fromSlot: undefined,
						toSlot: at,
						duration: r.duration,
						easing: r.easing,
					}),
				);
				current = snap;
				return gap.length === 0 ? arrive : sequence(together(gap, r), arrive);
			},
			remove(key, o) {
				const from = slotOrThrow(key);
				const r = resolve(o);
				const before = current;
				const next = before.order.filter((k) => k !== key);
				const after = snapshot(next);
				const item = need(key);
				const point = layout(from, before.order.length);
				const exit = o?.exit ?? defaultExitHook;
				const leave = exit(key, point, {
					item,
					fromSlot: from,
					toSlot: undefined,
					duration: r.duration,
					easing: r.easing,
				});
				const close = motionsBetween(before, after, r);
				const settle = commitLeaf(before, after);
				current = after;
				lastAt.set(key, point);
				return sequence(
					leave,
					close.length === 0 ? settle : parallel(settle, together(close, r)),
				);
			},
		};
		return api;
	};

	return {
		order: derive(state, (current) => current.order),
		items: derive(state, (current) => current.members),
		slotOf: (key) => state.peek().slot.get(key),
		has: (key) => state.peek().slot.has(key),
		item: (key) => byKey.get(key),
		positionOf: (index) => layout(index, state.peek().order.length),
		plan,
	};
}
