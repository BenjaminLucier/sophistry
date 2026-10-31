/**
 * `defineComposite`: a node that owns a subtree built from other nodes (a
 * labelled dot, an axis, a chart).
 *
 * `setup(ctx)` runs once, the first time the node is refreshed (so it sees
 * its parent's context), and returns the initial children. `update(changed,
 * ctx)` runs in later commits with the props (and context keys) that changed
 * since; it may return a new children array, reconciled by identity. Between
 * the two, children follow the composite's props without any `update` at all
 * when they are bound to them: `child.set("progress", ctx.prop("progress"))`.
 *
 * A composite does not transform: its children live in its own space. Put a
 * `group` inside for a transform.
 */

import type { Readable } from "../reactive";
import type { Theme } from "../themes/types";
import type { Clock } from "../tween/clock";
import { BaseContainer } from "./container";
import { clockContext, Invalidate, themeContext } from "./context";
import { interactionProps } from "./interaction-props";
import { ANY_CONTEXT, memo } from "./node";
import type {
	ContainerNode,
	ContextKey,
	CreateArguments,
	CreateProps,
	Definition,
	InvalidateBits,
	PropDescriptor,
	PropsDescriptor,
	SceneNode,
	Space,
} from "./types";
import { SpaceChange } from "./types";

/**
 * The reason `update` receives when the space the composite lives in changed
 * in a way it asked about with `ctx.space()` (a prop of that name would be
 * indistinguishable from it, so a composite should not have one).
 *
 * @category Scene graph
 */
export const SPACE_REASON = "space";

/**
 * What a composite changed since its last `update`: prop keys, any context
 * key it read with `ctx.context` whose value changed, and `"space"` when
 * the space it read with `ctx.space()` changed.
 *
 * @category Scene graph
 */
export type Changes<P> = ReadonlySet<
	keyof P | ContextKey<unknown> | typeof SPACE_REASON
>;

/**
 * Options for {@link CompositeContext.list}.
 *
 * @category Scene graph
 */
export interface ListOptions<T, N extends SceneNode> {
	/** Identity of an item across updates. Defaults to the item itself. */
	key?: (item: T, index: number) => unknown;
	/** Makes the node for a new key. */
	create: (item: T, index: number) => N;
	/** Updates a kept node for its (possibly new) item. */
	update?: (node: N, item: T, index: number) => void;
}

/**
 * The helpers a composite's `setup` and `update` receive.
 *
 * @typeParam P - The composite's props.
 *
 * @category Scene graph
 */
export interface CompositeContext<P> {
	/** The composite node itself. */
	readonly node: ContainerNode<P>;
	/** The current props (bound ones already pulled). Read inside setup/update. */
	readonly props: Readonly<P>;
	/**
	 * The nodes passed in the composite's `children` prop (its kind
	 * `"children"` entry), or none. Place them in the returned children.
	 */
	readonly children: readonly SceneNode[];
	/** The active theme. Reading it reruns `update` when it changes. */
	readonly theme: Theme;
	/** The clock in scope (see `clockContext`). */
	readonly clock: Clock;
	/**
	 * A `Readable` view of one of the composite's props, for binding
	 * children to it: they follow it with no `update`.
	 */
	prop<K extends keyof P>(key: K): Readable<P[K]>;
	/**
	 * `fn` with a last-input cache: the same arguments (by identity) return
	 * the same result. Create once in `setup`, call in `update`.
	 */
	memo<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
	/**
	 * Keyed reconciliation of one list of children (one `slot` per list):
	 * returns a node per item in item order, keeping each key's node across
	 * calls (and calling `update` on it), creating nodes for new keys and
	 * disposing those whose keys went away.
	 */
	list<T, N extends SceneNode>(
		slot: string,
		items: readonly T[],
		options: ListOptions<T, N>,
	): N[];
	/** Provides a context value to the composite's subtree. */
	provide<T>(key: ContextKey<T>, value: T): void;
	/** The nearest provided value; `update` reruns when it changes. */
	context<T>(key: ContextKey<T>): T;
	/**
	 * The space the composite lives in (its parent's child space: matrix,
	 * opacity, clip, pen scale), current for this commit. A tracked read, like
	 * {@link CompositeContext.context}: `update` reruns with `"space"` in its
	 * `changed` set whenever one of the fields asked about changes, so a
	 * composite that sizes things by the space (a label measured in pixels, a
	 * line thinned to the pixels it spans, a clip it honours) stays right
	 * when an ancestor zooms, moves or clips. A composite that never calls
	 * this pays one integer test per space change and is never rerun by one.
	 *
	 * @param watch - The `SpaceChange` bits to rerun for, OR-ed across calls.
	 *   Ask only for what is used: a space whose `matrix` changes on every
	 *   frame of a pan reruns a composite that watches it every frame.
	 *   Defaults to every field.
	 */
	space(watch?: number): Space;
	/** Runs `cleanup` when the composite is disposed. */
	onDispose(cleanup: () => void): void;
	/**
	 * Asks for `update` to run again (in this commit when one is draining,
	 * else the next), with `reason` in its `changed` set: for state the
	 * composite keeps outside its props and context, such as reports its
	 * descendants send up (a chart's layers report their data extent).
	 * Mark only; never compute here.
	 */
	invalidate(reason: keyof P | ContextKey<unknown>): void;
}

/**
 * Options for {@link defineComposite}.
 *
 * @category Scene graph
 */
export interface CompositeOptions<P extends object> {
	/** PascalCase display and codegen name. */
	name: string;
	/**
	 * One entry per prop. A non-zero `invalidates` reruns `update` on a write
	 * (use `Invalidate.UPDATE`); `0` for a prop only read through `ctx.prop`.
	 */
	props: PropsDescriptor<P>;
	/** Builds the subtree once. Returns the initial children. */
	setup: (ctx: CompositeContext<P>) => readonly SceneNode[] | undefined;
	/**
	 * Reacts to changed props and context. Returns new children to replace
	 * the old (reconciled by identity), or nothing to keep them.
	 */
	update?: (
		changed: Changes<P>,
		ctx: CompositeContext<P>,
	) => readonly SceneNode[] | undefined;
}

/**
 * A composite node: a container whose children its definition builds.
 *
 * @category Scene graph
 */
export class CompositeNode<P extends object> extends BaseContainer<P> {
	private readonly options: CompositeOptions<P>;
	private compositeContext: CompositeContext<P> | null = null;
	private changed = new Set<
		keyof P | ContextKey<unknown> | typeof SPACE_REASON
	>();
	private readKeys: Set<ContextKey<unknown>> | null = null;
	/** The `SpaceChange` bits `ctx.space()` asked to hear about; 0 until it is called. */
	private spaceWatched = 0;
	private lists: Map<string, Map<unknown, SceneNode>> | null = null;
	private cleanups: (() => void)[] | null = null;

	constructor(definition: Definition<P>, options: CompositeOptions<P>) {
		super(definition);
		this.options = options;
	}

	protected override propChanged<K extends keyof P>(
		key: K,
		descriptor: PropDescriptor<P[K]>,
	): void {
		// `children` is the composite's to place, not the container's to adopt.
		if (descriptor.kind === "children" || descriptor.invalidates !== 0) {
			this.changed.add(key);
			this.invalidate(Invalidate.UPDATE);
		}
		if (descriptor.invalidates & Invalidate.INTERACTION) {
			this.invalidate(Invalidate.INTERACTION);
		}
	}

	override contextChanged(key: ContextKey<unknown>): void {
		if (key === ANY_CONTEXT) {
			if (this.readKeys)
				for (const read of this.readKeys) this.changed.add(read);
			if (this.readKeys?.size) this.invalidate(Invalidate.UPDATE);
		} else if (this.readKeys?.has(key)) {
			this.changed.add(key);
			this.invalidate(Invalidate.UPDATE);
		}
		super.contextChanged(key);
	}

	/**
	 * The enclosing space changed. Only a composite that read it with
	 * `ctx.space()` reruns, and only for the fields it asked about; the
	 * change is always forwarded, as every container forwards it.
	 */
	override spaceChanged(change: number): void {
		if (this.spaceWatched & change) {
			this.changed.add(SPACE_REASON);
			this.invalidate(Invalidate.UPDATE);
		}
		super.spaceChanged(change);
	}

	/**
	 * A composite draws nothing itself, so a prop that merely shares a name
	 * with an interaction prop (a chart mark's `label`, a zoom's `cursor`)
	 * does not make it interactive: only props its descriptor takes from
	 * `interactionProps`, or `node.on(...)` handlers, do.
	 */
	override wantsInteraction(): boolean {
		const descriptor = this.definition.descriptor as Record<string, unknown>;
		const props = this.props as Record<string, unknown>;
		for (const key of Object.keys(interactionProps)) {
			if (
				props[key] !== undefined &&
				descriptor[key] === (interactionProps as Record<string, unknown>)[key]
			)
				return true;
		}
		const handlers = (
			this as unknown as { handlers: Map<string, Set<unknown>> | null }
		).handlers;
		if (!handlers) return false;
		for (const [event, set] of handlers) {
			if (event !== "dispose" && set.size > 0) return true;
		}
		return false;
	}

	protected override run(dirty: InvalidateBits): void {
		if (!(dirty & Invalidate.UPDATE)) return;
		if (!this.compositeContext) {
			this.compositeContext = this.makeContext();
			this.changed.clear();
			const children = this.options.setup(this.compositeContext);
			if (children) this.setChildren(children);
			return;
		}
		if (this.changed.size === 0 || !this.options.update) {
			this.changed.clear();
			return;
		}
		const changed = this.changed;
		this.changed = new Set();
		const children = this.options.update(changed, this.compositeContext);
		if (children) this.setChildren(children);
	}

	private makeContext(): CompositeContext<P> {
		const node = this;
		const props = this.props;
		const childrenKey = (
			Object.keys(this.definition.descriptor) as (keyof P)[]
		).find((key) => this.definition.descriptor[key].kind === "children");
		return {
			node,
			props,
			get children() {
				if (childrenKey === undefined) return [];
				return (props[childrenKey] as readonly SceneNode[] | undefined) ?? [];
			},
			get theme() {
				return this.context(themeContext);
			},
			get clock() {
				return node.context(clockContext);
			},
			prop: (key) => node.readable(key),
			memo,
			list: (slot, items, options) => node.reconcile(slot, items, options),
			provide: (key, value) => node.provide(key, value),
			context: (key) => {
				node.readKeys ??= new Set();
				node.readKeys.add(key as ContextKey<unknown>);
				return node.context(key);
			},
			space: (watch = SpaceChange.ALL) => {
				node.spaceWatched |= watch;
				return node.space;
			},
			onDispose: (cleanup) => {
				node.cleanups ??= [];
				node.cleanups.push(cleanup);
			},
			invalidate: (reason) => {
				if (node.disposed) return;
				node.changed.add(reason);
				node.invalidate(Invalidate.UPDATE);
			},
		};
	}

	private reconcile<T, N extends SceneNode>(
		slot: string,
		items: readonly T[],
		options: ListOptions<T, N>,
	): N[] {
		this.lists ??= new Map();
		let byKey = this.lists.get(slot) as Map<unknown, N> | undefined;
		if (!byKey) {
			byKey = new Map();
			this.lists.set(slot, byKey);
		}
		const next = new Map<unknown, N>();
		const nodes: N[] = new Array(items.length);
		for (let i = 0; i < items.length; i++) {
			const item = items[i] as T;
			const key = options.key ? options.key(item, i) : item;
			if (next.has(key)) {
				throw new Error(`${this.type}: duplicate key in list "${slot}".`);
			}
			let node = byKey.get(key);
			if (node && !node.disposed) options.update?.(node, item, i);
			else node = options.create(item, i);
			next.set(key, node);
			nodes[i] = node;
		}
		for (const [key, node] of byKey) {
			if (!next.has(key)) node.dispose();
		}
		this.lists.set(slot, next);
		return nodes;
	}

	protected override disposeContents(): void {
		super.disposeContents();
		this.lists = null;
		const cleanups = this.cleanups;
		this.cleanups = null;
		if (cleanups) for (const cleanup of cleanups) cleanup();
	}
}

/**
 * Makes a composite definition.
 *
 * @example
 * ```ts
 * import { circle, type CompositeContext, defineComposite, Invalidate } from "@sophistry/core";
 *
 * interface DotsProps {
 * 	points: readonly { x: number; y: number }[];
 * 	progress?: number;
 * }
 *
 * export const dots = defineComposite<DotsProps>({
 * 	name: "Dots",
 * 	props: {
 * 		points: { default: [], invalidates: Invalidate.UPDATE },
 * 		// Children bind to it: no update needed.
 * 		progress: { default: 1, invalidates: Invalidate.NONE },
 * 	},
 * 	setup: (ctx) => dotList(ctx),
 * 	update: (changed, ctx) => (changed.has("points") ? dotList(ctx) : undefined),
 * });
 *
 * function dotList(ctx: CompositeContext<DotsProps>) {
 * 	return ctx.list("dots", ctx.props.points, {
 * 		create: (point) =>
 * 			circle.create({ center: point, radius: 0.1, progress: ctx.prop("progress") }),
 * 	});
 * }
 * ```
 *
 * @param options - See {@link CompositeOptions}.
 * @returns The definition; `create(props)` makes a {@link CompositeNode}.
 * @category Scene graph
 */
export function defineComposite<P extends object>(
	options: CompositeOptions<P>,
): Definition<P, CompositeNode<P>> {
	const definition: Definition<P, CompositeNode<P>> = {
		kind: "composite",
		name: options.name,
		descriptor: options.props,
		container: Object.values<PropDescriptor<unknown>>(
			options.props as Record<string, PropDescriptor<unknown>>,
		).some((entry) => entry.kind === "children"),
		create: (...args: CreateArguments<P>) =>
			new CompositeNode<P>(definition, options).init(
				args[0] as CreateProps<P> | undefined,
			),
	};
	return Object.freeze(definition);
}
