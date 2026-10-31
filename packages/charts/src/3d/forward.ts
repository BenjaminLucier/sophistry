/**
 * Prop forwarding for the 3D charts: a chart takes its drawn primitive's
 * props (paints, reveal, interaction, `zIndex`, `light`, `worldWidth`, ...)
 * and hands them to every node it draws.
 *
 * Unlike core's composite shapes, which bind one child to each forwarded
 * prop, a chart may draw thousands of children: binding every forwarded key
 * on each would cost a subscription per key per child. Instead the
 * forwarded props rerun the chart's `update`, which writes only the keys
 * that changed to the children it already has; a new child gets every
 * forwarded prop that is set. An unset prop stays unset on the child (an
 * unset `zIndex` must not become `0` and take the child out of the camera's
 * depth sort), exactly as a Solid spread passed `undefined` on.
 *
 * Internal: not in the barrel.
 */

import type {
	Changes,
	PropDescriptor,
	PropsDescriptor,
	SceneNode,
} from "@sophistry/core";
import { Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";

type AnyDescriptor = Record<string, PropDescriptor<unknown>>;
type AnyNode = SceneNode<Record<string, unknown>>;

/**
 * A chart's descriptor entries for the props it forwards to its drawn
 * nodes: every one reruns `update` (which writes it to the children).
 * Defaults are kept for docs and bindings; `instanceable` is dropped.
 *
 * @param descriptor - The drawn primitive's descriptor (`prism3D.descriptor`).
 * @param omit - Keys the chart sets itself (positions, colour).
 * @returns The entries, to spread into the chart's descriptor.
 */
export function forwardedEntries<P, const O extends keyof P = never>(
	descriptor: PropsDescriptor<P>,
	omit: readonly O[] = [],
): PropsDescriptor<Omit<P, O>> {
	const out: AnyDescriptor = {};
	for (const [key, entry] of Object.entries(
		descriptor as unknown as AnyDescriptor,
	)) {
		if ((omit as readonly string[]).includes(key)) continue;
		out[key] =
			entry.kind === "event"
				? { kind: "event", invalidates: Invalidate.UPDATE }
				: entry.default === undefined
					? { invalidates: Invalidate.UPDATE }
					: { default: entry.default, invalidates: Invalidate.UPDATE };
	}
	return Object.freeze(out) as unknown as PropsDescriptor<Omit<P, O>>;
}

/**
 * Writes every forwarded prop that is set to a new child, skipping keys the
 * child's definition does not have (a stem's marker takes no `worldWidth`).
 *
 * @param props - The chart's props.
 * @param child - The node just made.
 * @param keys - The forwarded keys.
 */
export function forwardAll<P>(
	props: Readonly<P>,
	child: SceneNode,
	keys: readonly (keyof P)[],
): void {
	const target = child as AnyNode;
	const accepted = child.definition.descriptor as unknown as AnyDescriptor;
	for (const key of keys) {
		const value = props[key];
		if (value === undefined || !accepted[key as string]) continue;
		target.set(key as string, value);
	}
}

/**
 * Writes the forwarded props among `changed` (set or unset) to each child
 * that has them.
 *
 * @param changed - What changed since the last `update`.
 * @param props - The chart's props.
 * @param children - The chart's drawn nodes.
 * @param keys - The forwarded keys, as a set.
 */
export function forwardChanged<P>(
	changed: Changes<P>,
	props: Readonly<P>,
	children: readonly SceneNode[],
	keys: ReadonlySet<keyof P>,
): void {
	for (const key of changed) {
		if (typeof key !== "string" || !keys.has(key as keyof P)) continue;
		const value = props[key as keyof P];
		for (const child of children) {
			const accepted = child.definition.descriptor as unknown as AnyDescriptor;
			if (accepted[key]) (child as AnyNode).set(key, value);
		}
	}
}

/**
 * Whether `changed` holds anything besides forwarded props: a data channel,
 * the data itself, or a context key the chart read (the theme).
 *
 * @param changed - What changed since the last `update`.
 * @param keys - The forwarded keys, as a set.
 */
export function dataChanged<P>(
	changed: Changes<P>,
	keys: ReadonlySet<keyof P>,
): boolean {
	for (const key of changed) {
		if (typeof key !== "string" || !keys.has(key as keyof P)) return true;
	}
	return false;
}

/**
 * Sets a point prop only when its coordinates changed: a fresh object with
 * the same coordinates would otherwise rebuild the child's world geometry.
 *
 * @param node - The child.
 * @param key - The point prop (`center`, `from`, `to`).
 * @param point - The new value.
 */
export function setPoint3(node: SceneNode, key: string, point: Point3): void {
	const target = node as AnyNode;
	const current = target.get(key) as Point3 | undefined;
	if (
		current &&
		current.x === point.x &&
		current.y === point.y &&
		current.z === point.z
	)
		return;
	target.set(key, point);
}
