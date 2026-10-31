/**
 * The instance bank behind `instances()`: every item's channel values as a
 * struct of typed arrays, keyed reconciliation, and per-item tweens and
 * springs advanced only for the items in flight.
 *
 * Layout. Items sit in **slots** `0..size-1`, which are also their indices in
 * the published spec (so `event.item` is a slot). Each channel is a column:
 * a number takes one float per slot, a point two, a colour four (RGBA,
 * parsed once per distinct string), and anything else (a "discrete" value)
 * one entry of a plain array. Next to the drawn values (`current`) a column
 * keeps the resolved targets (`to`) and, once anything has moved, each
 * segment's start values (`from`) and start velocities (`velocity`), which
 * springs need to keep their momentum across a retarget. The raw target
 * values are kept too, so an item at rest reports exactly what its channel
 * returned (`"tomato"` stays `"tomato"`, not `rgba(255, 99, 71, 1)`).
 *
 * Motion. A data change, `animateItem` or `retarget` starts a **segment** for
 * an item: from its current values to the new targets, starting `delay`
 * (plus its stagger) seconds from now. All of an item's moving channels share
 * the segment's timing. A tween evaluates `from + (to - from) * easing(t)`; a
 * spring evaluates the closed-form solution of `tween/spring.ts` per
 * component, from the segment's start displacement and velocity, and
 * settles once every moving component's energy norm is within `restDelta`
 * of its value at release (so `restDelta` is a fraction of the move, as in
 * progress units, and settling does not depend on the values' scale). A
 * spring retargeted mid-flight starts its new segment with the exact
 * velocity it had; a tween retargeted mid-flight passes its velocity on to a
 * following spring.
 *
 * Active set. Only slots with a segment in flight are on the active list,
 * and {@link InstanceBank.advance} visits only those: an idle bank costs
 * nothing per frame, and one item moving among 100k costs one item.
 *
 * Order. After a reconciliation the slots hold the new data's items in data
 * order; an item that just left (and animates out) keeps its place among the
 * neighbours it had, right after the item that preceded it before the change
 * (or first, when nothing did). Items that finish exiting are dropped.
 *
 * Steady updates. A reconciliation whose keys are the slots' keys in the
 * same order (a chart re-projecting the same data every frame) changes no
 * slot: it skips the keyed diff and the permutation, writes the targets in
 * place, and reports which channels' values changed, so the node redoes
 * only the passes those channels feed.
 */

import { toCss, tryParseColor } from "../color/parse";
import type { Color } from "../color/types";
import type { EasingFunction } from "../tween/easing";
import type { SpringSpec, SpringState } from "../tween/spring";
import { springAt } from "../tween/spring";

/**
 * How a channel's values are stored: `number` (one float), `point` (two),
 * `color` (four: RGBA, alpha 0..1), or `discrete` (kept as is, switched at
 * the start of a move).
 *
 * @internal
 */
export type ChannelKind = "number" | "point" | "color" | "discrete";

/**
 * A segment's timing, resolved: what a slot moves with.
 *
 * @internal
 */
export interface ResolvedTiming {
	/** Seconds (tweens). */
	readonly duration: number;
	/** Tweens' curve. */
	readonly easing: EasingFunction;
	/** A spring instead of a tween, or null. */
	readonly spring: SpringSpec | null;
	/** The spring's natural frequency (`sqrt(stiffness / mass)`). */
	readonly omega: number;
	/** Springs: settled once within this fraction of the move. */
	readonly restDelta: number;
	/** Springs: start velocity of an item at rest, in progress units per second. */
	readonly velocity: number;
	/** Seconds before the segment starts. */
	readonly delay: number;
	/** Extra delay per item, by position among the items starting together. */
	readonly stagger: number | ((index: number, count: number) => number);
}

/** A colour component's channel layout: red, green, blue, alpha. */
const COLOR_WIDTH = 4;

/** Each channel kind's float count per slot. */
const WIDTHS: Record<ChannelKind, number> = {
	number: 1,
	point: 2,
	color: COLOR_WIDTH,
	discrete: 0,
};

/** Marker for "this channel has no value for the item" in value callbacks. */
export const NO_VALUE: unique symbol = Symbol("no value");

/** Parsed colours by string, shared by every bank (bounded). */
const parsedColors = new Map<string, Color | null>();

/** A colour value parsed once per distinct string; null for `"none"`, unparsable or absent. */
function parseColorValue(value: unknown): Color | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		const color = value as Color;
		return typeof color.r === "number" ? color : null;
	}
	if (value === "none" || value === "") return null;
	let parsed = parsedColors.get(value);
	if (parsed === undefined) {
		parsed = tryParseColor(value);
		if (parsedColors.size > 4096) parsedColors.clear();
		parsedColors.set(value, parsed);
	}
	return parsed;
}

/** Whether `value` reads as a colour: a parsable string or a `Color` object. */
function isColorValue(value: unknown): boolean {
	if (typeof value === "string") return parseColorValue(value) !== null;
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Color).r === "number" &&
		typeof (value as Color).g === "number" &&
		typeof (value as Color).b === "number"
	);
}

/** Whether `value` is an `{x, y}` point. */
function isPointValue(value: unknown): value is { x: number; y: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { x?: unknown }).x === "number" &&
		typeof (value as { y?: unknown }).y === "number"
	);
}

/**
 * The kind a channel's first defined value implies. A string that is a
 * colour is a colour; other strings (and objects that are neither points nor
 * colours) are discrete.
 *
 * @internal
 */
export function channelKindOf(value: unknown): ChannelKind {
	if (typeof value === "number") return "number";
	if (isPointValue(value)) return "point";
	if (isColorValue(value)) return "color";
	return "discrete";
}

/**
 * One channel's columns. `from` and `velocity` are made the first time
 * anything moves: a bank whose changes are all instant never allocates them.
 *
 * @internal
 */
export class ChannelColumn {
	readonly key: string;
	/** Bit of this channel in the masks `advance` reports (0 past 31 channels: all bits). */
	readonly bit: number;
	kind: ChannelKind | null = null;
	width = 0;
	/** Drawn values, `width` per slot. */
	current: Float64Array = new Float64Array(0);
	/** Resolved targets, `width` per slot. */
	to: Float64Array = new Float64Array(0);
	/** Segment start values; null until something moves. */
	from: Float64Array | null = null;
	/** Segment start velocities; null until something moves. */
	velocity: Float64Array | null = null;
	/** Raw target per slot, exactly as the channel returned it. */
	targets: unknown[] = [];
	/** Discrete channels: the value drawn now. */
	values: unknown[] = [];

	constructor(key: string, index: number) {
		this.key = key;
		this.bit = index < 31 ? 1 << index : -1;
	}

	/** Fixes the kind on the first defined value (later values must agree). */
	settleKind(value: unknown): void {
		if (this.kind !== null || value === undefined) return;
		this.kind = channelKindOf(value);
		this.width = WIDTHS[this.kind];
	}
}

/**
 * One channel's value for an item (`NO_VALUE` when the channel does not
 * cover it, which keeps the item's previous value).
 *
 * @internal
 */
export type ChannelTarget = (item: unknown, index: number) => unknown;

/**
 * Options of an {@link InstanceBank}.
 *
 * @internal
 */
export interface InstanceBankOptions {
	/**
	 * The value a channel stands for when an item's value is undefined, used
	 * for drawing and interpolating (the raw `undefined` is still what the
	 * item reports at rest): a prop's default, the theme's stroke colour,
	 * `"none"` for a fill.
	 */
	fallback: (key: string) => unknown;
}

/** What one {@link InstanceBank.advance} did. */
export interface AdvanceResult {
	/** Bits of the channels whose drawn values changed (see `ChannelColumn.bit`). */
	changed: number;
	/** Whether items finished exiting and were dropped (slots moved). */
	removed: boolean;
}

/**
 * A slot's class in a reconciliation.
 *
 * @internal
 */
export const SlotChange = {
	/** A new key. */
	ENTER: 0,
	/** A key that stays (or came back while exiting). */
	UPDATE: 1,
	/** A key that just left. */
	EXIT: 2,
	/** A key already exiting before this change. */
	EXITING: 3,
} as const;

/** One of {@link SlotChange}'s values. @internal */
export type SlotChange = (typeof SlotChange)[keyof typeof SlotChange];

/**
 * How one reconciliation moves its items, resolved by the node from the
 * transition: per class a timing (null: instant) and value overrides.
 *
 * @internal
 */
export interface ReconcilePlan {
	/** Timing of kept items whose targets changed; null jumps. */
	update: ResolvedTiming | null;
	/** Timing of entering items; null (or no `enterFrom`) appears in place. */
	enter: ResolvedTiming | null;
	/** Start values of an entering item, per channel; `NO_VALUE` starts at its target. */
	enterFrom:
		| ((channel: number, item: unknown, index: number) => unknown)
		| null;
	/** Timing of exiting items; null (or no `exitTo`) drops them at once. */
	exit: ResolvedTiming | null;
	/** End values of an exiting item, per channel; `NO_VALUE` keeps its value. */
	exitTo: ((channel: number, item: unknown, index: number) => unknown) | null;
}

/**
 * The struct-of-arrays store of an instances node: slots, channel columns,
 * keyed reconciliation and the active set. Knows nothing of scenes.
 *
 * @internal
 */
export class InstanceBank {
	readonly channels: readonly ChannelColumn[];
	private readonly options: InstanceBankOptions;

	/** Number of slots (items drawn, exiting ones included). */
	size = 0;
	/** Seconds of motion so far: the time base of every segment. */
	private time = 0;

	/* Per slot. */
	private keys: unknown[] = [];
	private items: unknown[] = [];
	/** Index in the data the item last came from (an exiting item keeps its old one). */
	private dataIndex: number[] = [];
	/** Whether the slot animates out and is then dropped. */
	private exiting = new Uint8Array(0);
	/** Bank time at which the slot's segment starts (after its delay). */
	private start = new Float64Array(0);
	/** The slot's segment timing, or null at rest. */
	private timing: (ResolvedTiming | null)[] = [];
	/** Channel bits moving in the slot's segment. */
	private moving = new Int32Array(0);
	/** Position in `active`, or -1. */
	private activeIndex = new Int32Array(0);

	/** Slots in flight. */
	private active: number[] = [];
	/** Key to slot. */
	private slotOf = new Map<unknown, number>();
	/** Bits of the channels whose raw targets changed in this reconciliation. */
	private targetBits = 0;
	/** Scratch for the incoming keys, reused across reconciliations. */
	private incomingKeys: unknown[] = [];

	/** Scratch for the spring basis. */
	private readonly basisA: SpringState = { displacement: 0, velocity: 0 };
	private readonly basisB: SpringState = { displacement: 0, velocity: 0 };

	constructor(channelKeys: readonly string[], options: InstanceBankOptions) {
		this.channels = channelKeys.map((key, i) => new ChannelColumn(key, i));
		this.options = options;
	}

	/** How many slots are in flight. */
	get activeCount(): number {
		return this.active.length;
	}

	/** The key at `slot`, or undefined. */
	keyAt(slot: number): unknown {
		return slot >= 0 && slot < this.size ? this.keys[slot] : undefined;
	}

	/** The datum at `slot`, or undefined. */
	itemAt(slot: number): unknown {
		return slot >= 0 && slot < this.size ? this.items[slot] : undefined;
	}

	/** The slot of `key`, or -1. */
	indexOf(key: unknown): number {
		return this.slotOf.get(key) ?? -1;
	}

	/** Whether `slot` is exiting. */
	isExiting(slot: number): boolean {
		return this.exiting[slot] === 1;
	}

	/** Whether `channel` of `slot` is moving now. */
	isMoving(slot: number, channel: ChannelColumn): boolean {
		return (
			this.activeIndex[slot] >= 0 && (this.moving[slot] & channel.bit) !== 0
		);
	}

	/* ------------------------------------------------------------ values */

	/**
	 * A channel's value at `slot` as the item reports it: the raw target at
	 * rest, the in-between value while moving (a number, a point, a CSS
	 * colour string).
	 */
	value(slot: number, channel: ChannelColumn): unknown {
		if (channel.kind === null) return channel.targets[slot];
		if (channel.kind === "discrete") return channel.values[slot];
		if (!this.isMoving(slot, channel)) return channel.targets[slot];
		const at = slot * channel.width;
		const current = channel.current;
		switch (channel.kind) {
			case "number":
				return current[at];
			case "point":
				return { x: current[at], y: current[at + 1] };
			case "color":
				return formatColor(current, at);
		}
	}

	/** A number channel's drawn value at `slot` (the fallback for undefined). */
	numberAt(slot: number, channel: ChannelColumn): number {
		return channel.current[slot * channel.width];
	}

	/**
	 * A colour channel's drawn value at `slot` as a CSS string, or undefined
	 * when the item has none: the raw target at rest, formatted while moving.
	 */
	colorAt(slot: number, channel: ChannelColumn): string | undefined {
		if (channel.kind !== "color") {
			const raw = channel.targets[slot];
			return raw === undefined ? undefined : (raw as string);
		}
		if (!this.isMoving(slot, channel)) {
			const raw = channel.targets[slot];
			if (raw === undefined) return undefined;
			return typeof raw === "string" ? raw : toCss(raw as Color);
		}
		return formatColor(channel.current, slot * COLOR_WIDTH);
	}

	/**
	 * A colour channel's drawn RGBA at `slot` into `out` (alpha 0 for none);
	 * false when the channel is not a colour.
	 */
	rgbaAt(slot: number, channel: ChannelColumn, out: Color): boolean {
		if (channel.kind !== "color") return false;
		const at = slot * COLOR_WIDTH;
		out.r = channel.current[at];
		out.g = channel.current[at + 1];
		out.b = channel.current[at + 2];
		out.a = channel.current[at + 3];
		return true;
	}

	/* ---------------------------------------------------- reconciliation */

	/**
	 * Reconciles to `items`: new keys enter, kept keys update, gone keys exit,
	 * each moving per `plan`. `targets[channel](item, index)` is a channel's
	 * value for an item (see {@link ChannelTarget}). Instant changes are
	 * written at once; moves start now (after their delays) and run on
	 * `advance`.
	 *
	 * Returns the bits of the channels whose targets changed (see
	 * `ChannelColumn.bit`) when every slot kept its key and place, or -1 when
	 * the slots changed (items entered, left or moved).
	 */
	reconcile(
		items: readonly unknown[],
		keyOf: (item: unknown, index: number) => unknown,
		targets: readonly ChannelTarget[],
		plan: ReconcilePlan,
	): number {
		const previousSize = this.size;
		const count = items.length;
		// Filled in order (appending past the end), so the array keeps fast
		// elements; setting a large length on it would not.
		const nextKeys = this.incomingKeys;
		if (nextKeys.length > count) nextKeys.length = count;
		let sameSlots = count === previousSize;
		for (let i = 0; i < count; i++) {
			const key = keyOf(items[i], i);
			nextKeys[i] = key;
			if (sameSlots && key !== this.keys[i]) sameSlots = false;
		}
		this.targetBits = 0;
		if (sameSlots) {
			// The same keys in the same order: every slot stays where it is
			// (an exiting one comes back), so there is nothing to diff or
			// permute. Keys already held by slots are unique.
			const slotItems = this.items;
			const dataIndex = this.dataIndex;
			for (let slot = 0; slot < count; slot++) {
				slotItems[slot] = items[slot];
				dataIndex[slot] = slot;
			}
			if (!this.writeInPlace(targets, plan))
				this.assignTargets(null, targets, plan);
			return this.targetBits;
		}

		const seen = new Map<unknown, number>();
		for (let i = 0; i < count; i++) {
			const key = nextKeys[i];
			if (seen.has(key)) {
				throw new Error(
					`instances: duplicate key ${String(key)} (items ${seen.get(key)} and ${i}); give a \`key\` that is unique per item.`,
				);
			}
			seen.set(key, i);
		}

		// The new order: data order, with each departing (or still exiting)
		// item kept right after the item that preceded it before the change.
		// `trailing[s]` lists the departing slots that follow old slot `s`.
		const exitAnimates = plan.exit !== null && plan.exitTo !== null;
		const leading: number[] = [];
		const trailing = new Map<number, number[]>();
		let anchor = -1;
		for (let slot = 0; slot < previousSize; slot++) {
			const key = this.keys[slot];
			if (seen.has(key)) {
				anchor = slot;
				continue;
			}
			// A key already exiting keeps going; a newly gone one exits now
			// (or is dropped, without an exit transition).
			if (this.exiting[slot] !== 1 && !exitAnimates) continue;
			if (anchor < 0) leading.push(slot);
			else {
				let list = trailing.get(anchor);
				if (!list) {
					list = [];
					trailing.set(anchor, list);
				}
				list.push(slot);
			}
		}

		// Old slot of every new slot (-1: entering) and its class.
		const sources: number[] = [];
		const classes: SlotChange[] = [];
		const newItems: unknown[] = [];
		const newKeys: unknown[] = [];
		const newIndex: number[] = [];
		const pushDeparting = (slot: number) => {
			sources.push(slot);
			classes.push(
				this.exiting[slot] === 1 ? SlotChange.EXITING : SlotChange.EXIT,
			);
			newItems.push(this.items[slot]);
			newKeys.push(this.keys[slot]);
			newIndex.push(this.dataIndex[slot]);
		};
		for (const slot of leading) pushDeparting(slot);
		for (let i = 0; i < items.length; i++) {
			const old = this.slotOf.get(nextKeys[i]);
			sources.push(old ?? -1);
			classes.push(old === undefined ? SlotChange.ENTER : SlotChange.UPDATE);
			newItems.push(items[i]);
			newKeys.push(nextKeys[i]);
			newIndex.push(i);
			if (old !== undefined) {
				const after = trailing.get(old);
				if (after) for (const slot of after) pushDeparting(slot);
			}
		}

		this.permute(sources, newKeys, newItems, newIndex);
		this.assignTargets(classes, targets, plan);
		return -1;
	}

	/**
	 * Rebuilds every per-slot array in the new order: `sources[s]` is the old
	 * slot of new slot `s`, or -1 for a new one (zero-filled; its values are
	 * written by `assignTargets`).
	 */
	private permute(
		sources: readonly number[],
		keys: unknown[],
		items: unknown[],
		dataIndex: number[],
	): void {
		const size = sources.length;
		const exiting = new Uint8Array(size);
		const start = new Float64Array(size);
		const moving = new Int32Array(size);
		const activeIndex = new Int32Array(size).fill(-1);
		const timing = new Array<ResolvedTiming | null>(size).fill(null);
		const active: number[] = [];
		for (let slot = 0; slot < size; slot++) {
			const old = sources[slot];
			if (old < 0) continue;
			exiting[slot] = this.exiting[old];
			start[slot] = this.start[old];
			moving[slot] = this.moving[old];
			timing[slot] = this.timing[old];
			if (this.activeIndex[old] >= 0) {
				activeIndex[slot] = active.length;
				active.push(slot);
			}
		}
		for (const channel of this.channels) permuteColumn(channel, sources);
		this.exiting = exiting;
		this.start = start;
		this.moving = moving;
		this.activeIndex = activeIndex;
		this.timing = timing;
		this.active = active;
		this.keys = keys;
		this.items = items;
		this.dataIndex = dataIndex;
		this.size = size;
		this.slotOf = new Map();
		for (let slot = 0; slot < size; slot++) this.slotOf.set(keys[slot], slot);
	}

	/**
	 * Writes the targets of every slot by class (null: every slot is kept,
	 * `UPDATE`) and starts the moves `plan` asks for.
	 */
	private assignTargets(
		classes: readonly SlotChange[] | null,
		targets: readonly ChannelTarget[],
		plan: ReconcilePlan,
	): void {
		const channels = this.channels;
		// Settle each channel's kind from the first defined value, before any
		// column is written.
		for (let c = 0; c < channels.length; c++) {
			const channel = channels[c];
			if (channel.kind !== null) continue;
			for (let slot = 0; slot < this.size && channel.kind === null; slot++) {
				const change = classes ? classes[slot] : SlotChange.UPDATE;
				if (change === SlotChange.EXIT || change === SlotChange.EXITING)
					continue;
				const value = targets[c](this.items[slot], this.dataIndex[slot]);
				if (value !== NO_VALUE) channel.settleKind(value);
			}
			// No item gives a value: the fallback tells the kind (an `opacity`
			// named only by an exit state is a number all the same).
			if (channel.kind === null)
				channel.settleKind(this.options.fallback(channel.key));
			if (channel.kind !== null) resizeColumn(channel, this.size);
		}

		// Group sizes and running positions, for the stagger.
		const counts = [0, 0, 0];
		const enters = plan.enter !== null && plan.enterFrom !== null;
		const updateValues: unknown[] = new Array(channels.length);
		const enterValues: unknown[] = new Array(channels.length);
		const pending: { slot: number; group: number }[] = [];

		for (let slot = 0; slot < this.size; slot++) {
			const change = classes ? classes[slot] : SlotChange.UPDATE;
			if (change === SlotChange.EXITING) continue;
			const item = this.items[slot];
			const index = this.dataIndex[slot];
			if (change === SlotChange.EXIT) {
				// Exit values; the slot was kept only because the exit animates.
				let moves = false;
				for (let c = 0; c < channels.length; c++) {
					const value = plan.exitTo?.(c, item, index) ?? NO_VALUE;
					updateValues[c] = value;
					if (value !== NO_VALUE) moves = true;
				}
				this.exiting[slot] = 1;
				if (moves && this.writeTargets(slot, updateValues)) {
					pending.push({ slot, group: 2 });
					counts[2]++;
				} else this.markExitDone(slot);
				continue;
			}
			for (let c = 0; c < channels.length; c++) {
				updateValues[c] = targets[c](item, index);
			}
			if (change === SlotChange.ENTER) {
				if (!enters) {
					this.jumpTo(slot, updateValues, null);
					continue;
				}
				for (let c = 0; c < channels.length; c++) {
					enterValues[c] = plan.enterFrom?.(c, item, index) ?? NO_VALUE;
				}
				// Start at the enter values (channels without one start at their
				// target), then head for the targets.
				this.jumpTo(slot, enterValues, updateValues);
				if (this.writeTargets(slot, updateValues)) {
					pending.push({ slot, group: 0 });
					counts[0]++;
				}
				continue;
			}
			// Kept (or back from exiting).
			this.exiting[slot] = 0;
			if (this.writeTargets(slot, updateValues)) {
				if (plan.update) {
					pending.push({ slot, group: 1 });
					counts[1]++;
				} else this.finish(slot);
			}
		}

		const positions = [0, 0, 0];
		const timings = [plan.enter, plan.update, plan.exit];
		for (const { slot, group } of pending) {
			const timing = timings[group] as ResolvedTiming;
			const delay = staggered(timing, positions[group]++, counts[group]);
			this.begin(slot, timing, delay);
		}
		this.dropFinishedExits();
	}

	/**
	 * The steady update, column by column: every slot kept, nothing in
	 * flight (so nothing exiting either), every change instant, and every
	 * channel's kind known. Each channel's values are read in one run (one
	 * channel function over every item), and a slot whose value changed
	 * jumps to it, as `writeTargets` then `finish` would leave it. Returns
	 * false, writing nothing, when the update is not one of these.
	 *
	 * One difference from the slot-by-slot path, invisible in what is drawn:
	 * a raw value equal to the previous one by content (a new point with the
	 * same coordinates) is not stored, even when another channel of the item
	 * changed. Each kind has its own loop, so one channel's calls and reads
	 * stay monomorphic.
	 */
	private writeInPlace(
		targets: readonly ChannelTarget[],
		plan: ReconcilePlan,
	): boolean {
		if (plan.update !== null || this.active.length > 0) return false;
		const channels = this.channels;
		for (const channel of channels) if (channel.kind === null) return false;
		const size = this.size;
		const items = this.items;
		for (let c = 0; c < channels.length; c++) {
			const channel = channels[c] as ChannelColumn;
			const target = targets[c] as ChannelTarget;
			const changed =
				channel.kind === "point"
					? this.writePointsInPlace(channel, target, items, size)
					: this.writeValuesInPlace(channel, target, items, size);
			if (changed) this.targetBits |= channel.bit;
		}
		return true;
	}

	/**
	 * `writeInPlace` for one point channel: a defined point is compared with
	 * the resolved target (a defined previous value is a point, so equal
	 * coordinates are an equal raw value) and written straight into the
	 * columns; anything else goes the general way. Returns whether any
	 * value changed.
	 */
	private writePointsInPlace(
		channel: ChannelColumn,
		target: ChannelTarget,
		items: readonly unknown[],
		size: number,
	): boolean {
		const raw = channel.targets;
		const to = channel.to;
		const current = channel.current;
		let changed = false;
		for (let slot = 0; slot < size; slot++) {
			const value = target(items[slot], slot);
			if (value === NO_VALUE) continue;
			const previous = raw[slot];
			if (previous === value) continue;
			if (!isPointValue(value)) {
				if (sameValue(previous, value)) continue;
				changed = true;
				raw[slot] = value;
				this.resolveTarget(slot, channel, value);
				copyTargetToCurrent(channel, slot);
				continue;
			}
			const x = value.x;
			const y = value.y;
			const at = 2 * slot;
			if (previous !== undefined && to[at] === x && to[at + 1] === y) continue;
			changed = true;
			raw[slot] = value;
			to[at] = x;
			to[at + 1] = y;
			current[at] = x;
			current[at + 1] = y;
		}
		return changed;
	}

	/** `writeInPlace` for one number, colour or discrete channel. Returns whether any value changed. */
	private writeValuesInPlace(
		channel: ChannelColumn,
		target: ChannelTarget,
		items: readonly unknown[],
		size: number,
	): boolean {
		const raw = channel.targets;
		const discrete = channel.kind === "discrete";
		let changed = false;
		for (let slot = 0; slot < size; slot++) {
			const value = target(items[slot], slot);
			if (value === NO_VALUE) continue;
			const previous = raw[slot];
			if (sameValue(previous, value)) continue;
			changed = true;
			raw[slot] = value;
			if (discrete) {
				channel.values[slot] = value;
				continue;
			}
			this.resolveTarget(slot, channel, value);
			if (differs(channel, slot)) copyTargetToCurrent(channel, slot);
		}
		return changed;
	}

	/**
	 * Sets `slot`'s drawn values to `values` at once (channels with
	 * `NO_VALUE` take `fallbackValues`' entry, or keep theirs), with no move.
	 */
	private jumpTo(
		slot: number,
		values: readonly unknown[],
		fallbackValues: readonly unknown[] | null,
	): void {
		for (let c = 0; c < this.channels.length; c++) {
			let value = values[c];
			if (value === NO_VALUE && fallbackValues) value = fallbackValues[c];
			if (value === NO_VALUE) continue;
			const channel = this.channels[c];
			this.storeTarget(slot, channel, value);
			copyTargetToCurrent(channel, slot);
		}
		this.stop(slot);
	}

	/**
	 * Writes new targets for `slot` (`NO_VALUE` keeps a channel's) and
	 * returns whether any target changed, in which case the caller starts the
	 * move (`begin`) or jumps (`finish`). A slot in flight whose targets are
	 * all unchanged keeps its move as it is.
	 */
	private writeTargets(slot: number, values: readonly unknown[]): boolean {
		const channels = this.channels;
		let changed = 0;
		for (let c = 0; c < channels.length; c++) {
			const value = values[c];
			if (value !== NO_VALUE && !sameValue(channels[c].targets[slot], value))
				changed |= channels[c].bit;
		}
		if (changed === 0) return false;
		this.targetBits |= changed;
		const wasActive = this.activeIndex[slot] >= 0;
		// The velocity at this instant, while the old targets are still there.
		if (wasActive) this.captureVelocity(slot);
		let moving = 0;
		for (let c = 0; c < channels.length; c++) {
			const value = values[c];
			if (value === NO_VALUE) continue;
			const channel = channels[c];
			const previous = channel.targets[slot];
			this.storeTarget(slot, channel, value);
			if (channel.kind === "discrete" || channel.kind === null) {
				// Discrete values switch when the move starts (see `begin`).
				if (!Object.is(previous, value)) moving |= channel.bit;
				continue;
			}
			if (differs(channel, slot)) moving |= channel.bit;
		}
		// A slot already in flight keeps moving its other channels too.
		if (wasActive) moving |= this.moving[slot];
		this.moving[slot] = moving;
		return moving !== 0;
	}

	/**
	 * Replaces the start velocities of an in-flight slot with its velocities
	 * now (0 for channels that are not moving), ready for a new segment.
	 */
	private captureVelocity(slot: number): void {
		const timing = this.timing[slot];
		const elapsed = this.time - this.start[slot];
		const mask = this.moving[slot];
		for (const channel of this.channels) {
			const velocity = channel.velocity;
			const from = channel.from;
			if (!velocity || !from || channel.width === 0) continue;
			const at = slot * channel.width;
			const moving = timing !== null && (mask & channel.bit) !== 0;
			for (let k = 0; k < channel.width; k++) {
				velocity[at + k] = moving
					? velocityAt(
							timing,
							from[at + k],
							channel.to[at + k],
							velocity[at + k],
							elapsed,
							this.basisA,
							this.basisB,
						)
					: 0;
			}
		}
	}

	/** Stores a raw target and its resolved floats. */
	private storeTarget(
		slot: number,
		channel: ChannelColumn,
		value: unknown,
	): void {
		const unsettled = channel.kind === null;
		channel.settleKind(value);
		if (channel.kind === null || channel.kind === "discrete") {
			channel.targets[slot] = value;
			return;
		}
		if (channel.current.length < this.size * channel.width)
			resizeColumn(channel, this.size);
		if (unsettled) {
			// The kind was only learnt now: every slot's earlier (undefined)
			// value resolves to the fallback, this one's included.
			for (let other = 0; other < this.size; other++) {
				this.resolveTarget(other, channel, channel.targets[other]);
				copyTargetToCurrent(channel, other);
			}
		}
		channel.targets[slot] = value;
		this.resolveTarget(slot, channel, value);
	}

	/** Writes a raw value's floats into a slot's targets. */
	private resolveTarget(
		slot: number,
		channel: ChannelColumn,
		value: unknown,
	): void {
		const kind = channel.kind;
		const resolved =
			value === undefined ? this.options.fallback(channel.key) : value;
		const at = slot * channel.width;
		const to = channel.to;
		if (kind === "number") {
			to[at] = typeof resolved === "number" ? resolved : Number.NaN;
			return;
		}
		if (kind === "point") {
			if (!isPointValue(resolved) && resolved !== undefined)
				throw kindMismatch(channel, value);
			const point = resolved as { x: number; y: number } | undefined;
			to[at] = point?.x ?? 0;
			to[at + 1] = point?.y ?? 0;
			return;
		}
		const color = parseColorValue(resolved);
		if (color) {
			to[at] = color.r;
			to[at + 1] = color.g;
			to[at + 2] = color.b;
			to[at + 3] = color.a;
		} else {
			// No colour ("none"): NaN red marks it; the move fills in the RGB
			// from the other end, so the colour fades in or out in place.
			to[at] = Number.NaN;
			to[at + 3] = 0;
		}
	}

	/**
	 * Starts `slot`'s segment toward its targets after `delay` seconds, from
	 * its drawn values, keeping its velocity if it was in flight.
	 */
	private begin(slot: number, timing: ResolvedTiming, delay: number): void {
		const wasActive = this.activeIndex[slot] >= 0;
		for (const channel of this.channels) {
			if ((this.moving[slot] & channel.bit) === 0 || channel.kind === null)
				continue;
			if (channel.kind === "discrete") {
				channel.values[slot] = channel.targets[slot];
				continue;
			}
			ensureMotionColumns(channel, this.size);
			const width = channel.width;
			const at = slot * width;
			const from = channel.from as Float64Array;
			const velocity = channel.velocity as Float64Array;
			const current = channel.current;
			const to = channel.to;
			// A slot in flight already holds its velocity now (`captureVelocity`);
			// one at rest starts still.
			if (!wasActive) for (let k = 0; k < width; k++) velocity[at + k] = 0;
			if (channel.kind === "color") fillColorEnds(current, to, at);
			for (let k = 0; k < width; k++) from[at + k] = current[at + k];
			if (!wasActive && timing.spring && timing.velocity !== 0) {
				// A spring released from rest with a start velocity, in progress
				// units: toward the target at `velocity` moves per second.
				for (let k = 0; k < width; k++)
					velocity[at + k] = timing.velocity * (to[at + k] - from[at + k]);
			}
		}
		this.timing[slot] = timing;
		this.start[slot] = this.time + delay;
		if (!wasActive) {
			this.activeIndex[slot] = this.active.length;
			this.active.push(slot);
		}
	}

	/** Puts `slot` at its targets at once and takes it off the active set. */
	private finish(slot: number): void {
		for (const channel of this.channels) {
			if ((this.moving[slot] & channel.bit) === 0 || channel.kind === null)
				continue;
			if (channel.kind === "discrete")
				channel.values[slot] = channel.targets[slot];
			else copyTargetToCurrent(channel, slot);
		}
		this.stop(slot);
	}

	/** Takes `slot` off the active set (its values stay as they are). */
	private stop(slot: number): void {
		const index = this.activeIndex[slot];
		this.moving[slot] = 0;
		this.timing[slot] = null;
		if (index < 0) return;
		const last = this.active.pop() as number;
		if (last !== slot) {
			this.active[index] = last;
			this.activeIndex[last] = index;
		}
		this.activeIndex[slot] = -1;
	}

	/** Marks an exiting slot as done (dropped by `dropFinishedExits`). */
	private markExitDone(slot: number): void {
		this.stop(slot);
		this.exiting[slot] = 2;
	}

	/** Drops every slot whose exit is done, keeping the others' order. */
	private dropFinishedExits(): boolean {
		let any = false;
		for (let slot = 0; slot < this.size; slot++) {
			if (this.exiting[slot] === 2) {
				any = true;
				break;
			}
		}
		if (!any) return false;
		const sources: number[] = [];
		const keys: unknown[] = [];
		const items: unknown[] = [];
		const dataIndex: number[] = [];
		for (let slot = 0; slot < this.size; slot++) {
			if (this.exiting[slot] === 2) continue;
			sources.push(slot);
			keys.push(this.keys[slot]);
			items.push(this.items[slot]);
			dataIndex.push(this.dataIndex[slot]);
		}
		this.permute(sources, keys, items, dataIndex);
		return true;
	}

	/* ------------------------------------------------------ direct moves */

	/**
	 * Moves `slot` to `values` (per channel; `NO_VALUE` keeps a channel's
	 * target) with `timing`, or at once when null. Used by `animateItem` and
	 * `demote`; the values hold until the next reconciliation.
	 */
	retarget(
		slot: number,
		values: readonly unknown[],
		timing: ResolvedTiming | null,
	): void {
		if (slot < 0 || slot >= this.size) return;
		if (!this.writeTargets(slot, values)) return;
		if (timing) this.begin(slot, timing, staggered(timing, 0, 1));
		else this.finish(slot);
	}

	/** Every slot in flight jumps to its end; finished exits are dropped. */
	finishAll(): void {
		while (this.active.length > 0) {
			const slot = this.active[this.active.length - 1];
			this.finish(slot);
			if (this.exiting[slot] === 1) this.exiting[slot] = 2;
		}
		this.dropFinishedExits();
	}

	/* ----------------------------------------------------------- advance */

	/**
	 * Advances every slot in flight by `dt` seconds: O(slots in flight).
	 * Finished slots leave the active set; finished exits are dropped.
	 */
	advance(dt: number): AdvanceResult {
		this.time += dt;
		let changed = 0;
		const time = this.time;
		const active = this.active;
		// Backwards: a slot that finishes is swapped with the last entry, which
		// has already been visited.
		for (let k = active.length - 1; k >= 0; k--) {
			const slot = active[k];
			const local = time - this.start[slot];
			if (local < 0) continue;
			const timing = this.timing[slot] as ResolvedTiming;
			const done = timing.spring
				? this.stepSpring(slot, timing, local)
				: this.stepTween(slot, timing, local);
			changed |= this.moving[slot];
			if (done) {
				this.finish(slot);
				if (this.exiting[slot] === 1) this.exiting[slot] = 2;
			}
		}
		const removed = this.dropFinishedExits();
		return { changed, removed };
	}

	/** One tween step; true when finished. */
	private stepTween(
		slot: number,
		timing: ResolvedTiming,
		local: number,
	): boolean {
		if (!(local < timing.duration)) return true;
		const eased = timing.easing(local / timing.duration);
		const mask = this.moving[slot];
		for (const channel of this.channels) {
			if ((mask & channel.bit) === 0 || channel.width === 0) continue;
			const at = slot * channel.width;
			const from = channel.from as Float64Array;
			const to = channel.to;
			const current = channel.current;
			for (let k = 0; k < channel.width; k++) {
				const a = from[at + k];
				current[at + k] = a + (to[at + k] - a) * eased;
			}
		}
		return false;
	}

	/** One spring step; true when every moving component has settled. */
	private stepSpring(
		slot: number,
		timing: ResolvedTiming,
		local: number,
	): boolean {
		const spec = timing.spring as SpringSpec;
		// The solution is linear in the start state: sample it once for a unit
		// displacement and once for a unit velocity, then combine per component.
		const unitX = springAt(spec, 1, 0, local, this.basisA);
		const unitV = springAt(spec, 0, 1, local, this.basisB);
		const omega = timing.omega;
		const rest2 = timing.restDelta * timing.restDelta;
		const mask = this.moving[slot];
		let settled = true;
		for (const channel of this.channels) {
			if ((mask & channel.bit) === 0 || channel.width === 0) continue;
			const at = slot * channel.width;
			const from = channel.from as Float64Array;
			const velocity = channel.velocity as Float64Array;
			const to = channel.to;
			const current = channel.current;
			for (let k = 0; k < channel.width; k++) {
				const target = to[at + k];
				const x0 = from[at + k] - target;
				const v0 = velocity[at + k];
				const x = x0 * unitX.displacement + v0 * unitV.displacement;
				const v = x0 * unitX.velocity + v0 * unitV.velocity;
				current[at + k] = target + x;
				if (settled) {
					const scaled0 = v0 / omega;
					const scaled = v / omega;
					if (x * x + scaled * scaled > rest2 * (x0 * x0 + scaled0 * scaled0))
						settled = false;
				}
			}
		}
		return settled;
	}
}

/* ------------------------------------------------------------- helpers */

/** The delay of the item at `position` of `count` starting together. */
function staggered(
	timing: ResolvedTiming,
	position: number,
	count: number,
): number {
	const stagger = timing.stagger;
	const extra =
		typeof stagger === "function"
			? stagger(position, count)
			: stagger * position;
	return timing.delay + (Number.isFinite(extra) ? extra : 0);
}

/**
 * A component's velocity `elapsed` seconds into a segment: the spring's
 * exact velocity, or a tween's slope (a central difference of its easing).
 */
function velocityAt(
	timing: ResolvedTiming,
	from: number,
	to: number,
	startVelocity: number,
	elapsed: number,
	basisA: SpringState,
	basisB: SpringState,
): number {
	if (!(elapsed > 0)) return timing.spring ? startVelocity : 0;
	if (timing.spring) {
		const unitX = springAt(timing.spring, 1, 0, elapsed, basisA);
		const unitV = springAt(timing.spring, 0, 1, elapsed, basisB);
		return (from - to) * unitX.velocity + startVelocity * unitV.velocity;
	}
	const duration = timing.duration;
	if (!(elapsed < duration)) return 0;
	const t = elapsed / duration;
	const h = Math.min(1e-4, t, 1 - t);
	if (!(h > 0)) return 0;
	const slope = (timing.easing(t + h) - timing.easing(t - h)) / (2 * h);
	return ((to - from) * slope) / duration;
}

/** Whether a slot's drawn values differ from its targets. */
function differs(channel: ChannelColumn, slot: number): boolean {
	const at = slot * channel.width;
	// Two invisible colours are the same whatever their RGB.
	if (
		channel.kind === "color" &&
		channel.current[at + 3] === 0 &&
		channel.to[at + 3] === 0
	)
		return false;
	for (let k = 0; k < channel.width; k++) {
		const a = channel.current[at + k];
		const b = channel.to[at + k];
		if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) return true;
	}
	return false;
}

/** Whether two raw channel values are the same (points and colours by content). */
function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (isPointValue(a) && isPointValue(b)) return a.x === b.x && a.y === b.y;
	if (typeof a === "object" && typeof b === "object" && a && b) {
		const p = a as Color;
		const q = b as Color;
		return (
			typeof p.r === "number" &&
			p.r === q.r &&
			p.g === q.g &&
			p.b === q.b &&
			p.a === q.a
		);
	}
	return false;
}

/** Copies a slot's targets into its drawn values. */
function copyTargetToCurrent(channel: ChannelColumn, slot: number): void {
	if (channel.kind === "discrete") {
		channel.values[slot] = channel.targets[slot];
		return;
	}
	const at = slot * channel.width;
	for (let k = 0; k < channel.width; k++)
		channel.current[at + k] = channel.to[at + k];
}

/**
 * Before a colour moves: an end without a colour (NaN red) takes the other
 * end's RGB, so a fade to or from `"none"` only changes alpha.
 */
function fillColorEnds(
	current: Float64Array,
	to: Float64Array,
	at: number,
): void {
	const currentNone = Number.isNaN(current[at]);
	const targetNone = Number.isNaN(to[at]);
	if (currentNone && !targetNone) {
		current[at] = to[at];
		current[at + 1] = to[at + 1];
		current[at + 2] = to[at + 2];
		current[at + 3] = 0;
	} else if (targetNone && !currentNone) {
		to[at] = current[at];
		to[at + 1] = current[at + 1];
		to[at + 2] = current[at + 2];
	}
}

/** RGBA floats at `at` as a CSS colour; `"none"` when there is no colour. */
function formatColor(values: Float64Array, at: number): string {
	if (Number.isNaN(values[at])) return "none";
	return toCss({
		r: values[at],
		g: values[at + 1],
		b: values[at + 2],
		a: values[at + 3],
	});
}

/** Grows a column to hold `size` slots, keeping its contents. */
function resizeColumn(channel: ChannelColumn, size: number): void {
	const length = size * channel.width;
	if (channel.current.length >= length) return;
	const grow = (array: Float64Array) => {
		const next = new Float64Array(length);
		next.set(array.subarray(0, Math.min(array.length, length)));
		return next;
	};
	channel.current = grow(channel.current);
	channel.to = grow(channel.to);
	if (channel.from) channel.from = grow(channel.from);
	if (channel.velocity) channel.velocity = grow(channel.velocity);
}

/** Makes a column's `from` and `velocity` the first time anything moves. */
function ensureMotionColumns(channel: ChannelColumn, size: number): void {
	const length = Math.max(size * channel.width, channel.current.length);
	if (!channel.from || channel.from.length < length) {
		const from = new Float64Array(length);
		if (channel.from) from.set(channel.from);
		channel.from = from;
	}
	if (!channel.velocity || channel.velocity.length < length) {
		const velocity = new Float64Array(length);
		if (channel.velocity) velocity.set(channel.velocity);
		channel.velocity = velocity;
	}
}

/** A column in the new slot order (`sources[s]`: old slot, or -1 for new). */
function permuteColumn(
	channel: ChannelColumn,
	sources: readonly number[],
): void {
	const size = sources.length;
	const targets = new Array<unknown>(size);
	const values = new Array<unknown>(size);
	for (let slot = 0; slot < size; slot++) {
		const old = sources[slot];
		if (old < 0) continue;
		targets[slot] = channel.targets[old];
		values[slot] = channel.values[old];
	}
	channel.targets = targets;
	channel.values = values;
	const width = channel.width;
	if (width === 0) return;
	const take = (array: Float64Array) => {
		const next = new Float64Array(size * width);
		for (let slot = 0; slot < size; slot++) {
			const old = sources[slot];
			if (old < 0) continue;
			for (let k = 0; k < width; k++)
				next[slot * width + k] = array[old * width + k];
		}
		return next;
	};
	channel.current = take(channel.current);
	channel.to = take(channel.to);
	if (channel.from) channel.from = take(channel.from);
	if (channel.velocity) channel.velocity = take(channel.velocity);
}

/** The error for a value of the wrong shape for its channel. */
function kindMismatch(channel: ChannelColumn, value: unknown): Error {
	return new TypeError(
		`instances: channel "${channel.key}" holds ${channel.kind} values, but an item gave ${JSON.stringify(value)}.`,
	);
}
