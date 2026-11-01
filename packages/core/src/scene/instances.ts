/**
 * `instances()`: one node for N items of one shape definition.
 *
 * The node is made by the internal `"Instances"` definition
 * (`scene/instance-node.ts`); its bank of channel values is
 * `scene/instance-bank.ts` and its spec `scene/instance-marks.ts`.
 *
 * Model:
 *
 * - The items come from `data` (an array or a `Readable` of one), identified
 *   across updates by `key` (default: the item itself).
 * - Each item's props are `shared` (any prop, plain or bound, the same for
 *   every item) overlaid with its `channels` (per-item functions of the item;
 *   only the definition's `instanceable` props, type-enforced through the
 *   definition's `I` phantom (see `Definition`), and checked against the descriptor at run time).
 * - Channel values live in a struct-of-arrays bank (typed columns per
 *   channel: numbers one column, points two, colours four, parsed once).
 * - A data change reconciles by key: new keys enter, kept keys update, gone
 *   keys exit. With a `transition`, changed channel values tween (duration,
 *   easing, delay, stagger) or spring toward the new targets, entering items
 *   start from `enter.from`, and exiting items animate to `exit.to` before
 *   they are dropped. Only items in flight are touched per frame (an active
 *   set); the clock in context drives them (`clock.onTick`, subscribed only
 *   while something is in flight). Reduced motion jumps to the end.
 * - The node publishes one `MarksSpec`: `circle`/`rect` marks when the
 *   shape's options provide a mark adapter and the items allow it (the
 *   renderer's splat fast path; not while an item is partly revealed,
 *   which is drawn from outlines), else an `outline` mark (the outline is shared
 *   because no geometry prop is a channel or varies: per-item `transforms`
 *   carry `x`/`y`/`rotation`/`scale`/`origin`/`offset`), else a `paths` mark
 *   (per-item outlines from the shape's `geometry`, cached per distinct
 *   geometry values).
 * - Picking resolves items: handlers get `event.item` (index into the
 *   current items) and `event.key`.
 * - `promote(key)` hides an item and puts a real node of the definition, with
 *   the item's current values, next to the instances node (same parent, same
 *   space); `demote(key)` writes its values back and disposes it.
 */

import type { ScenePointerEvent } from "../interact/types.js";
import type { Readable } from "../reactive/index.js";
import type { Easing } from "../tween/easing.js";
import type { SpringOptions, SpringSpec } from "../tween/spring.js";
import type { InstancesNodeProps } from "./instance-node.js";
import { checkInstances, instancesDefinition } from "./instance-node.js";
import type { ShapeProps } from "./shape.js";
import type { Bindable, Definition, SceneNode } from "./types.js";

/**
 * Per-item channels: for each instanceable prop, a function of the item.
 *
 * @typeParam T - The item type.
 * @typeParam P - The definition's props.
 * @typeParam I - Its instanceable keys.
 *
 * @category Instancing
 */
export type InstanceChannels<T, P, I extends keyof P> = {
	readonly [K in I]?: (item: T, index: number) => P[K];
};

/**
 * Values for some instanceable props, each constant or a function of the
 * item: an enter state, an exit state, an `animateItem` target.
 *
 * @category Instancing
 */
export type InstanceValues<T, P, I extends keyof P> = {
	readonly [K in I]?: P[K] | ((item: T, index: number) => P[K]);
};

/**
 * How channel values move to new targets. Either a tween (`duration`,
 * `easing`) or a spring (`spring`); `delay` and `stagger` apply to both.
 * Omitted fields fall back to the enclosing {@link InstanceTransition}'s.
 *
 * @category Instancing
 */
export interface InstanceTiming {
	/** Seconds. @default 0.4 (when a transition is given at all) */
	duration?: number;
	/** @default "smooth" (cubic in-out) */
	easing?: Easing;
	/** A spring instead of a tween: its settle time is the duration, and an item retargeted mid-flight keeps its velocity. */
	spring?: SpringOptions | SpringSpec;
	/** Seconds before the move starts. @default 0 */
	delay?: number;
	/**
	 * Extra delay per item, in seconds, by position among the items moving in
	 * this change (or a function of the item and its index). @default 0
	 */
	stagger?: number | ((index: number, count: number) => number);
}

/**
 * Transitions of an instances node: the update timing, plus optional enter
 * and exit states.
 *
 * @category Instancing
 */
export interface InstanceTransition<T, P, I extends keyof P>
	extends InstanceTiming {
	/** Entering items start from these values and move to their channels. Omitted: they appear in place. */
	enter?: InstanceTiming & { from: InstanceValues<T, P, I> };
	/** Exiting items move to these values, then are removed. Omitted: they vanish at once. */
	exit?: InstanceTiming & { to: InstanceValues<T, P, I> };
}

/**
 * Options of {@link instances}.
 *
 * @category Instancing
 */
export interface InstancesOptions<T, P, I extends keyof P, K = unknown> {
	/** The items, or a `Readable` of them (the node follows it). */
	data: readonly T[] | Readable<readonly T[]>;
	/** Identity across data changes. @default the item itself */
	key?: (item: T, index: number) => K;
	/** Per-item props: only the definition's instanceable ones. */
	channels?: InstanceChannels<T, P, I>;
	/** Props every item shares (any prop; a `Readable` binds). Interaction handlers go here. */
	shared?: Bindable<P>;
	/** How items move, enter and exit. Omitted: changes are instant. */
	transition?: InstanceTransition<T, P, I>;
}

/**
 * A pointer event on an instances node: `item` is the item's current index
 * and `key` its key (both null when the event is not on an item).
 *
 * @category Instancing
 */
export interface InstancePointerEvent<K = unknown> extends ScenePointerEvent {
	key: K | null;
}

/**
 * The node {@link instances} returns. It is a scene node (add it to a
 * container, `dispose()` it) whose props are its options.
 *
 * @category Instancing
 */
export interface InstancesNode<
	T,
	P extends object,
	N extends SceneNode<P>,
	I extends keyof P,
	K = unknown,
> extends SceneNode<InstancesOptions<T, P, I, K>> {
	/** How many items are drawn now (exiting ones included). */
	readonly count: number;
	/** The key of the item at `index` in the current spec, or undefined. */
	keyAt(index: number): K | undefined;
	/** The current spec index of `key`, or -1. */
	indexOf(key: K): number;
	/** An item's current (possibly mid-transition) value of a channel or shared prop. */
	itemValue<C extends keyof P>(key: K, prop: C): P[C] | undefined;
	/**
	 * Moves one item's channels to `to` (overriding its data-driven values
	 * until the next data change), with `timing` or the node's transition.
	 */
	animateItem(
		key: K,
		to: InstanceValues<T, P, I>,
		timing?: InstanceTiming,
	): void;
	/**
	 * Hides the item and returns a real node of the definition with its
	 * current values, placed next to this node (same parent): for an item
	 * that needs its own handlers, animation or children.
	 */
	promote(key: K): N;
	/** Writes the promoted node's instanceable values back, disposes it and shows the item again. */
	demote(key: K): void;
	/** Adds a handler; item events carry `item` and `key`. */
	onItem(
		event: InstanceEventName,
		handler: (event: InstancePointerEvent<K>) => void,
	): () => void;
}

/**
 * The pointer events {@link InstancesNode.onItem} accepts.
 *
 * @category Instancing
 */
export type InstanceEventName =
	| "tap"
	| "doubletap"
	| "longpress"
	| "contextmenu"
	| "pointerdown"
	| "pointermove"
	| "pointerup"
	| "enter"
	| "leave";

/**
 * Draws one item per element of `data` with one node: the shape `definition`
 * with per-item `channels`, keyed enter/update/exit and per-item tweens or
 * springs.
 *
 * - **Items and order.** Items are identified by `key` (default: the item).
 *   Spec index `i` (`event.item`, `keyAt(i)`) is the item's position: the
 *   data's order, with an item that is animating out kept right after the
 *   item that preceded it before it left. Keys must be unique.
 * - **Channels.** Each channel is a function of the item for one
 *   instanceable prop; every other prop comes from `shared`. Props named in
 *   `transition.enter.from` / `exit.to` (or an `animateItem` target) become
 *   channels too, their resting value being the shared one. Gradient fills
 *   are rejected.
 * - **Reveals.** `progress` means what it means on a single shape: each
 *   item's arc-length reveal, 0..1 (its stroke traces along its outline and
 *   a closed outline's fill comes up with it). A shared `progress` reveals
 *   every item to that value; a `progress` channel varies it per item (and
 *   `promote(key)` hands the node its item's value). While any item is
 *   partly revealed, a disc or box layer is drawn from the shape's own
 *   outlines (so the trace starts where a single shape's does); once every
 *   item is at 1 it is discs or boxes again. A `dashOffset` channel shifts
 *   each item's dash (scaled with its stroke, like the dash).
 * - **Transitions.** Without `transition` every change is instant. With one,
 *   changed channels move with its timing (a tween, or a spring when
 *   `spring` is given, whose settle time is the duration and which keeps its
 *   velocity when retargeted mid-flight); new items start at `enter.from`
 *   (or appear in place), departing items move to `exit.to` and are then
 *   dropped (or vanish at once). `enter` and `exit` timings default to the
 *   update timing; `stagger` counts positions among the items starting
 *   together in one change. The first data enters like any later data.
 *   Under reduced motion every move jumps to its end.
 * - **Drawing.** One `MarksSpec`: discs or boxes when the shape declares an
 *   `instanceMark` (and no item is partly revealed), else one shared outline placed per item, else one outline
 *   per item (when a geometry prop differs between items). Items land
 *   exactly where the equivalent single nodes would, under any space.
 * - **Events.** Handlers in `shared`, `node.on(...)` and `onItem(...)` get
 *   `event.item` and `event.key` for the item under the pointer.
 * - **Cost.** Only items in flight are advanced per frame, and the clock is
 *   listened to only while one is; an idle node costs nothing per frame and
 *   republishes the same spec. A frame where items moved rebuilds the
 *   arrays their channels feed (O(items)).
 *
 * @example
 * ```ts
 * import { circle, createScene, instances } from "@sophistry/core";
 *
 * interface Sample {
 * 	id: number;
 * 	x: number;
 * 	y: number;
 * 	color: string;
 * }
 *
 * const random = (id: number): Sample => ({ id, x: 8 * Math.random() - 4, y: 4 * Math.random() - 2, color: "tomato" });
 * const points = Array.from({ length: 1000 }, (_, id) => random(id));
 * const moved = points.slice(100).map((point) => ({ ...point, y: -point.y }));
 * const nextPoints = [...moved, ...Array.from({ length: 100 }, (_, i) => random(1000 + i))];
 *
 * const scene = createScene({ host: document.body });
 * const dots = instances(circle, {
 * 	data: points,
 * 	key: (point) => point.id,
 * 	channels: { center: (point) => point, fill: (point) => point.color },
 * 	shared: { radius: 0.05 },
 * 	transition: { duration: 0.5, stagger: 0.002, enter: { from: { opacity: 0 } } },
 * });
 * scene.root.add(dots);
 * dots.set("data", nextPoints); // tweens kept points, fades new ones in
 * ```
 *
 * @param definition - A shape definition (made by `defineShape`).
 * @param options - See {@link InstancesOptions}.
 * @returns The node; add it to a container.
 * @throws `TypeError` when `definition` is not a shape, or a channel is not
 *   an instanceable prop of it.
 * @category Instancing
 */
export function instances<
	P extends object,
	N extends SceneNode<P>,
	I extends keyof P,
	T,
	K = T,
>(
	definition: Definition<P, N, I>,
	options: InstancesOptions<T, P, I, K>,
): InstancesNode<T, P, N, I, K> {
	const itemDefinition = definition as unknown as Definition<ShapeProps>;
	const props = options as unknown as Omit<
		InstancesNodeProps,
		"itemDefinition"
	>;
	checkInstances(itemDefinition, props);
	const node = instancesDefinition.create({ itemDefinition, ...props });
	return node as unknown as InstancesNode<T, P, N, I, K>;
}
