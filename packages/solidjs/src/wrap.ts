/**
 * `wrap(definition)`: any core definition as a Solid component. The generated
 * entries are one line per definition (`export const Circle = wrap(circle);`).
 *
 * A wrapped component is not a DOM component. It runs once, makes one scene
 * node with the definition's `create`, and returns the node handle; the parent
 * (a `<Stage>` or another wrapped container) collects the handles with Solid's
 * `children()` and hands them to core (`setChildren`). From then on Solid only
 * forwards prop changes one key at a time with `node.set`; nothing re-renders.
 */

import type { JSX } from "@solidjs/web";
import { isDev } from "@solidjs/web";
import type {
	ContainerNode,
	CreateProps,
	Definition,
	NodeOf,
	PropDescriptor,
	PropsOf,
	SceneNode,
} from "@sophistry/core";
import type { CompositeNode } from "@sophistry/core/internal";
import type { Component } from "solid-js";
import { children, createRenderEffect, onCleanup, untrack } from "solid-js";
import { currentScene } from "./context.js";
import { childNodes, NO_NODES, sameNodes, warnOnce } from "./nodes.js";

/**
 * The keys of `P` holding nodes placed inside (a definition's
 * `"children"`-kind prop): what JSX children become. Recognised by type, a
 * `readonly SceneNode[]`, since a descriptor's `kind` is not a literal type.
 */
type ChildrenKeys<P> = {
	[K in keyof P]-?: IsNodeList<NonNullable<P[K]>> extends true ? K : never;
}[keyof P];

/**
 * Whether `T` is a list of scene nodes. A list of `any` (a chart's `data`
 * when the definition is typed `XProps<any>`) is not: `any[]` would match
 * `readonly SceneNode[]` and drop the prop.
 */
type IsNodeList<T> = [T] extends [readonly (infer E)[]]
	? 0 extends 1 & E
		? false
		: [E] extends [SceneNode]
			? true
			: false
	: false;

/**
 * Event-kind props: handlers (`onTap`, ...) and the `hover` sink. Typed as in
 * `P`, since core never binds them (a `Track` given to `hover` is written, not
 * read).
 */
type EventKey = `on${string}` | "hover";

/** `P` minus its children keys, each value plain or a `Readable` to bind. */
type BindableProps<P> = {
	[K in keyof P as K extends ChildrenKeys<P> ? never : K]: K extends EventKey
		? P[K]
		: CreateProps<P>[K];
};

/**
 * Whether a definition takes JSX children: it has a `"children"`-kind prop,
 * or (for primitives) its nodes are containers. A composite's node is always
 * a container internally, but only one with a children prop takes children.
 */
type TakesChildren<D> = [ChildrenKeys<PropsOf<D>>] extends [never]
	? NodeOf<D> extends CompositeNode<infer _P>
		? false
		: NodeOf<D> extends ContainerNode
			? true
			: false
	: true;

/**
 * The props of a component made by {@link wrap}: every prop of the
 * definition, each plain or a `Readable` (which binds in core: no Solid work
 * per frame), keeping its required/optional-ness; event props as in the
 * definition; `children` when the definition takes nodes inside; and `ref`,
 * called once with the node.
 *
 * @typeParam D - The definition (`typeof circle`).
 *
 * @example
 * ```ts
 * import type { circle } from "@sophistry/core";
 * import type { ComponentProps } from "@sophistry/solidjs";
 *
 * type CircleProps = ComponentProps<typeof circle>; // { radius: number | Readable<number>; ... }
 * ```
 *
 * @category Bindings
 */
export type ComponentProps<D> = BindableProps<PropsOf<D>> &
	(TakesChildren<D> extends true
		? { children?: JSX.Element }
		: // biome-ignore lint/complexity/noBannedTypes: no children prop at all
			{}) & {
		/** Called once, right after the node is created, with the node. */
		ref?: (node: NodeOf<D>) => void;
	};

/** What `wrap` accepts: any definition, whatever its props and node type. */
// biome-ignore lint/suspicious/noExplicitAny: a definition of any props
type AnyDefinition = Definition<any, any>;

/**
 * Turns a core definition into a Solid component.
 *
 * Semantics, exactly:
 *
 * 1. **Once.** The component body runs once: it reads the props *untracked*
 *    and calls `definition.create(props)` once, with every prop given except
 *    `children` and `ref` (and the resolved children under the definition's
 *    `"children"`-kind key, so a composite's `setup` already sees them).
 * 2. **One effect per prop.** For every key present when the component is
 *    created, one render effect reads `props[key]` and calls
 *    `node.set(key, value)` when it changes (by identity): only the changed
 *    prop is written. The first run does not write again. A `Readable` is
 *    passed through as-is and core binds it; the effect tracks only the Solid
 *    prop, so writing the Track never runs Solid code. Switching plain ↔
 *    `Readable` is just another `set`, and a value becoming `undefined` is
 *    `set(key, undefined)` (back to the default).
 * 3. **Children.** Resolved with Solid's `children(() => props.children)`,
 *    flattened, keeping scene nodes only (anything else, a string say, is
 *    ignored with a dev warning). A definition with a `"children"`-kind prop
 *    gets `node.set(childrenKey, nodes)` (a container adopts them, a
 *    composite reads them as `ctx.children`); else a `container` definition
 *    gets `node.setChildren(nodes)`; else children are ignored with a dev
 *    warning. A render effect re-runs when the resolved children change
 *    (`<Show>`, `<For>`), writing only when the list differs, so tree order
 *    follows JSX order and nodes keep their identity.
 * 4. **Ref and cleanup.** `props.ref?.(node)` runs once, after creation;
 *    disposing the component's owner calls `node.dispose()` (idempotent, so
 *    it is harmless whether the parent's `setChildren` disposed it first).
 * 5. **Returns the node handle**, never DOM. Wrapped components are only
 *    valid under a `<Stage>` or another wrapped container; outside a stage a
 *    dev warning says so.
 * 6. **Unknown keys** (not in the descriptor) are ignored, with a dev warning
 *    once per key per definition.
 *
 * Limitation: the set of keys is fixed at creation. A key that only appears
 * later through a dynamic spread (`{...(on() ? { fill: "red" } : {})}`) is
 * not followed; pass the key from the start with an `undefined` value
 * instead (`fill={on() ? "red" : undefined}`).
 *
 * @param definition - A definition from `@sophistry/core` (or a feature
 * package), e.g. `circle`.
 * @returns A component whose props are {@link ComponentProps} of it.
 *
 * @example
 * ```tsx
 * import { defineShape, Invalidate as Invalidate, type ShapeProps, shapeProps, track } from "@sophistry/core";
 * import { Stage, wrap } from "@sophistry/solidjs";
 *
 * interface DiamondProps extends ShapeProps {
 * 	size: number;
 * }
 *
 * const diamond = defineShape<DiamondProps>({
 * 	name: "Diamond",
 * 	props: { ...shapeProps, size: { invalidates: Invalidate.GEOMETRY } },
 * 	geometry: ({ size }) => ({
 * 		closed: true,
 * 		polylines: [[{ x: 0, y: size }, { x: size, y: 0 }, { x: 0, y: -size }, { x: -size, y: 0 }]],
 * 	}),
 * });
 *
 * const Diamond = wrap(diamond);
 * const size = track(1);
 *
 * export const Figure = () => (
 * 	<Stage>
 * 		<Diamond size={size} />
 * 	</Stage>
 * );
 * ```
 *
 * @category Bindings
 */
export function wrap<D extends AnyDefinition>(
	definition: D,
): Component<ComponentProps<D>> {
	const descriptor = definition.descriptor as Record<
		string,
		PropDescriptor<unknown>
	>;
	const name = definition.name;
	const childrenKey = Object.keys(descriptor).find(
		(key) => descriptor[key]?.kind === "children",
	);
	const takesChildren = childrenKey !== undefined || definition.container;

	function Wrapped(props: ComponentProps<D>): JSX.Element {
		const source = props as unknown as Record<string, unknown>;
		if (isDev && !currentScene()) {
			warnOnce(
				`${name}:outside`,
				`<${name}> was rendered outside a <Stage>. Scene components return scene nodes, not DOM: render them inside a <Stage> or another scene container.`,
			);
		}

		// 1. Read what was given, untracked: the body must not subscribe.
		const initial: Record<string, unknown> = {};
		const keys: string[] = [];
		let childrenGiven = false;
		untrack(() => {
			for (const key of Object.keys(source)) {
				if (key === "children") {
					childrenGiven = true;
				} else if (key === "ref") {
					// Handled after creation.
				} else if (key === childrenKey || !(key in descriptor)) {
					if (isDev) {
						warnOnce(
							`${name}:${key}`,
							key === childrenKey
								? `<${name}>: pass nodes as JSX children, not as the "${key}" prop; ignored.`
								: `<${name}> has no prop "${key}"; ignored.`,
						);
					}
				} else {
					keys.push(key);
					initial[key] = source[key];
				}
			}
		});

		// 3 (initial). Children are created before the node, so a composite's
		// `setup` sees them.
		let resolved: (() => readonly SceneNode[]) | null = null;
		let nodes: readonly SceneNode[] = NO_NODES;
		if (childrenGiven) {
			if (takesChildren) {
				const resolvedChildren = children(() => source.children as JSX.Element);
				resolved = () => childNodes(resolvedChildren.toArray(), name);
				nodes = untrack(resolved);
			} else if (isDev) {
				warnOnce(
					`${name}:children`,
					`<${name}> takes no children; they are ignored.`,
				);
			}
		}
		if (childrenKey !== undefined && nodes.length > 0) {
			initial[childrenKey] = nodes;
		}

		const node = (definition.create as (props: object) => SceneNode)(initial);
		if (childrenKey === undefined && nodes.length > 0) {
			(node as ContainerNode).setChildren(nodes);
		}
		const write = (key: string, value: unknown) =>
			(node.set as (key: string, value: unknown) => void)(key, value);

		// 2. One render effect per prop: only the changed key is written.
		for (const key of keys) {
			let first = true;
			createRenderEffect(
				() => source[key],
				(value) => {
					if (first) {
						first = false;
						if (Object.is(value, initial[key])) return;
					}
					write(key, value);
				},
			);
		}

		// 3 (updates). Write the children only when the list really changed.
		if (resolved) {
			let current = nodes;
			createRenderEffect(resolved, (next) => {
				if (sameNodes(next, current)) return;
				current = next;
				if (childrenKey !== undefined) write(childrenKey, next);
				else (node as ContainerNode).setChildren(next);
			});
		}

		// 4. Ref once, dispose with the owner.
		const ref = untrack(() => source.ref) as
			| ((node: NodeOf<D>) => void)
			| undefined;
		ref?.(node as NodeOf<D>);
		onCleanup(() => node.dispose());

		// 5. The handle, for the parent's `children()`.
		return node as unknown as JSX.Element;
	}

	Object.defineProperty(Wrapped, "name", { value: name });
	return Wrapped as Component<ComponentProps<D>>;
}
