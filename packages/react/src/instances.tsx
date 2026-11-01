/**
 * `<Instances>`: core's `instances()` as a JSX child of a `<Stage>`.
 */

import type {
	Definition,
	InstancesNode,
	InstancesOptions,
	SceneNode,
} from "@sophistry/core";
import { instancesDefinition } from "@sophistry/core/internal";
import { createElement, type ReactNode, type Ref } from "react";
import { wrap } from "./wrap.js";

const InstancesHost = wrap(instancesDefinition) as unknown as string;

/**
 * Props for {@link Instances}: core's `InstancesOptions` (`data`, `channels`,
 * `shared`, `transition`), with the identity function named `itemKey`
 * (React reserves `key`), plus the shape `definition` it draws.
 *
 * @category Instancing
 */
export interface InstancesProps<
	T,
	P extends object,
	N extends SceneNode<P>,
	I extends keyof P,
	K = T,
> extends Omit<InstancesOptions<T, P, I, K>, "key"> {
	/** The shape every item is an instance of (`circle`, `rect`, ...). */
	definition: Definition<P, N, I>;
	/** Identity across data changes. @default the item itself */
	itemKey?: (item: T, index: number) => K;
	/** The node (`animateItem`, `promote`, `onItem`, ...). */
	ref?: Ref<InstancesNode<T, P, N, I, K>>;
}

/**
 * Thousands of items drawn as one node (core's `instances()`) in JSX order
 * with its siblings. `data`, `channels`, `shared` and `transition` update the
 * node like any prop; a `Readable` for `data` follows with no React work.
 * `definition` is read at mount (change the element's `key` to swap shapes).
 *
 * To render a node you built yourself, call `instances()` and add it with
 * `scene.add(...)` from `<Stage ref>`.
 *
 * @example
 * ```tsx
 * import { circle } from "@sophistry/core";
 * import { Instances, Stage } from "@sophistry/react";
 *
 * const ids = Array.from({ length: 1000 }, (_, id) => id);
 *
 * export const Figure = () => (
 * 	<Stage>
 * 		<Instances
 * 			definition={circle}
 * 			data={ids}
 * 			channels={{ center: (id) => ({ x: (id % 40) / 2 - 10, y: Math.floor(id / 40) / 2 - 6 }) }}
 * 			shared={{ radius: 0.2 }}
 * 		/>
 * 	</Stage>
 * );
 * ```
 *
 * @param props - See {@link InstancesProps}.
 * @returns A host element for the node.
 * @category Instancing
 */
export function Instances<
	T,
	P extends object,
	N extends SceneNode<P>,
	I extends keyof P,
	K = T,
>(props: InstancesProps<T, P, N, I, K>): ReactNode {
	const { definition, ...rest } = props;
	return createElement(InstancesHost, { itemDefinition: definition, ...rest });
}
