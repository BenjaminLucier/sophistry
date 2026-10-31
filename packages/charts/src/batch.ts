/**
 * The batched-mark helper every per-datum mark draws through: one
 * `instances()` node for the whole layer, keyed by datum key.
 *
 * A per-datum mark is always one instances node:
 *
 * - **Items.** The mark computes one plain item per drawn key on each update
 *   (its scene-unit position, size, colour and opacity at this frame of the
 *   reveal or keyed `to`/`blend` transition) and hands them over with
 *   {@link BatchedMark.update}. The node reconciles them by `key`.
 * - **Seekable transitions** (`to` + `blend`, reveals, range transitions)
 *   are computed by the mark, so every frame is exact and scrubs: the node
 *   is updated instantly.
 * - **Clock-driven transitions** (the mark's `transition` prop): when the
 *   mark's data changes and no `to` is given, the node tweens (or springs)
 *   kept items to their new values in its tween bank, entering items from
 *   the mark's enter state and exiting ones to its exit state. Only data
 *   changes animate this way; a reveal or a range change stays exact.
 * - **Picking.** Handlers get `event.item` (the spec index) and `event.key`;
 *   {@link BatchedMark.itemAt} turns either into the mark's item.
 * - **Individuality.** `node.promote(key)` gives one item a real node.
 *
 * The first items a mark draws appear in place (its reveal brings them in);
 * only later data changes move through the bank.
 *
 * Every enter/exit prop must also be a channel, so turning a transition on
 * or off never rebuilds the node's bank.
 */

import type {
	Bindable,
	Definition,
	InstanceChannels,
	InstancesNode,
	InstanceTiming,
	InstanceTransition,
	InstanceValues,
	SceneNode,
} from "@sophistry/core";
import { instances } from "@sophistry/core";
import type { BandKey } from "@sophistry/core/geometry";

/**
 * A per-datum mark's `transition` prop: how its marks move when its `data`
 * changes (not during a `to`/`blend` transition, which is seekable). A
 * tween (`duration`, `easing`) or a spring (`spring`), with `delay` and
 * `stagger`. `enter` / `exit` say whether new marks grow in and departing
 * ones shrink out (each mark decides how), with their own timing if given.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export interface MarkTransition extends InstanceTiming {
	/**
	 * Entering marks grow in the way the mark reveals; `false` makes them
	 * appear at once. @default true
	 */
	enter?: boolean | InstanceTiming;
	/**
	 * Departing marks shrink out the way the mark reveals, reversed; `false`
	 * removes them at once. @default true
	 */
	exit?: boolean | InstanceTiming;
}

/** An item of a batched mark: anything with the datum's key. */
export interface BatchItem {
	key: BandKey;
}

/**
 * Options of {@link createBatchedMark}.
 *
 * @category Extending
 */
export interface BatchedMarkOptions<D, P, I extends keyof P> {
	/** Per-item props read off the item; keep them stable (made once). */
	channels: InstanceChannels<D, P, I>;
	/** Where an entering item starts under a `transition` (its keys must be channels). */
	enter?: InstanceValues<D, P, I>;
	/** Where an exiting item ends under a `transition` (its keys must be channels). */
	exit?: InstanceValues<D, P, I>;
	/** Props every item shares from the start (any prop; a `Readable` binds). */
	shared?: Bindable<P>;
}

/**
 * A batched mark: its node, and the update it is driven by.
 *
 * @category Extending
 */
export interface BatchedMark<
	D extends BatchItem,
	P extends object,
	N extends SceneNode<P>,
	I extends keyof P,
> {
	/** The instances node; put it in the mark's children. */
	readonly node: InstancesNode<D, P, N, I, BandKey>;
	/**
	 * Writes one update's items and shared props. With `transition` (and
	 * `animate` true) changed items move through the node's tween bank;
	 * otherwise the change is instant.
	 */
	update(
		items: readonly D[],
		shared?: Bindable<P>,
		motion?: { transition: MarkTransition | undefined; animate: boolean },
	): void;
	/** The item at a spec index (`event.item`), or undefined (an exiting item, or none). */
	itemAt(index: number | null | undefined): D | undefined;
	/** The current item with `key`, or undefined. */
	item(key: BandKey): D | undefined;
	/** The current items, in order. */
	readonly items: readonly D[];
}

/** A transition's timing without the `enter`/`exit` switches. */
function timingOf(transition: MarkTransition): InstanceTiming {
	const { enter: _enter, exit: _exit, ...timing } = transition;
	return timing;
}

/**
 * Makes the one instances node of a per-datum mark. Call once, in `setup`;
 * call `update` in every `update` of the mark.
 *
 * @example
 * ```ts
 * import { type CompositeContext, circle, defineComposite, Invalidate } from "@sophistry/core";
 * import { createBatchedMark } from "@sophistry/charts";
 *
 * interface DotsProps {
 * 	points: readonly { x: number; y: number }[];
 * }
 * interface Dot {
 * 	key: number;
 * 	at: { x: number; y: number };
 * }
 *
 * const createDots = () =>
 * 	createBatchedMark(circle, {
 * 		channels: { center: (item: Dot) => item.at },
 * 		enter: { radius: 0 },
 * 		exit: { radius: 0 },
 * 	});
 * const marks = new WeakMap<object, ReturnType<typeof createDots>>();
 *
 * function draw(ctx: CompositeContext<DotsProps>) {
 * 	const dots = marks.get(ctx.node)!;
 * 	const items = ctx.props.points.map((at, key) => ({ key, at }));
 * 	dots.update(items, { radius: 0.1, strokeWidth: 0 }, { transition: { duration: 0.4 }, animate: true });
 * 	return [dots.node];
 * }
 *
 * export const dots = defineComposite<DotsProps>({
 * 	name: "Dots",
 * 	props: { points: { default: [], invalidates: Invalidate.UPDATE } },
 * 	setup: (ctx) => {
 * 		marks.set(ctx.node, createDots());
 * 		return draw(ctx);
 * 	},
 * 	update: (_changed, ctx) => draw(ctx),
 * });
 * ```
 *
 * @param definition - The shape every item is (`circle`, `rect`, `line`, ...).
 * @category Extending
 */
export function createBatchedMark<
	D extends BatchItem,
	P extends object,
	N extends SceneNode<P>,
	I extends keyof P,
>(
	definition: Definition<P, N, I>,
	options: BatchedMarkOptions<D, P, I>,
): BatchedMark<D, P, N, I> {
	let items: readonly D[] = [];
	let byKey: Map<BandKey, D> | null = null;
	const node = instances<P, N, I, D, BandKey>(definition, {
		data: [],
		key: (item) => item.key,
		channels: options.channels,
		shared: options.shared,
	});
	let lastTransition: InstanceTransition<D, P, I> | undefined;
	/** The mark's own transition `lastTransition` was made from. */
	let lastOwn: MarkTransition | undefined;
	/** Whether items have been drawn: the first data appears in place. */
	let drawn = false;
	let lastShared: Bindable<P> | undefined = options.shared;
	const transitionFor = (
		motion:
			| { transition: MarkTransition | undefined; animate: boolean }
			| undefined,
	): InstanceTransition<D, P, I> | undefined => {
		const own = motion?.animate && drawn ? motion.transition : undefined;
		if (!own) return undefined;
		if (own === lastOwn && lastTransition) return lastTransition;
		const enter = own.enter ?? true;
		const exit = own.exit ?? true;
		return {
			...timingOf(own),
			...(enter !== false && options.enter
				? {
						enter: {
							...(typeof enter === "object" ? enter : {}),
							from: options.enter,
						},
					}
				: {}),
			...(exit !== false && options.exit
				? {
						exit: {
							...(typeof exit === "object" ? exit : {}),
							to: options.exit,
						},
					}
				: {}),
		};
	};
	return {
		node,
		update(next, shared, motion) {
			items = next;
			byKey = null;
			const transition = transitionFor(motion);
			const props: Record<string, unknown> = {};
			if (transition !== lastTransition) {
				props.transition = transition;
				lastTransition = transition;
				lastOwn = transition ? motion?.transition : undefined;
			}
			if (next.length > 0) drawn = true;
			if (shared !== undefined && shared !== lastShared) {
				props.shared = shared;
				lastShared = shared;
			}
			props.data = next;
			node.update(props as never);
		},
		itemAt(index) {
			if (index === null || index === undefined) return undefined;
			const key = node.keyAt(index);
			return key === undefined ? undefined : this.item(key);
		},
		item(key) {
			if (!byKey) {
				byKey = new Map();
				for (const item of items) byKey.set(item.key, item);
			}
			return byKey.get(key);
		},
		get items() {
			return items;
		},
	};
}
