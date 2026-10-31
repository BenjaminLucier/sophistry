/**
 * `wrap(definition)`: a core definition as a React component.
 *
 * The component is not a function: it is a host element type of the
 * Sophistry reconciler (`"sophistry:Circle"`), registered in a module-level
 * catalogue under that name. `<Circle radius={1} />` therefore costs one host
 * fiber and nothing else: no wrapper component, no hooks, no effect. The
 * reconciler (`reconciler.ts`) looks the definition up when React creates the
 * instance and calls `definition.create(props)`; later renders hand it the
 * old and new props and it calls `node.set` for the keys that changed.
 *
 * These elements are only meaningful inside a `<Stage>` (or `<MultiStage>`),
 * whose children render through the Sophistry reconciler. Rendered by
 * `react-dom` directly they would become unknown DOM elements.
 */

import type {
	Definition,
	NodeOf,
	PropsOf,
	Readable,
	SceneNode,
} from "@sophistry/core";
import type { ReactNode, Ref } from "react";

/** The prefix of every host element type the catalogue hands out. */
const PREFIX = "sophistry:";

/**
 * Keys of `P` that hold child nodes: the type-level stand-in for a descriptor
 * entry of kind `"children"` (whose kind the descriptor's type does not
 * carry).
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

/** A prop as a component takes it: plain or a `Readable` to bind; handlers as they are. */
type ComponentProp<T> =
	NonNullable<T> extends (...args: never[]) => unknown ? T : T | Readable<T>;

/**
 * The props of the component `wrap(definition)` returns.
 *
 * - Every prop of the definition except its `"children"`-kind one, plain or
 *   as a `Readable` (a `Track`, a `derive`): a `Readable` binds, so the node
 *   follows it without React re-rendering. Handler props (`onTap`, ...) take
 *   functions. Required and optional props stay as the definition has them.
 * - `children?: ReactNode` when the definition takes child nodes (a group, a
 *   composite with a children prop).
 * - `ref?: Ref<N>`: the node handle (`ref.current.bounds()`, `.set(...)`).
 *
 * @typeParam D - The definition (`typeof circle`).
 *
 * @example
 * ```tsx
 * import type { ComponentProps } from "@sophistry/react";
 * import type { circle } from "@sophistry/core";
 *
 * type MyCircleProps = ComponentProps<typeof circle>;
 * ```
 *
 * @category Bindings
 */
export type ComponentProps<D> = {
	[K in keyof PropsOf<D> as K extends ChildrenKeys<PropsOf<D>>
		? never
		: K]: ComponentProp<PropsOf<D>[K]>;
} & ([ChildrenKeys<PropsOf<D>>] extends [never]
	? unknown
	: { children?: ReactNode }) & { ref?: Ref<NodeOf<D>> };

/**
 * The component `wrap` returns: typed as a function component so JSX checks
 * its props, but at run time a host element type string.
 *
 * @typeParam D - The definition.
 *
 * @category Bindings
 */
export type SophistryComponent<D> = (props: ComponentProps<D>) => ReactNode;

/**
 * What the reconciler knows about one host element type.
 *
 * @internal
 */
export interface CatalogueEntry {
	/** The registered host element type (`"sophistry:Circle"`). */
	readonly type: string;
	readonly definition: Definition;
	/**
	 * The definition's prop of kind `"children"`, if any: React children are
	 * collected into it (`node.set(childrenKey, nodes)`).
	 */
	readonly childrenKey: string | undefined;
	/** Whether the nodes take children at all (a children prop or `container: true`). */
	readonly takesChildren: boolean;
}

/** What every `Definition<P, N>` is assignable to, whatever `P` and `N`. */
interface DefinitionShape {
	readonly kind: "primitive" | "composite";
	readonly name: string;
	readonly descriptor: object;
	readonly container: boolean;
	create(...args: never[]): unknown;
}

const byType = new Map<string, CatalogueEntry>();
const byDefinition = new Map<Definition, CatalogueEntry>();

/**
 * Turns a definition into a component usable inside `<Stage>`.
 *
 * The returned value is a host element type (`"sophistry:Circle"`) of the
 * Sophistry reconciler, so each element is one host fiber with no wrapper
 * component. Wrapping the same definition twice returns the same type; two
 * different definitions sharing a name get distinct types (`"sophistry:Dot"`,
 * `"sophistry:Dot#2"`).
 *
 * The bindings' generated entries call it for every definition a package
 * exports (`export const Circle = wrap(circle);`); call it yourself for your
 * own `definePrimitive`/`defineShape`/`defineComposite` definitions.
 *
 * Only valid inside `<Stage>`/`<MultiStage>`: rendered by `react-dom`
 * directly, the element would become an unknown DOM element.
 *
 * @example
 * ```tsx
 * import { defineShape, Invalidate as Invalidate, type ShapeProps, shapeProps } from "@sophistry/core";
 * import { Stage, wrap } from "@sophistry/react";
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
 * export const Diamond = wrap(diamond);
 *
 * export const Figure = () => (
 * 	<Stage>
 * 		<Diamond size={2} />
 * 	</Stage>
 * );
 * ```
 *
 * @param definition - A definition made by `definePrimitive`, `defineShape`,
 * `defineComposite` and friends.
 * @returns The component.
 * @category Bindings
 */
export function wrap<D extends DefinitionShape>(
	definition: D,
): SophistryComponent<D> {
	const known = byDefinition.get(definition as unknown as Definition);
	if (known) return known.type as unknown as SophistryComponent<D>;
	const base = `${PREFIX}${definition.name}`;
	let type = base;
	for (let suffix = 2; byType.has(type); suffix++) type = `${base}#${suffix}`;
	const descriptor = definition.descriptor as Record<
		string,
		{ readonly kind?: string }
	>;
	const childrenKey = Object.keys(descriptor).find(
		(key) => descriptor[key]?.kind === "children",
	);
	const entry: CatalogueEntry = {
		type,
		definition: definition as unknown as Definition,
		childrenKey,
		takesChildren: childrenKey !== undefined || definition.container,
	};
	byType.set(type, entry);
	byDefinition.set(entry.definition, entry);
	return type as unknown as SophistryComponent<D>;
}

/**
 * The catalogue entry for a host element type, or undefined.
 *
 * @internal
 */
export function catalogueEntry(type: string): CatalogueEntry | undefined {
	return byType.get(type);
}
