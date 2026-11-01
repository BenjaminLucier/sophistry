/**
 * The node base every scene node extends: props and bindings, dirty stage
 * bits, events, context lookup, handles and disposal, decided in one place.
 *
 * A node keeps its props in a plain object (`props`) that its stages read.
 * `set` stores a value and ORs the prop's stage bits into `dirty`; a bound
 * `Readable` only marks the key stale, and the value is pulled at refresh
 * with `peek()`, so three writes to a track in one frame cost one update.
 * `refresh()` (run by the scene's commit, or on demand by a handle) pulls,
 * makes sure the parent's space is current, and calls `run(dirty)` once with
 * every pending bit. Subclasses implement `run`.
 */

import { boundsUnder } from "../geometry/bounds.js";
import type { Bounds, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import { compose, IDENTITY } from "../geometry/transform.js";
import type {
	InteractionHandlers,
	InteractionProps,
} from "../interact/types.js";
import { hasInteraction } from "../interact/types.js";
import type { Readable } from "../reactive/index.js";
import { isReadable } from "../reactive/index.js";
import {
	boundsCenter,
	boundsHeight,
	boundsWidth,
	pointOn,
} from "../spec/layout.js";
import type { DrawSpec } from "../spec/types.js";
import type { BaseContainer } from "./container.js";
import { Invalidate } from "./context.js";
import type { SceneGraph } from "./graph.js";
import { interactionGroupContext } from "./interaction-group-context.js";
import type {
	Bindable,
	ContextKey,
	CreateProps,
	Definition,
	InvalidateBits,
	NodeEvents,
	PropDescriptor,
	SceneNode,
	Space,
} from "./types.js";
import { SpaceChange } from "./types.js";

/** A placeholder `stop` until the subscription exists. */
const noop = () => {};

/** Ids are unique for the page's lifetime, so a node keeps its id when it moves between scenes. */
let nextNodeId = 1;

/**
 * The space of a node with no parent: identity, opaque, unclipped, y up.
 *
 * @category Scene graph
 */
export const ROOT_SPACE: Space = Object.freeze({
	matrix: IDENTITY,
	opacity: 1,
	clip: undefined,
	penScale: undefined,
	yUp: true,
});

/**
 * Passed to `contextChanged` when a node moved under a new parent: any
 * context value may differ now.
 *
 * @internal
 */
export const ANY_CONTEXT: ContextKey<unknown> = Object.freeze({
	name: "(any)",
	defaultValue: undefined,
});

/** Event name to the matching `onX` handler prop. */
const HANDLER_KEYS = {
	pointerdown: "onPointerDown",
	pointermove: "onPointerMove",
	pointerup: "onPointerUp",
	tap: "onTap",
	doubletap: "onDoubleTap",
	longpress: "onLongPress",
	contextmenu: "onContextMenu",
	wheel: "onWheel",
	enter: "onEnter",
	leave: "onLeave",
} as const satisfies Record<
	Exclude<keyof NodeEvents, "dispose">,
	keyof InteractionHandlers
>;

type HandlerEvent = keyof typeof HANDLER_KEYS;

/** The behaviour props an interaction record carries alongside the handlers. */
const BEHAVIOUR_KEYS = [
	"hover",
	"drag",
	"keyboard",
	"drop",
	"itemLabel",
] as const satisfies readonly (keyof InteractionHandlers)[];

/**
 * A prop following a Readable. It carries its own key, descriptor and stale
 * flag so that marking and pulling it (once per bound prop per frame, ten
 * thousand times a frame when every shape follows a track) neither looks
 * anything up by key nor allocates.
 */
interface Binding {
	readonly key: PropertyKey;
	readonly source: Readable<unknown>;
	readonly descriptor: PropDescriptor<unknown>;
	stop: () => void;
	/** Whether the binding is on the node's stale list. */
	stale: boolean;
	/** True while its source is being read, so a re-entrant refresh skips it. */
	pulling: boolean;
	/** False once replaced or unbound: a stale entry left on the list is skipped. */
	active: boolean;
}

/** Two matrices (or nulls) with the same entries. */
export function sameMatrix(a: Matrix | null, b: Matrix | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.a === b.a &&
		a.b === b.b &&
		a.c === b.c &&
		a.d === b.d &&
		a.e === b.e &&
		a.f === b.f
	);
}

/**
 * `fn` remembering its last call: the same arguments (by identity) return the
 * same result object. The last-input cache a stage uses to skip work and keep
 * its result's identity (which the renderer's caches key on).
 *
 * @example
 * ```ts
 * import { memo } from "@sophistry/core/internal";
 *
 * const ticks = memo((min: number, max: number) => [min, (min + max) / 2, max]);
 * ticks(0, 1) === ticks(0, 1); // true
 * ```
 *
 * @param fn - A pure function.
 * @returns `fn` with a one-entry cache.
 * @category Scene graph
 */
export function memo<A extends unknown[], R>(
	fn: (...args: A) => R,
): (...args: A) => R {
	let lastArgs: A | null = null;
	let lastResult: R;
	return (...args: A) => {
		if (lastArgs && sameArguments(lastArgs, args)) return lastResult;
		lastResult = fn(...args);
		lastArgs = args;
		return lastResult;
	};
}

/** Two argument lists equal element by element (a loop: no closure per call). */
function sameArguments(a: readonly unknown[], b: readonly unknown[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * The base class of every scene node. Subclass it (or `BaseContainer`) for a
 * new node kind and implement {@link BaseNode.run}; for a new *shape*, use
 * `defineShape` instead, which needs no class.
 *
 * Members marked `@internal` are the scene's plumbing: public so the graph,
 * the collector and the interaction registry can reach them, not API.
 *
 * @typeParam P - The node's props.
 *
 * @category Scene graph
 */
export abstract class BaseNode<P extends object = object>
	implements SceneNode<P>
{
	readonly id: number = nextNodeId++;
	readonly definition: Definition<P>;

	/** @internal The containing node. */
	parentNode: BaseContainer | null = null;
	/** @internal The scene graph this node is attached to. */
	graph: SceneGraph | null = null;
	/** @internal Pending stage bits. New nodes start with every bit. */
	dirty: InvalidateBits = Invalidate.ALL;
	/** @internal Whether the node is on its graph's dirty list. */
	queued = false;
	/** @internal Position in the scene's depth-first order (z ties, tab order). */
	treeIndex = -1;
	/** @internal The spec in the published frame (the collector's bookkeeping). */
	published: DrawSpec | null = null;
	/** @internal The index of `published` in the frame (valid while `published` is set). */
	frameSlot = -1;
	/** @internal The parent's last `setChildren` epoch that listed this node. */
	reconcileMark = 0;
	/**
	 * @internal `spec.zIndex` of the current spec, copied at publish: the
	 * collector's re-sort reads it for every node, and a spec with lazy
	 * getters can be a slow (dictionary-mode) object to read from.
	 */
	specZIndex = 0;
	/** @internal `published.zIndex`, copied likewise. */
	publishedZIndex = 0;

	/** Whether this kind publishes a spec (drawables) or not (containers). */
	readonly producesSpec: boolean = false;

	/**
	 * The resolved props the stages read: what was set, or a bound source's
	 * last pulled value. Unset keys are absent (stages apply defaults).
	 */
	protected readonly props: P;

	private disposedFlag = false;
	private bindings: Map<PropertyKey, Binding> | null = null;
	/**
	 * Bindings whose source went stale since the last pull, each once. Made
	 * with the first binding, then reused across frames (emptied, not
	 * replaced) rather than a fresh set per frame. A binding replaced or
	 * removed meanwhile stays listed and is skipped by the pull.
	 */
	private staleBindings: Binding[] | null = null;
	private listeners: Map<PropertyKey, Set<() => void>> | null = null;
	private handlers: Map<
		keyof NodeEvents,
		Set<NodeEvents[keyof NodeEvents]>
	> | null = null;
	private handlerCache: InteractionHandlers | null = null;
	private currentSpec: DrawSpec | null = null;
	/**
	 * Handle caches, made on the first handle read: most nodes are never
	 * measured, and a node built per frame (churn) should not pay for them.
	 */
	private boundsCache: typeof boundsUnder | null = null;
	private localBoundsCache: typeof boundsUnder | null = null;
	private composeCache: typeof compose | null = null;

	constructor(definition: Definition<P>) {
		this.definition = definition;
		this.props = {} as P;
	}

	/**
	 * Writes the props a definition's `create` was given (undefined values are
	 * skipped). Separate from the constructor so subclass fields exist first.
	 *
	 * @internal
	 */
	init(props: CreateProps<P> | undefined): this {
		if (!props) return this;
		for (const key of Object.keys(props) as (keyof P)[]) {
			const value = props[key];
			if (value !== undefined) this.set(key, value);
		}
		return this;
	}

	get type(): string {
		return this.definition.name;
	}

	get parent(): BaseContainer | null {
		return this.parentNode;
	}

	get disposed(): boolean {
		return this.disposedFlag;
	}

	/** The spec this node currently publishes, or null (hidden, empty, or not a drawable). */
	get spec(): DrawSpec | null {
		return this.currentSpec;
	}

	/**
	 * The space this node lives in: its parent's child space, or the identity
	 * space without a parent. Current only after `refresh()`.
	 */
	get space(): Space {
		return this.parentNode ? this.parentNode.childSpace : ROOT_SPACE;
	}

	/* ------------------------------------------------------------ props */

	get<K extends keyof P>(key: K): P[K] {
		const binding = this.bindings?.get(key);
		const value = binding
			? (binding.source.peek() as P[K])
			: (this.props[key] as P[K]);
		if (value !== undefined) return value;
		return this.descriptorOf(key).default as P[K];
	}

	set<K extends keyof P>(key: K, value: P[K] | Readable<P[K]>): this {
		if (this.disposedFlag) return this;
		const descriptor = this.descriptorOf(key);
		const binding = this.bindings?.get(key);
		if (descriptor.kind !== "event" && isReadable(value)) {
			if (binding?.source === value) return this;
			if (binding) this.unbind(binding);
			this.bindings ??= new Map();
			this.staleBindings ??= [];
			const next: Binding = {
				key,
				source: value,
				descriptor: descriptor as PropDescriptor<unknown>,
				stop: noop,
				stale: false,
				pulling: false,
				active: true,
			};
			next.stop = value.subscribe(() => this.markStale(next));
			this.bindings.set(key, next);
			this.apply(key, value.peek() as P[K], descriptor);
			return this;
		}
		if (binding) {
			this.unbind(binding);
			this.bindings?.delete(key);
		}
		this.apply(key, value as P[K], descriptor);
		return this;
	}

	update(props: Bindable<P>): this {
		for (const key of Object.keys(props) as (keyof P)[]) {
			this.set(key, props[key] as P[keyof P]);
		}
		return this;
	}

	readable<K extends keyof P>(key: K): Readable<P[K]> {
		this.descriptorOf(key);
		return {
			peek: () => this.get(key),
			subscribe: (onStale) => {
				this.listeners ??= new Map();
				let set = this.listeners.get(key);
				if (!set) {
					set = new Set();
					this.listeners.set(key, set);
				}
				set.add(onStale);
				return () => {
					this.listeners?.get(key)?.delete(onStale);
				};
			},
		};
	}

	/** The descriptor entry for `key`; throws for a prop the definition does not have. */
	protected descriptorOf<K extends keyof P>(key: K): PropDescriptor<P[K]> {
		const descriptor = this.definition.descriptor[key];
		if (!descriptor) {
			throw new TypeError(
				`${this.definition.name} has no prop "${String(key)}".`,
			);
		}
		return descriptor;
	}

	/** Stores a resolved value and invalidates what it affects. */
	private apply<K extends keyof P>(
		key: K,
		value: P[K],
		descriptor: PropDescriptor<P[K]>,
	): void {
		if (Object.is(this.props[key], value)) return;
		if (value === undefined) delete this.props[key];
		else this.props[key] = value;
		if (descriptor.kind === "event") this.handlerCache = null;
		this.propChanged(key, descriptor);
		const listeners = this.listeners?.get(key);
		if (listeners) for (const onStale of [...listeners]) onStale();
	}

	/**
	 * Called after a prop's resolved value changed. The default invalidates the
	 * descriptor's stage bits; containers route `children` props, composites
	 * record the key for `update`.
	 */
	protected propChanged<K extends keyof P>(
		_key: K,
		descriptor: PropDescriptor<P[K]>,
	): void {
		if (descriptor.invalidates & Invalidate.INTERACTION)
			this.handlerCache = null;
		this.invalidate(descriptor.invalidates);
	}

	/** Ends a binding's subscription; a pending stale entry for it is skipped. */
	private unbind(binding: Binding): void {
		binding.active = false;
		binding.stop();
	}

	/** A bound source went stale: remember the binding, tell listeners, get on the dirty list. */
	private markStale(binding: Binding): void {
		if (this.disposedFlag) return;
		if (!binding.stale) {
			binding.stale = true;
			this.staleBindings?.push(binding);
		}
		if (this.listeners) {
			const listeners = this.listeners.get(binding.key);
			if (listeners) for (const onStale of [...listeners]) onStale();
		}
		this.enqueue();
	}

	/** Pulls every stale binding's value. */
	private pull(): void {
		const stale = this.staleBindings;
		if (!stale) return;
		// By index against the live length: a binding marked during the pull
		// (a `propChanged` reaching user code) is pulled in this same pass.
		for (let i = 0; i < stale.length; i++) {
			const binding = stale[i] as Binding;
			binding.stale = false;
			// Replaced or unbound since it was marked.
			if (!binding.active) continue;
			// Being pulled further up the stack: its source reads this node's
			// `localBounds()` (a `place` bound to the node's own box), which
			// does not depend on it. Leave it to the outer pull.
			if (binding.pulling) continue;
			const key = binding.key as keyof P;
			binding.pulling = true;
			let value: P[typeof key];
			try {
				value = binding.source.peek() as P[typeof key];
			} finally {
				binding.pulling = false;
			}
			if (Object.is(this.props[key], value)) continue;
			if (value === undefined) delete this.props[key];
			else this.props[key] = value;
			this.propChanged(key, binding.descriptor as PropDescriptor<P[keyof P]>);
		}
		stale.length = 0;
	}

	/* ------------------------------------------------------ dirty & run */

	/**
	 * ORs `bits` into the pending stages and puts the node on its scene's
	 * dirty list (which schedules a commit).
	 */
	invalidate(bits: InvalidateBits): void {
		if (bits === 0 || this.disposedFlag) return;
		this.dirty |= bits;
		this.enqueue();
	}

	private enqueue(): void {
		if (this.queued || !this.graph) return;
		this.graph.enqueue(this);
	}

	/** @internal Whether a refresh would do anything. */
	needsRefresh(): boolean {
		return (
			this.dirty !== 0 ||
			(this.staleBindings !== null && this.staleBindings.length > 0)
		);
	}

	/**
	 * Brings the node up to date now: refreshes a stale parent first (so its
	 * space is current), pulls stale bindings, then runs the pending stages.
	 * The commit calls it for every dirty node; handles call it so a box read
	 * right after a write is already right.
	 */
	refresh(): void {
		if (this.disposedFlag) return;
		const parent = this.parentNode;
		if (parent?.needsRefresh()) parent.refresh();
		if (this.staleBindings !== null && this.staleBindings.length > 0) {
			this.pull();
		}
		const dirty = this.dirty;
		if (dirty === 0) return;
		this.dirty = 0;
		if (dirty & Invalidate.INTERACTION) this.graph?.syncInteraction(this);
		this.run(dirty);
	}

	/**
	 * Reruns the stages in `dirty` (never 0). Drawables call
	 * {@link BaseNode.publish} with their spec.
	 */
	protected abstract run(dirty: InvalidateBits): void;

	/**
	 * Hands the collector a new spec (or null to leave the frame). Keep
	 * returning the same object while nothing changed: the collector and the
	 * renderer compare by identity.
	 */
	protected publish(spec: DrawSpec | null): void {
		if (spec === this.currentSpec) return;
		this.currentSpec = spec;
		this.specZIndex = spec ? spec.zIndex : 0;
		this.graph?.specChanged(this);
	}

	/**
	 * The stage bits a change of the enclosing space invalidates. Default:
	 * none (a node that ignores its space).
	 */
	protected stagesForSpace(_change: number): InvalidateBits {
		return 0;
	}

	/** The stage bits a change of a context value invalidates. Default: none. */
	protected stagesForContext(_key: ContextKey<unknown>): InvalidateBits {
		return 0;
	}

	/** @internal The enclosing space changed (`change`: `SpaceChange` bits). */
	spaceChanged(change: number): void {
		this.invalidate(this.stagesForSpace(change));
	}

	/** @internal A context value above changed (`ANY_CONTEXT`: any may have). */
	contextChanged(key: ContextKey<unknown>): void {
		let bits = this.stagesForContext(key);
		// Joining or leaving an interaction group changes whether this node
		// wants a record; only drawables join, and only a node that is or would
		// be a member pays for the re-check.
		if (
			this.producesSpec &&
			(key === interactionGroupContext || key === ANY_CONTEXT) &&
			(this.graph?.interactive.has(this) ||
				this.context(interactionGroupContext) !== null)
		)
			bits |= Invalidate.INTERACTION;
		this.invalidate(bits);
	}

	/** @internal Called by the parent after this node was placed under it. */
	reparented(): void {
		this.spaceChanged(SpaceChange.ALL);
		this.contextChanged(ANY_CONTEXT);
	}

	/** @internal Joins `graph` (recursively, for containers). */
	attach(graph: SceneGraph): void {
		this.graph = graph;
		graph.nodeAttached(this);
		if (this.needsRefresh()) graph.enqueue(this);
		if (this.wantsInteraction()) this.invalidate(Invalidate.INTERACTION);
	}

	/** @internal Leaves the graph (recursively, for containers). */
	detach(): void {
		const graph = this.graph;
		if (!graph) return;
		graph.nodeDetached(this);
		this.graph = null;
		this.queued = false;
		this.published = null;
	}

	/* ------------------------------------------------------------ context */

	context<T>(key: ContextKey<T>): T {
		for (let node = this.parentNode; node; node = node.parentNode) {
			const provided = node.providedValues;
			if (provided?.has(key)) return provided.get(key) as T;
		}
		return key.defaultValue;
	}

	/* ------------------------------------------------------------- events */

	on<K extends keyof NodeEvents>(event: K, handler: NodeEvents[K]): () => void {
		if (this.disposedFlag) return () => {};
		this.handlers ??= new Map();
		let set = this.handlers.get(event);
		if (!set) {
			set = new Set();
			this.handlers.set(event, set);
		}
		set.add(handler);
		const interactive = event !== "dispose";
		if (interactive) {
			this.handlerCache = null;
			this.invalidate(Invalidate.INTERACTION);
		}
		return () => {
			if (!this.handlers?.get(event)?.delete(handler)) return;
			if (interactive) {
				this.handlerCache = null;
				this.invalidate(Invalidate.INTERACTION);
			}
		};
	}

	/**
	 * @internal Whether the interaction registry should hold a record for this
	 * node: it has an interaction prop or an event handler, or it is a drawable
	 * inside an `interactionGroup` (whose handlers it answers to).
	 */
	wantsInteraction(): boolean {
		if (hasInteraction(this.props as InteractionProps)) return true;
		if (this.producesSpec && this.context(interactionGroupContext) !== null)
			return true;
		if (!this.handlers) return false;
		for (const [event, set] of this.handlers) {
			if (event !== "dispose" && set.size > 0) return true;
		}
		return false;
	}

	/**
	 * @internal The node's interaction props as set (no descriptor defaults),
	 * for the registry's getters: an unset `role` must stay unset so an
	 * enclosing group's can apply.
	 */
	interactionProps(): InteractionProps {
		return this.props as InteractionProps;
	}

	/**
	 * @internal The node's handlers for the pointer driver: its `onX` props and
	 * behaviour props, with every `on(...)` handler folded in (all of them run).
	 */
	interactionHandlers(): InteractionHandlers {
		if (this.handlerCache) return this.handlerCache;
		const props = this.props as InteractionProps;
		const merged: Record<string, unknown> = {};
		for (const key of BEHAVIOUR_KEYS) {
			if (props[key] !== undefined) merged[key] = props[key];
		}
		for (const event of Object.keys(HANDLER_KEYS) as HandlerEvent[]) {
			const key = HANDLER_KEYS[event];
			const own = props[key] as ((...args: never[]) => unknown) | undefined;
			const extra = this.handlers?.get(event);
			if (!extra || extra.size === 0) {
				if (own) merged[key] = own;
				continue;
			}
			const all = [...(own ? [own] : []), ...extra] as ((
				event: unknown,
			) => unknown)[];
			merged[key] =
				event === "wheel"
					? (input: unknown) => {
							let taken = false;
							for (const handler of all) {
								if (handler(input) !== false) taken = true;
							}
							return taken ? undefined : false;
						}
					: (input: unknown) => {
							for (const handler of all) handler(input);
						};
		}
		this.handlerCache = merged as InteractionHandlers;
		return this.handlerCache;
	}

	/* ------------------------------------------------------------ handles */

	/**
	 * The node's outline in its own units, with its offset applied but before
	 * its local TRS: what handles measure. Null for a node without one (the
	 * default; containers measure their children).
	 */
	protected localOutline(): readonly Polyline[] | null {
		return null;
	}

	/** The node's own transform without its offset (place/x/y/rotation/scale), or null. */
	protected localMatrix(): Matrix | null {
		return null;
	}

	bounds(): Bounds | null {
		this.refresh();
		const outline = this.localOutline();
		if (!outline) return null;
		const own = this.localMatrix();
		this.composeCache ??= memo(compose);
		this.boundsCache ??= memo(boundsUnder);
		const matrix = own
			? this.composeCache(this.space.matrix, own)
			: this.space.matrix;
		return this.boundsCache(matrix, outline);
	}

	localBounds(): Bounds | null {
		this.refresh();
		const outline = this.localOutline();
		if (!outline) return null;
		this.localBoundsCache ??= memo(boundsUnder);
		return this.localBoundsCache(this.space.matrix, outline);
	}

	center(): Point | null {
		const box = this.bounds();
		return box ? boundsCenter(box) : null;
	}

	pointAt(direction: Point): Point | null {
		const box = this.bounds();
		return box ? pointOn(box, direction) : null;
	}

	width(): number {
		const box = this.bounds();
		return box ? boundsWidth(box) : 0;
	}

	height(): number {
		const box = this.bounds();
		return box ? boundsHeight(box) : 0;
	}

	/* ------------------------------------------------------------ dispose */

	dispose(): void {
		if (this.disposedFlag) return;
		this.parentNode?.release(this);
		this.disposeTree();
	}

	/**
	 * @internal Disposes this node and its subtree once it is out of its
	 * parent: ends bindings, drops handlers, leaves the graph.
	 */
	disposeTree(): void {
		if (this.disposedFlag) return;
		this.disposedFlag = true;
		this.detach();
		this.parentNode = null;
		if (this.bindings) {
			for (const binding of this.bindings.values()) this.unbind(binding);
			this.bindings = null;
		}
		this.staleBindings = null;
		this.listeners = null;
		this.disposeContents();
		const onDispose = this.handlers?.get("dispose");
		this.handlers = null;
		this.handlerCache = null;
		this.currentSpec = null;
		if (onDispose) for (const handler of onDispose) (handler as () => void)();
	}

	/** Disposes what a subclass owns (children, async work). Default: nothing. */
	protected disposeContents(): void {}

	/** @internal The container's provided context values (containers override). */
	get providedValues(): Map<ContextKey<unknown>, unknown> | null {
		return null;
	}
}
