/**
 * The scene graph's public vocabulary: nodes, containers, prop descriptors,
 * definitions and the space handed down the tree.
 *
 * A scene is a tree of retained nodes. Every node is made by a
 * **definition** (`definePrimitive`, `defineShape`, `defineComposite`), which
 * is plain data: a name, a descriptor saying for each prop its default, the
 * stages a write to it invalidates, whether it may be a per-instance channel
 * and what kind of prop it is. The same descriptor drives updates, instancing,
 * documentation and the generated framework bindings.
 *
 * A write marks the node and the exact stages it affects; the shared frame
 * loop's commit phase pulls stale bindings and reruns only those stages.
 * Nothing re-renders and nothing diffs a tree.
 */

import type { Bounds, Point } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import type {
	SceneNodeWheelEvent,
	ScenePointerEvent,
} from "../interact/types.js";
import type { Readable } from "../reactive/index.js";
import type { ClipRegion } from "../spec/types.js";

/**
 * A set of stage bits (see `Invalidate`): which cached computations of a node a
 * prop write invalidates.
 *
 * @category Scene graph
 */
export type InvalidateBits = number;

/**
 * What kind of prop a descriptor entry describes.
 *
 * - `"value"`: data. Writing it invalidates the stages in `invalidates`; a
 *   `Readable` binds.
 * - `"event"`: a handler (`onTap`, ...). Passed through to the interaction
 *   registry; bindings forward it like any prop.
 * - `"children"`: nodes placed inside a container or composite.
 *
 * @category Scene graph
 */
export type PropKind = "value" | "event" | "children";

/**
 * One prop's entry in a {@link PropsDescriptor}.
 *
 * @typeParam T - The prop's value type.
 *
 * @category Scene graph
 */
export interface PropDescriptor<T> {
	/**
	 * The value `node.get(key)` reports while the prop is unset. Purely
	 * descriptive for the stages, which read the raw prop and apply the same
	 * default themselves (so specs match what `bake()` gives); bindings and docs
	 * read it.
	 */
	readonly default?: T;
	/** Invalidation bits a write to this prop invalidates. `0` for none. */
	readonly invalidates: InvalidateBits;
	/**
	 * Whether the prop may vary per item in an instanced node (`instances()`): a cheap, per-item numeric or colour channel.
	 *
	 * @default false
	 */
	readonly instanceable?: boolean;
	/** @default "value" */
	readonly kind?: PropKind;
}

/**
 * The descriptor of a definition's props: one {@link PropDescriptor} per key
 * of `P`, optional or not. Introspectable at run time (codegen walks it).
 *
 * With `I` given, every key in `I` must also be marked `instanceable: true`,
 * so a definition's declared instanceable keys (see {@link Definition}) can
 * never claim a prop its descriptor does not let `instances()` drive.
 *
 * @typeParam P - The props interface.
 * @typeParam I - Keys that must be marked `instanceable: true`. None by default.
 *
 * @category Scene graph
 */
export type PropsDescriptor<P, I extends keyof P = never> = [I] extends [never]
	? { readonly [K in keyof Required<P>]: PropDescriptor<P[K]> }
	: { readonly [K in keyof Required<P>]: PropDescriptor<P[K]> } & {
			readonly [K in I]-?: { readonly instanceable: true };
		};

/**
 * The instanceable keys a definition made with declared keys `I` carries:
 * `I`, or every key ("not declared") when `I` is left at its default,
 * `never`. Used by `definePrimitive` / `defineShape` for their result.
 *
 * @category Scene graph
 */
export type DeclaredInstanceable<P, I extends keyof P> = [I] extends [never]
	? keyof P
	: I;

/**
 * The props of `P` an `instances()` node may drive per item for a definition
 * declaring instanceable keys `I`: the phantom carried by {@link Definition}.
 * `keyof P` (the default) means "not declared": every key type-checks and
 * `instances()` checks the descriptor at run time.
 *
 * @category Scene graph
 */
export type InstanceableKeys<D> = D extends {
	"~instanceable"?(key: infer I): void;
}
	? I
	: never;

/**
 * Props as a caller may pass them: each value plain or a `Readable` to bind.
 * Keeps `P`'s optionality.
 *
 * @category Scene graph
 */
export type CreateProps<P> = {
	[K in keyof P]: P[K] | Readable<P[K]>;
};

/**
 * Any subset of {@link CreateProps}, for `node.update(...)`.
 *
 * @category Scene graph
 */
export type Bindable<P> = {
	[K in keyof P]?: P[K] | Readable<P[K]>;
};

/**
 * The handlers {@link SceneNode.on} accepts, by event name. The same events
 * are the `onX` props of kind `"event"` (`onTap` is `"tap"`); both fire.
 *
 * @category Scene graph
 */
export interface NodeEvents {
	pointerdown: (event: ScenePointerEvent) => void;
	pointermove: (event: ScenePointerEvent) => void;
	pointerup: (event: ScenePointerEvent) => void;
	tap: (event: ScenePointerEvent) => void;
	doubletap: (event: ScenePointerEvent) => void;
	longpress: (event: ScenePointerEvent) => void;
	contextmenu: (event: ScenePointerEvent) => void;
	/** Return `false` to decline the wheel (see `InteractionHandlers.onWheel`). */
	// biome-ignore lint/suspicious/noConfusingVoidType: a handler that always takes the wheel returns nothing
	wheel: (event: SceneNodeWheelEvent) => boolean | void;
	enter: (event: ScenePointerEvent) => void;
	leave: (event: ScenePointerEvent) => void;
	/** The node was disposed. Runs once, after its subscriptions are gone. */
	dispose: () => void;
}

/**
 * A key into the context handed down the tree, made by `createContextKey`.
 * Containers `provide` a value; descendants read the nearest with
 * `node.context(key)`.
 *
 * @typeParam T - The value type.
 *
 * @category Scene graph
 */
export interface ContextKey<T> {
	/** For error messages and debugging. */
	readonly name: string;
	/** What `context(key)` returns when nothing above provides the key. */
	readonly defaultValue: T;
}

/**
 * The coordinate space a container hands its children: everything that
 * places and dims a node, but **no camera**. It starts as the identity at the
 * scene root and accumulates through groups; `units`, `center`, the canvas
 * size and the device pixel ratio are the renderer's view matrix, applied at
 * paint time, so nothing derived from a space changes when the camera moves.
 *
 * Containers keep the same object while nothing in it changed, so nodes and
 * caches can compare spaces by identity.
 *
 * @category Scene graph
 */
export interface Space {
	/** Local units to the scene's units (identity at the root, composed with each group). */
	readonly matrix: Matrix;
	/** Multiplied down the tree. */
	readonly opacity: number;
	/**
	 * Clip regions every node here is painted through, outermost first, in
	 * scene units; `undefined` when nothing clips. Shared by identity between
	 * nodes under one clipping group.
	 */
	readonly clip: readonly ClipRegion[] | undefined;
	/**
	 * Scene units per authored unit *for the pen*, when that differs from the
	 * matrix's scale (a `LinearTransform` pins it so a shear does not fatten
	 * strokes). `undefined` means "ask the matrix", which is nearly always.
	 */
	readonly penScale: number | undefined;
	/** Whether scene `y` runs up the screen (the scene's `yUp`). */
	readonly yUp: boolean;
}

/**
 * Which fields of a {@link Space} changed, as bits, handed to
 * `node.spaceChanged`.
 *
 * @category Scene graph
 */
export const SpaceChange = {
	MATRIX: 1,
	OPACITY: 2,
	CLIP: 4,
	PEN_SCALE: 8,
	Y_UP: 16,
	ALL: 31,
} as const;

/**
 * A retained scene node. Made by a definition's `create(props)`; placed in a
 * scene by adding it to a container (`scene.root.add(node)`).
 *
 * @typeParam P - The node's props.
 *
 * @category Scene graph
 */
export interface SceneNode<P = object> {
	/** Unique for the page's lifetime; the id its specs, picking and focus use. */
	readonly id: number;
	/** The definition's name, e.g. `"Circle"`. */
	readonly type: string;
	/** The definition that made this node. */
	readonly definition: Definition<P>;
	/** The container this node is in, or null. */
	readonly parent: ContainerNode | null;
	/** Whether {@link SceneNode.dispose} has run. */
	readonly disposed: boolean;
	/**
	 * A prop's current value: the bound `Readable`'s value when bound, else
	 * what was set, else the descriptor's default.
	 */
	get<K extends keyof P>(key: K): P[K];
	/**
	 * Writes a prop. A `Readable` binds: the node follows it (subscribing only
	 * marks the node stale; the value is pulled at commit). A plain value
	 * unbinds. Writing the current value is free.
	 */
	set<K extends keyof P>(key: K, value: P[K] | Readable<P[K]>): this;
	/** Writes several props. */
	update(props: Bindable<P>): this;
	/**
	 * A `Readable` view of one prop: `peek()` is `get(key)`, and subscribers
	 * hear every write and every change of a bound source. For binding one
	 * node's prop to another's.
	 */
	readable<K extends keyof P>(key: K): Readable<P[K]>;
	/** Adds an event handler; returns the function that removes it. */
	on<K extends keyof NodeEvents>(event: K, handler: NodeEvents[K]): () => void;
	/** The nearest value provided for `key` above this node, else its default. */
	context<T>(key: ContextKey<T>): T;
	/**
	 * The box after the node's own transform, in scene units: where it
	 * appears. `null` when it has no points. Lazy, cached on identity.
	 */
	bounds(): Bounds | null;
	/**
	 * The box before the node's own `place`/`x`/`y`/`rotation`/`scale`, in
	 * scene units. Read this for the node being placed and `bounds()` for what
	 * it is placed against.
	 */
	localBounds(): Bounds | null;
	/** Centre of {@link SceneNode.bounds}, or null. */
	center(): Point | null;
	/**
	 * A point on the box in `direction` (Manim's `get_critical_point`): `UP` is
	 * the top edge's midpoint, `UR` the top-right corner, the origin the centre.
	 */
	pointAt(direction: Point): Point | null;
	/** Width of {@link SceneNode.bounds}; 0 without points. */
	width(): number;
	/** Height of {@link SceneNode.bounds}; 0 without points. */
	height(): number;
	/**
	 * Removes the node from its parent, ends every binding and handler, and
	 * disposes its children. Idempotent.
	 */
	dispose(): void;
}

/**
 * A node with children: the scene root, a group, a composite.
 *
 * @category Scene graph
 */
export interface ContainerNode<P = object> extends SceneNode<P> {
	/** The children in tree order (z ties paint in this order). */
	readonly children: readonly SceneNode[];
	/**
	 * Replaces the children, reconciling by identity: kept nodes stay (and are
	 * reordered), new ones are attached (moved from another parent if they
	 * had one), and removed ones are disposed.
	 */
	setChildren(children: readonly SceneNode[]): void;
	/** Appends `child` (or inserts it before `before`), moving it from another parent if needed. */
	add<N extends SceneNode>(child: N, before?: SceneNode | null): N;
	/** Removes and disposes `child`. */
	remove(child: SceneNode): void;
	/**
	 * Provides `value` for `key` to this container's descendants. Providing a
	 * different value later tells the descendants that read it.
	 */
	provide<T>(key: ContextKey<T>, value: T): void;
}

/**
 * Arguments of `definition.create(...)`: the props are optional exactly when
 * `P` has no required key.
 *
 * @category Scene graph
 */
export type CreateArguments<P> =
	// biome-ignore lint/complexity/noBannedTypes: `{}` is "no required keys" here
	{} extends CreateProps<P>
		? [props?: CreateProps<P>]
		: [props: CreateProps<P>];

/**
 * A definition: data describing a kind of node, plus `create`. What the
 * framework bindings wrap and what codegen reads.
 *
 * @typeParam P - The props.
 * @typeParam N - The node type `create` returns.
 * @typeParam I - The props declared `instanceable`, which `instances()`
 *   accepts as per-item channels. A type-level phantom (nothing is stored):
 *   `defineShape<LineProps, ShapeInstanceable | "from" | "to">(...)` declares
 *   it and {@link PropsDescriptor} checks it against the descriptor. Defaults
 *   to every key ("not declared"), which `instances()` checks at run time.
 *
 * @category Scene graph
 */
export interface Definition<
	P = object,
	N extends SceneNode<P> = SceneNode<P>,
	I extends keyof P = keyof P,
> {
	/**
	 * Type-level only, never set: carries `I` so a definition's instanceable
	 * keys survive inference (`InstanceableKeys<typeof circle>`). A method
	 * signature on purpose: its parameter is bivariant, so a definition still
	 * widens to `Definition` / `Definition<object>` whatever its keys.
	 */
	"~instanceable"?(key: I): void;
	/** `"primitive"` (draws or groups) or `"composite"` (owns a subtree built by `setup`). */
	readonly kind: "primitive" | "composite";
	/** Display and codegen name, PascalCase (`"Circle"`). */
	readonly name: string;
	/** Per-prop metadata. */
	readonly descriptor: PropsDescriptor<P>;
	/** Whether nodes made by this definition take children. */
	readonly container: boolean;
	/** Makes a node. */
	create(...args: CreateArguments<P>): N;
}

/** The props type of a definition. @category Scene graph */
export type PropsOf<D> =
	// biome-ignore lint/suspicious/noExplicitAny: matches any node type and instanceable keys
	D extends Definition<infer P, any, any> ? P : never;

/** The node type of a definition. @category Scene graph */
export type NodeOf<D> = D extends { create(...args: never[]): infer N }
	? N
	: never;
