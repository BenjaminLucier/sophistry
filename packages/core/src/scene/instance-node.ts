/**
 * The node behind `instances()`: `InstancesNodeImpl`, made by the internal
 * `"Instances"` definition whose props are the `instances()` options plus the
 * item definition (so framework bindings can wrap it like any primitive).
 *
 * Stages: `GEOMETRY` (the item definition changed) rebuilds the bank;
 * `STYLE` re-reads the shared props (and their bindings); `UPDATE` (data,
 * key or channels changed) reconciles the bank by key; `TRANSFORM` (a space
 * change) re-places the items; `SPEC` (a clock step, a promote) reassembles
 * only what the moving channels feed. The clock is subscribed only while an
 * item is in flight.
 *
 * The definition is exported from `entries/internal.ts` only; authors call
 * `instances()`.
 */

import type { Bounds } from "../geometry/index.js";
import type {
	InteractionHandlers,
	InteractionProps,
} from "../interact/types.js";
import { hasInteraction } from "../interact/types.js";
import type { Readable } from "../reactive/index.js";
import { isReadable } from "../reactive/index.js";
import type { MarksSpec } from "../spec/types.js";
import type { Clock } from "../tween/clock.js";
import { easings, resolveEasing } from "../tween/easing.js";
import type { SpringOptions, SpringSpec } from "../tween/spring.js";
import {
	naturalFrequency,
	spring,
	springDefaults,
	springRestDelta,
} from "../tween/spring.js";
import {
	clockContext,
	Invalidate,
	reducedMotionContext,
	themeContext,
} from "./context.js";
import type {
	ChannelColumn,
	ChannelTarget,
	ReconcilePlan,
	ResolvedTiming,
} from "./instance-bank.js";
import { InstanceBank, NO_VALUE } from "./instance-bank.js";
import {
	InstanceLayer,
	isMoveProp,
	REVEAL_KEY,
	STYLE_KEYS,
} from "./instance-marks.js";
import type {
	InstanceEventName,
	InstancePointerEvent,
	InstanceTiming,
	InstanceTransition,
} from "./instances.js";
import { ANY_CONTEXT, BaseNode } from "./node.js";
import { definePrimitive } from "./primitive.js";
import type { ShapeOptions, ShapeProps } from "./shape.js";
import { shapeOptionsOf } from "./shape.js";
import type {
	ContextKey,
	Definition,
	InvalidateBits,
	PropDescriptor,
	SceneNode,
} from "./types.js";
import { SpaceChange } from "./types.js";

/** An item's props by key, loosely typed (the public types check them). */
type LooseProps = Record<string, unknown>;

/** A per-item value: constant, or a function of the item. */
type LooseValues = Readonly<Record<string, unknown>>;

/**
 * The props of an `"Instances"` node: the `instances()` options plus the
 * item definition. Loosely typed; `instances()` is the typed entry point.
 *
 * @category Instancing
 * @internal
 */
export interface InstancesNodeProps {
	/** The definition every item is an instance of (a `defineShape` definition). */
	itemDefinition: Definition<ShapeProps>;
	/** The items. */
	data?: readonly unknown[];
	/** Identity across data changes. Defaults to the item itself. */
	key?: (item: unknown, index: number) => unknown;
	/** Per-item props, each a function of the item. */
	channels?: Readonly<
		Record<string, (item: unknown, index: number) => unknown>
	>;
	/** Props every item shares (a `Readable` value binds). */
	shared?: LooseValues;
	/** How items move, enter and exit. */
	transition?: InstanceTransition<unknown, LooseProps, string>;
}

/** Event name to the `onX` handler key of `InteractionHandlers`. */
const HANDLER_KEYS = {
	pointerdown: "onPointerDown",
	pointermove: "onPointerMove",
	pointerup: "onPointerUp",
	tap: "onTap",
	doubletap: "onDoubleTap",
	longpress: "onLongPress",
	contextmenu: "onContextMenu",
	enter: "onEnter",
	leave: "onLeave",
} as const satisfies Record<InstanceEventName, keyof InteractionHandlers>;

/** Behaviour props passed through from the shared props unchanged. */
const BEHAVIOUR_KEYS = [
	"hover",
	"drag",
	"keyboard",
	"drop",
	"itemLabel",
] as const satisfies readonly (keyof InteractionHandlers)[];

/** The tween length when a transition gives none. */
const DEFAULT_DURATION = 0.4;

/**
 * Resolves `base` overlaid with `override` into a segment timing.
 *
 * @internal
 */
export function resolveTiming(
	base: InstanceTiming | undefined,
	override?: InstanceTiming,
): ResolvedTiming {
	const pick = <K extends keyof InstanceTiming>(key: K): InstanceTiming[K] =>
		override?.[key] !== undefined ? override[key] : base?.[key];
	const springInput = pick("spring");
	let spec: SpringSpec | null = null;
	let restDelta: number = springDefaults.restDelta;
	let velocity = 0;
	if (springInput) {
		if ((springInput as SpringSpec).type === "spring")
			spec = springInput as SpringSpec;
		else {
			const options = springInput as SpringOptions;
			spec = spring(options);
			restDelta = springRestDelta(options);
			velocity = options.velocity ?? 0;
		}
	}
	const duration = pick("duration") ?? DEFAULT_DURATION;
	return {
		duration: duration > 0 ? duration : 0,
		easing: resolveEasing(pick("easing"), easings.smooth),
		spring: spec,
		omega: spec ? naturalFrequency(spec) : 1,
		restDelta,
		velocity,
		delay: Math.max(0, pick("delay") ?? 0),
		stagger: pick("stagger") ?? 0,
	};
}

/**
 * Throws unless `prop` may be a per-item channel of `definition`: a prop it
 * has, marked `instanceable`.
 *
 * @internal
 */
export function checkChannel(
	definition: Definition<ShapeProps>,
	prop: string,
): void {
	const entry = (
		definition.descriptor as unknown as Record<string, PropDescriptor<unknown>>
	)[prop];
	if (!entry) {
		throw new TypeError(`instances: ${definition.name} has no prop "${prop}".`);
	}
	if (entry.instanceable !== true) {
		throw new TypeError(
			`instances: "${prop}" is not an instanceable prop of ${definition.name}, so it cannot vary per item; pass it in \`shared\`.`,
		);
	}
}

/**
 * Throws unless `definition` can be instanced with these options: a shape,
 * whose every channel (and enter or exit state) is instanceable. Run by
 * `instances()` so a mistake fails where it is written.
 *
 * @internal
 */
export function checkInstances(
	definition: Definition<ShapeProps>,
	props: Omit<InstancesNodeProps, "itemDefinition">,
): void {
	if (!shapeOptionsOf(definition)) {
		throw new TypeError(
			`instances: ${definition.name} is not a shape; instances() takes a definition made by defineShape.`,
		);
	}
	const transition = props.transition;
	for (const values of [
		props.channels,
		transition?.enter?.from,
		transition?.exit?.to,
	]) {
		if (values)
			for (const prop of Object.keys(values)) checkChannel(definition, prop);
	}
}

/** A per-item value: the function's result for the item, or the constant. */
function valueFor(value: unknown, item: unknown, index: number): unknown {
	return typeof value === "function"
		? (value as (item: unknown, index: number) => unknown)(item, index)
		: value;
}

/**
 * An instances node: one node for every item of `data`, drawn as one
 * `MarksSpec`. Made by `instances()` (or the internal `"Instances"`
 * definition).
 *
 * @category Instancing
 * @internal
 */
export class InstancesNodeImpl extends BaseNode<InstancesNodeProps> {
	override readonly producesSpec = true;

	/** The item definition's shape options (geometry, offset, adapters). */
	private shape: ShapeOptions<ShapeProps> | null = null;
	/** The item definition the bank was made for. */
	private bankDefinition: Definition<ShapeProps> | null = null;
	private bank: InstanceBank = new InstanceBank([], {
		fallback: () => undefined,
	});
	/** Channel keys in bank column order. */
	private channelKeys: string[] = [];
	/** Which of them come from `channels` (the others: enter/exit states, `animateItem`). */
	private explicit = new Set<string>();
	private readonly layer = new InstanceLayer();

	/** The shared props, bindings pulled; a new object when any changed. */
	private shared: LooseProps = {};
	/** Unsubscribers of the shared props' bindings. */
	private sharedStops: (() => void)[] = [];
	/** Whether a shared binding went stale since the last read. */
	private sharedStale = false;

	/** Channel bits changed since the last assembly, and what else must be redone. */
	private changedBits = 0;
	private placeAll = true;
	private styleAll = true;
	/** Bits of the channels that place or shape items, those that style them, and the reveal's. */
	private placementBits = 0;
	private styleBits = 0;
	private revealBits = 0;
	/** Bits of the placement channels that only move items (`TRANSFORM`, not `GEOMETRY`). */
	private moveBits = 0;

	private clock: Clock | null = null;
	private stopTick: (() => void) | null = null;

	/** Promoted items: key to node. */
	private promoted = new Map<unknown, SceneNode>();
	private itemHandlers: Map<
		InstanceEventName,
		Set<(event: InstancePointerEvent) => void>
	> | null = null;
	private keyedHandlers: {
		base: InteractionHandlers;
		shared: LooseProps;
		version: number;
		handlers: InteractionHandlers;
	} | null = null;
	private handlerVersion = 0;

	/* ---------------------------------------------------------- reads */

	/** How many items are drawn now (exiting ones included). */
	get count(): number {
		this.refresh();
		return this.bank.size;
	}

	/** The key at spec index `index`, or undefined. */
	keyAt(index: number): unknown {
		this.refresh();
		return this.bank.keyAt(index);
	}

	/** The spec index of `key`, or -1. */
	indexOf(key: unknown): number {
		this.refresh();
		return this.bank.indexOf(key);
	}

	/** An item's current (possibly mid-transition) value of a channel or shared prop. */
	itemValue(key: unknown, prop: PropertyKey): unknown {
		this.refresh();
		const slot = this.bank.indexOf(key);
		if (slot < 0) return undefined;
		const column = this.channelKeys.indexOf(prop as string);
		if (column >= 0) {
			return this.bank.value(slot, this.bank.channels[column] as ChannelColumn);
		}
		return this.shared[prop as string];
	}

	/* ---------------------------------------------------------- moves */

	/** Moves one item's channels to `to` (until the next data change). */
	animateItem(key: unknown, to: LooseValues, timing?: InstanceTiming): void {
		this.refresh();
		const slot = this.bank.indexOf(key);
		if (slot < 0) return;
		for (const prop of Object.keys(to)) this.ensureChannel(prop);
		const item = this.bank.itemAt(slot);
		const index = slot;
		const values = this.channelKeys.map((prop) =>
			prop in to ? valueFor(to[prop], item, index) : NO_VALUE,
		);
		const transition = this.props.transition;
		const resolved =
			this.reducedMotion() || (!timing && !transition)
				? null
				: resolveTiming(transition, timing);
		this.bank.retarget(slot, values, resolved);
		this.changed(-1);
	}

	/** Hides an item and returns a real node of the item definition in its place. */
	promote(key: unknown): SceneNode {
		this.refresh();
		const existing = this.promoted.get(key);
		if (existing) return existing;
		const slot = this.bank.indexOf(key);
		if (slot < 0) {
			throw new Error(`instances: no item with key ${String(key)} to promote.`);
		}
		const definition = this.props.itemDefinition;
		const props: LooseProps = { ...(this.props.shared ?? {}) };
		for (let c = 0; c < this.channelKeys.length; c++) {
			const value = this.bank.value(
				slot,
				this.bank.channels[c] as ChannelColumn,
			);
			if (value !== undefined) props[this.channelKeys[c] as string] = value;
		}
		const node = (definition.create as (props: LooseProps) => SceneNode)(props);
		this.promoted.set(key, node);
		node.on("dispose", () => {
			if (this.promoted.get(key) !== node) return;
			this.promoted.delete(key);
			this.hiddenChanged();
		});
		const parent = this.parentNode;
		if (parent) {
			const siblings = parent.children;
			const after = siblings[siblings.indexOf(this) + 1] ?? null;
			parent.add(node, after);
		}
		this.hiddenChanged();
		return node;
	}

	/** Writes a promoted node's channel values back, disposes it and shows the item. */
	demote(key: unknown): void {
		const node = this.promoted.get(key);
		if (!node) return;
		this.refresh();
		this.promoted.delete(key);
		const slot = this.bank.indexOf(key);
		if (slot >= 0 && !node.disposed) {
			const read = node as unknown as { get(prop: string): unknown };
			const values = this.channelKeys.map((prop) => read.get(prop));
			this.bank.retarget(slot, values, null);
		}
		node.dispose();
		this.changed(-1);
		this.hiddenChanged();
	}

	/* --------------------------------------------------------- events */

	/** Adds an item handler; its events carry `item` and `key`. */
	onItem(
		event: InstanceEventName,
		handler: (event: InstancePointerEvent) => void,
	): () => void {
		if (this.disposed) return () => {};
		this.itemHandlers ??= new Map();
		let set = this.itemHandlers.get(event);
		if (!set) {
			set = new Set();
			this.itemHandlers.set(event, set);
		}
		set.add(handler);
		this.handlersChanged();
		return () => {
			if (this.itemHandlers?.get(event)?.delete(handler))
				this.handlersChanged();
		};
	}

	private handlersChanged(): void {
		this.handlerVersion++;
		this.invalidate(Invalidate.INTERACTION);
	}

	/** The shared props, re-read first if a binding went stale. */
	private currentShared(): LooseProps {
		if (this.sharedStale) this.readShared();
		return this.shared;
	}

	override wantsInteraction(): boolean {
		if (hasInteraction(this.currentShared() as InteractionProps)) return true;
		if (this.itemHandlers) {
			for (const set of this.itemHandlers.values())
				if (set.size > 0) return true;
		}
		return super.wantsInteraction();
	}

	override interactionProps(): InteractionProps {
		return this.currentShared() as InteractionProps;
	}

	/**
	 * The shared props' handlers, `on(...)` handlers and `onItem` handlers,
	 * merged; every pointer event they receive carries `key` (the item's key,
	 * null off any item).
	 */
	override interactionHandlers(): InteractionHandlers {
		const base = super.interactionHandlers();
		const shared = this.currentShared();
		const cache = this.keyedHandlers;
		if (
			cache &&
			cache.base === base &&
			cache.shared === shared &&
			cache.version === this.handlerVersion
		)
			return cache.handlers;
		const own = shared as InteractionHandlers;
		const merged: Record<string, unknown> = {};
		for (const key of BEHAVIOUR_KEYS) {
			const value = own[key] ?? base[key];
			if (value !== undefined) merged[key] = value;
		}
		for (const event of Object.keys(HANDLER_KEYS) as InstanceEventName[]) {
			const key = HANDLER_KEYS[event];
			const all: ((event: InstancePointerEvent) => void)[] = [];
			if (own[key]) all.push(own[key] as (event: InstancePointerEvent) => void);
			if (base[key])
				all.push(base[key] as (event: InstancePointerEvent) => void);
			const extra = this.itemHandlers?.get(event);
			if (extra) all.push(...extra);
			if (all.length === 0) continue;
			merged[key] = (input: InstancePointerEvent) => {
				const item = input.item;
				const keyed: InstancePointerEvent = {
					...input,
					key:
						item === null || item === undefined
							? null
							: (this.bank.keyAt(item) ?? null),
				};
				for (const handler of all) handler(keyed);
			};
		}
		// The wheel takes no item key: merged the way a plain node merges it.
		const wheels = [own.onWheel, base.onWheel].filter(
			(handler) => handler !== undefined,
		);
		if (wheels.length === 1) merged.onWheel = wheels[0];
		else if (wheels.length === 2) {
			merged.onWheel = (input: never) => {
				let taken = false;
				for (const handler of wheels)
					if (handler?.(input) !== false) taken = true;
				return taken ? undefined : false;
			};
		}
		const handlers = merged as InteractionHandlers;
		this.keyedHandlers = {
			base,
			shared,
			version: this.handlerVersion,
			handlers,
		};
		return handlers;
	}

	/* --------------------------------------------------------- stages */

	protected override propChanged<K extends keyof InstancesNodeProps>(
		key: K,
		descriptor: PropDescriptor<InstancesNodeProps[K]>,
	): void {
		if (key === "shared") this.bindShared();
		super.propChanged(key, descriptor);
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		let bits = 0;
		if (change & (SpaceChange.MATRIX | SpaceChange.PEN_SCALE))
			bits |= Invalidate.TRANSFORM;
		if (change & SpaceChange.OPACITY) bits |= Invalidate.STYLE;
		if (change & SpaceChange.CLIP) bits |= Invalidate.SPEC;
		return bits;
	}

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		if (key === clockContext || key === ANY_CONTEXT) this.resubscribeClock();
		return key === themeContext || key === ANY_CONTEXT ? Invalidate.STYLE : 0;
	}

	protected run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) this.setUpDefinition();
		if (dirty & Invalidate.STYLE || this.sharedStale) {
			this.readShared();
			this.placeAll = true;
			this.styleAll = true;
		}
		const implicitShared =
			(dirty & Invalidate.STYLE) !== 0 &&
			this.channelKeys.length > this.explicit.size;
		if (dirty & (Invalidate.GEOMETRY | Invalidate.UPDATE) || implicitShared)
			this.reconcile();
		if (dirty & Invalidate.TRANSFORM) this.placeAll = true;
		this.publish(this.assemble());
		this.ensureTicking();
	}

	/** Reads the item definition: its shape options and descriptor. */
	private setUpDefinition(): void {
		const definition = this.props.itemDefinition;
		if (!definition)
			throw new TypeError("instances: no item definition given.");
		checkInstances(definition, this.props);
		this.shape = shapeOptionsOf(definition) as ShapeOptions<ShapeProps>;
	}

	/** Subscribes to the shared props' bindings (after `shared` was set). */
	private bindShared(): void {
		for (const stop of this.sharedStops) stop();
		this.sharedStops = [];
		const shared = this.props.shared;
		if (!shared) return;
		for (const key of Object.keys(shared)) {
			const value = shared[key];
			if (isReadable(value)) {
				this.sharedStops.push(
					(value as Readable<unknown>).subscribe(() => {
						this.sharedStale = true;
						this.invalidate(Invalidate.STYLE | Invalidate.INTERACTION);
					}),
				);
			}
		}
		this.sharedStale = true;
	}

	/** The shared props with bindings pulled. */
	private readShared(): void {
		this.sharedStale = false;
		const raw = this.props.shared ?? {};
		const next: LooseProps = {};
		const descriptor = this.descriptor();
		for (const key of Object.keys(raw)) {
			if (!(key in descriptor)) {
				throw new TypeError(
					`instances: ${this.props.itemDefinition.name} has no prop "${key}" (in \`shared\`).`,
				);
			}
			const value = raw[key];
			const resolved = isReadable(value)
				? (value as Readable<unknown>).peek()
				: value;
			if (resolved !== undefined) next[key] = resolved;
		}
		this.shared = next;
	}

	private descriptor(): Readonly<Record<string, PropDescriptor<unknown>>> {
		return this.props.itemDefinition.descriptor as unknown as Readonly<
			Record<string, PropDescriptor<unknown>>
		>;
	}

	/** Checks that `prop` may be a per-item channel. */
	private checkChannel(prop: string): void {
		checkChannel(this.props.itemDefinition, prop);
	}

	/** The channel keys the options ask for: `channels`, then the enter and exit states'. */
	private wantedChannels(): { keys: string[]; explicit: Set<string> } {
		const explicit = new Set(Object.keys(this.props.channels ?? {}));
		const keys = [...explicit];
		const transition = this.props.transition;
		for (const values of [transition?.enter?.from, transition?.exit?.to]) {
			if (!values) continue;
			for (const key of Object.keys(values))
				if (!keys.includes(key)) keys.push(key);
		}
		for (const key of this.channelKeys) if (!keys.includes(key)) keys.push(key);
		return { keys, explicit };
	}

	/** A bank for `keys`, carrying the items over (at their targets) from the old one. */
	private rebuildBank(keys: string[]): void {
		for (const key of keys) this.checkChannel(key);
		this.channelKeys = keys;
		this.bank = new InstanceBank(keys, {
			fallback: (key) => this.fallback(key),
		});
		this.layer.reset();
		this.placementBits = 0;
		this.styleBits = 0;
		this.revealBits = 0;
		this.moveBits = 0;
		const descriptor = this.props.itemDefinition.descriptor;
		for (const channel of this.bank.channels) {
			if (STYLE_KEYS.has(channel.key)) this.styleBits |= channel.bit;
			else if (channel.key === REVEAL_KEY) this.revealBits |= channel.bit;
			else {
				this.placementBits |= channel.bit;
				if (isMoveProp(descriptor, channel.key)) this.moveBits |= channel.bit;
			}
		}
		this.bankDefinition = this.props.itemDefinition;
	}

	/** Adds a channel (an `animateItem` target that was not one), its values from the shared props. */
	private ensureChannel(prop: string): void {
		if (this.channelKeys.includes(prop)) return;
		this.checkChannel(prop);
		// Rebuilt with the extra column, every item kept where it is drawn
		// (items in flight stop where they are; exiting ones are dropped).
		const carried = this.carryItems();
		this.rebuildBank([...this.channelKeys, prop]);
		this.bank.reconcile(
			carried.items,
			(_, index) => carried.keys[index],
			this.carriedTargets(carried.values),
			INSTANT_PLAN,
		);
		this.changed(-1);
	}

	/**
	 * The value an implicit channel (one named only by an enter or exit
	 * state, or an `animateItem` target) rests at: the shared prop (a shared
	 * `progress` too: it is every item's reveal, as on a single shape).
	 */
	private restingValue(key: string): unknown {
		return this.shared[key];
	}

	/** A channel's stand-in for an undefined value: the descriptor's default, or the theme's. */
	private fallback(key: string): unknown {
		const theme = this.context(themeContext);
		if (key === "strokeWidth") return theme.defaults.strokeWidth;
		if (key === "stroke") return theme.palette.foreground;
		if (key === "fill") return "none";
		return this.descriptor()[key]?.default;
	}

	private reducedMotion(): boolean {
		return this.context(reducedMotionContext).peek();
	}

	/** Reconciles the bank to the data (rebuilding it first when the channel set changed). */
	private reconcile(): void {
		const { keys, explicit } = this.wantedChannels();
		const sameKeys =
			keys.length === this.channelKeys.length &&
			keys.every((key, i) => key === this.channelKeys[i]);
		let plan = this.plan();
		const rebuilt =
			!sameKeys || this.bankDefinition !== this.props.itemDefinition;
		if (rebuilt) {
			const first = this.bankDefinition === null;
			const carried = first ? null : this.carryItems();
			this.rebuildBank(keys);
			if (carried) {
				// The same items in a new bank: put them back where they were,
				// then move on to the data as usual.
				this.bank.reconcile(
					carried.items,
					(_, index) => carried.keys[index],
					this.carriedTargets(carried.values),
					INSTANT_PLAN,
				);
			}
		}
		this.explicit = explicit;
		if (this.reducedMotion()) plan = INSTANT_PLAN;
		const data = this.props.data ?? [];
		const keyOf = this.props.key ?? ((item: unknown) => item);
		const channels = this.props.channels ?? {};
		// One function per channel: the channel itself, or its resting value.
		const targets: ChannelTarget[] = this.channelKeys.map((key) => {
			const channel = explicit.has(key) ? channels[key] : undefined;
			if (channel) return channel;
			const resting = this.restingValue(key);
			return () => resting;
		});
		const changed = this.bank.reconcile(data, keyOf, targets, plan);
		// Every item kept its slot: only the passes the changed channels feed
		// rerun (a chart re-projecting its points re-places them and keeps
		// their styles). Otherwise the slots moved, and everything is redone.
		if (rebuilt || changed === -1) {
			this.changedBits = -1;
			this.placeAll = true;
			this.styleAll = true;
		} else this.changedBits |= changed;
	}

	/** Per channel, the carried items' values (by index), or its resting value. */
	private carriedTargets(values: Map<string, unknown[]>): ChannelTarget[] {
		return this.channelKeys.map((key) => {
			const list = values.get(key);
			if (list) return (_: unknown, index: number) => list[index];
			const resting = this.restingValue(key);
			return () => resting;
		});
	}

	/** The current items and their drawn values, by channel key. */
	private carryItems(): {
		items: unknown[];
		keys: unknown[];
		values: Map<string, unknown[]>;
	} {
		const bank = this.bank;
		const items: unknown[] = [];
		const keys: unknown[] = [];
		const values = new Map<string, unknown[]>();
		for (const channel of bank.channels) values.set(channel.key, []);
		for (let slot = 0; slot < bank.size; slot++) {
			if (bank.isExiting(slot)) continue;
			items.push(bank.itemAt(slot));
			keys.push(bank.keyAt(slot));
			for (const channel of bank.channels)
				values.get(channel.key)?.push(bank.value(slot, channel));
		}
		return { items, keys, values };
	}

	/** The reconciliation plan the transition asks for. */
	private plan(): ReconcilePlan {
		const transition = this.props.transition;
		if (!transition) return INSTANT_PLAN;
		const keys = () => this.channelKeys;
		const enter = transition.enter;
		const exit = transition.exit;
		return {
			update: resolveTiming(transition),
			enter: enter ? resolveTiming(transition, enter) : null,
			enterFrom: enter
				? (channel, item, index) => {
						const key = keys()[channel] as string;
						return key in enter.from
							? valueFor(enter.from[key], item, index)
							: NO_VALUE;
					}
				: null,
			exit: exit ? resolveTiming(transition, exit) : null,
			exitTo: exit
				? (channel, item, index) => {
						const key = keys()[channel] as string;
						return key in exit.to
							? valueFor(exit.to[key], item, index)
							: NO_VALUE;
					}
				: null,
		};
	}

	/** Records which channels changed (all for -1) and asks for an assembly. */
	private changed(bits: number): void {
		this.changedBits |= bits;
		this.invalidate(Invalidate.SPEC);
		this.ensureTicking();
	}

	/** A promote or demote changed which items are hidden. */
	private hiddenChanged(): void {
		this.styleAll = true;
		this.invalidate(Invalidate.SPEC);
	}

	/** Per slot, 1 for a promoted item; null when none is. */
	private hiddenSlots(): Uint8Array | null {
		if (this.promoted.size === 0) return null;
		const hidden = new Uint8Array(this.bank.size);
		let any = false;
		for (const key of this.promoted.keys()) {
			const slot = this.bank.indexOf(key);
			if (slot >= 0) {
				hidden[slot] = 1;
				any = true;
			}
		}
		return any ? hidden : null;
	}

	private assemble(): MarksSpec | null {
		const bits = this.changedBits;
		const shape = this.shape;
		if (!shape) return null;
		const placement = this.placeAll || (bits & this.placementBits) !== 0;
		const style =
			this.styleAll ||
			(bits & this.styleBits) !== 0 ||
			(shape.styleProps !== undefined && bits !== 0);
		const reveal = this.placeAll || (bits & this.revealBits) !== 0;
		// Past 31 channels a bit stands for all of them: never "move only".
		const moveOnly =
			!this.placeAll &&
			this.channelKeys.length <= 31 &&
			(bits & this.placementBits & ~this.moveBits) === 0;
		this.changedBits = 0;
		this.placeAll = false;
		this.styleAll = false;
		return this.layer.build(
			{
				id: this.id,
				name: this.props.itemDefinition.name,
				bank: this.bank,
				shape,
				descriptor: this.props.itemDefinition.descriptor,
				shared: this.shared,
				theme: this.context(themeContext),
				space: this.space,
				hidden: this.hiddenSlots(),
			},
			{ placement, moveOnly, style, reveal },
		);
	}

	/* ---------------------------------------------------------- clock */

	/** Subscribes to the clock while something is in flight (and the node is in a scene). */
	private ensureTicking(): void {
		if (
			this.stopTick ||
			this.bank.activeCount === 0 ||
			!this.graph ||
			this.disposed
		)
			return;
		const clock = this.context(clockContext);
		this.clock = clock;
		this.stopTick = clock.onTick((dt) => this.tick(dt));
	}

	private stopTicking(): void {
		this.stopTick?.();
		this.stopTick = null;
		this.clock = null;
	}

	/** The clock in context may have changed: move to it if ticking. */
	private resubscribeClock(): void {
		if (!this.stopTick || this.context(clockContext) === this.clock) return;
		this.stopTicking();
		this.ensureTicking();
	}

	/** One clock step: advance the items in flight; stop listening once none is. */
	private tick(dt: number): void {
		if (this.reducedMotion()) {
			this.bank.finishAll();
			this.changedBits = -1;
			this.placeAll = true;
			this.styleAll = true;
		} else {
			const result = this.bank.advance(dt);
			this.changedBits |= result.changed;
			if (result.removed) {
				this.placeAll = true;
				this.styleAll = true;
			}
			// Items still in their delay changed nothing.
			if (result.changed === 0 && !result.removed) {
				if (this.bank.activeCount === 0) this.stopTicking();
				return;
			}
		}
		this.invalidate(Invalidate.SPEC);
		if (this.bank.activeCount === 0) this.stopTicking();
	}

	override attach(graph: Parameters<BaseNode["attach"]>[0]): void {
		super.attach(graph);
		this.ensureTicking();
	}

	override detach(): void {
		this.stopTicking();
		super.detach();
	}

	/* -------------------------------------------------------- handles */

	override bounds(): Bounds | null {
		this.refresh();
		return (this.spec as MarksSpec | null)?.bounds ?? null;
	}

	override localBounds(): Bounds | null {
		return this.bounds();
	}

	protected override disposeContents(): void {
		this.stopTicking();
		for (const stop of this.sharedStops) stop();
		this.sharedStops = [];
		const promoted = [...this.promoted.values()];
		this.promoted.clear();
		for (const node of promoted) node.dispose();
		this.itemHandlers = null;
	}
}

/** Every change instant: no transition, or reduced motion. */
const INSTANT_PLAN: ReconcilePlan = Object.freeze({
	update: null,
	enter: null,
	enterFrom: null,
	exit: null,
	exitTo: null,
});

/**
 * The internal `"Instances"` definition: its props are the `instances()`
 * options plus `itemDefinition`. For framework bindings; authors call
 * `instances()`.
 *
 * @category Instancing
 * @internal
 */
export const instancesDefinition = definePrimitive<
	InstancesNodeProps,
	InstancesNodeImpl,
	never
>({
	name: "Instances",
	props: {
		itemDefinition: { invalidates: Invalidate.GEOMETRY | Invalidate.UPDATE },
		data: { default: [], invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		channels: { invalidates: Invalidate.UPDATE },
		shared: { invalidates: Invalidate.STYLE | Invalidate.INTERACTION },
		transition: { invalidates: Invalidate.NONE },
	},
	node: (definition) => new InstancesNodeImpl(definition),
});
