/**
 * `definePrimitive`: the one way a node kind becomes a definition.
 *
 * ## How to write a primitive
 *
 * A primitive is a definition: plain data (a name and a props descriptor)
 * plus `create`. Most primitives are **shapes**, and a shape needs no class:
 * hand `defineShape` (`scene/shape.ts`) its props interface, its descriptor
 * and a `geometry` function, and the shared shape pipeline does the rest
 * (theme defaults, transform props, the enclosing space, gradients, reveal,
 * interaction, handles). `shapes/circle.ts` is the reference:
 *
 * ```ts
 * import { arcCurvePath, type Point } from "../geometry/index.js";
 * import { Invalidate } from "../scene/context.js";
 * import { defineShape, type ShapeProps, shapeProps } from "../scene/shape.js";
 *
 * export interface CircleProps extends ShapeProps {
 * 	/** Centre. Defaults to the origin. *\/
 * 	center?: Point;
 * 	/** Radius in scene units. *\/
 * 	radius: number;
 * }
 *
 * export const circle = defineShape<CircleProps>({
 * 	name: "Circle",
 * 	props: {
 * 		...shapeProps,
 * 		// Read by `offset` alone: a move is a new matrix, never a new outline.
 * 		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
 * 		radius: { invalidates: Invalidate.GEOMETRY, instanceable: true },
 * 	},
 * 	// The outline about the origin, in the shape's own units.
 * 	geometry: (props) => ({
 * 		closed: true,
 * 		curvePaths: [{ ...arcCurvePath(0, 0, props.radius, 0, Math.PI * 2), closed: true }],
 * 	}),
 * 	offset: (props) => props.center,
 * });
 *
 * const node = circle.create({ radius: 2, fill: "tomato" });
 * scene.root.add(node);
 * node.set("radius", 3); // reruns the outline; `center` would only move it
 * ```
 *
 * The rules that keep a primitive fast:
 *
 * 1. **Every prop has a descriptor entry, and its `invalidates` names the
 *    cheapest stage that is right.** An outline input is `Invalidate.GEOMETRY`; a
 *    position read by `offset` is `Invalidate.TRANSFORM`; paints are
 *    `Invalidate.STYLE`; `progress`/`zIndex`/`visible` are `Invalidate.SPEC`. The
 *    shared `shapeProps` already has entries for every common prop.
 * 2. **Build the outline about the origin and hand the position over as
 *    `offset`.** Then moving the shape changes a matrix and the outline
 *    arrays keep their identity (the renderer's `Path2D` and arc-length
 *    caches key on it).
 * 3. **`geometry` is a pure function of the props it reads,** and returns
 *    fresh arrays only when they changed (it only runs when a `GEOMETRY`
 *    prop was written). It may return a `Promise`: the shape is absent from
 *    the frame until it resolves.
 * 4. **Real maths lives in `geometry/` and friends.** A primitive is a
 *    descriptor plus a few lines calling them.
 * 5. **Mark per-item numeric or colour props `instanceable`** so `instances()`
 *    can drive them as channels.
 *
 * A primitive that is not a shape (a group, a marks layer, an image, text)
 * subclasses `BaseNode` or `BaseContainer` (`scene/node.ts`,
 * `scene/container.ts`), implements `run(dirty)` (rerun the stages whose
 * bits are set; call `publish(spec)` with the result, keeping identity when
 * nothing changed) and `stagesForSpace`/`stagesForContext`, and passes a
 * `create` to {@link definePrimitive}. A subtree built from other nodes is
 * a composite (`defineComposite`, `scene/composite.ts`), not a primitive.
 */

import type { BaseNode } from "./node.js";
import type {
	CreateArguments,
	CreateProps,
	DeclaredInstanceable,
	Definition,
	PropsDescriptor,
} from "./types.js";

/**
 * Options for {@link definePrimitive}.
 *
 * @category Scene graph
 */
export interface PrimitiveOptions<
	P extends object,
	N extends BaseNode<P>,
	I extends keyof P = never,
> {
	/** PascalCase display and codegen name (`"Circle"`). */
	name: string;
	/** One entry per prop of `P` (every key of `I` marked `instanceable: true`). */
	props: PropsDescriptor<P, I>;
	/**
	 * Whether the nodes take children.
	 * @default false
	 */
	container?: boolean;
	/** Constructs a bare node for `definition` (props are written afterwards). */
	node: (definition: Definition<P, N>) => N;
}

/**
 * Makes a primitive definition from a descriptor and a node constructor.
 * `create(props)` constructs the node and writes the props (a `Readable`
 * binds).
 *
 * @example
 * ```ts
 * import { definePrimitive, Invalidate } from "@sophistry/core";
 * import { BaseNode } from "@sophistry/core/internal";
 *
 * interface MarkerProps {
 * 	size?: number;
 * }
 *
 * class MarkerNode extends BaseNode<MarkerProps> {
 * 	// A drawable builds its spec from `this.props` here and publishes it.
 * 	protected run(): void {
 * 		this.publish(null);
 * 	}
 * }
 *
 * export const marker = definePrimitive<MarkerProps, MarkerNode>({
 * 	name: "Marker",
 * 	props: { size: { default: 1, invalidates: Invalidate.GEOMETRY } },
 * 	node: (definition) => new MarkerNode(definition),
 * });
 * ```
 *
 * @param options - See {@link PrimitiveOptions}.
 * @returns The definition. `I` (optional) declares the props `instances()`
 *   may drive per item; see {@link Definition}.
 * @category Scene graph
 */
export function definePrimitive<
	P extends object,
	N extends BaseNode<P>,
	I extends keyof P = never,
>(
	options: PrimitiveOptions<P, N, I>,
): Definition<P, N, DeclaredInstanceable<P, I>> {
	const definition: Definition<P, N, DeclaredInstanceable<P, I>> = {
		kind: "primitive",
		name: options.name,
		descriptor: options.props,
		container: options.container ?? false,
		create: (...args: CreateArguments<P>) =>
			options.node(definition).init(args[0] as CreateProps<P> | undefined),
	};
	return Object.freeze(definition);
}
