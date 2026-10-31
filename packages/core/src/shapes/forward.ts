/**
 * Prop forwarding for the composite shapes (a labelled dot, a brace with its
 * label, a traced path): the composite takes a shape's props and hands them
 * to the shape node it owns.
 *
 * Values are bound, so the child follows a write (or a bound source) with no
 * `update` at all; handlers, which cannot be bound, are set again in
 * `update`. The bound view reads the prop *as set*, never its descriptor
 * default, so an unset prop stays unset on the child (an unset
 * `pointerEvents` must not make the child interactive, an unset `zIndex`
 * must not become `0`).
 *
 * Internal: not in the barrel.
 */

import type { Readable } from "../reactive";
import type { CompositeContext } from "../scene/composite";
import { Invalidate } from "../scene/context";
import type {
	PropDescriptor,
	PropsDescriptor,
	SceneNode,
} from "../scene/types";

type AnyDescriptor = Record<string, PropDescriptor<unknown>>;

/**
 * A composite's descriptor entries for props it forwards to a child: values
 * invalidate nothing on the composite (the child is bound to them), handlers
 * rerun `update` (which sets them on the child). Defaults are kept for docs
 * and bindings; `instanceable` is dropped (composites are not instanced).
 *
 * @param descriptor - The child's descriptor entries (`shapeProps`, say).
 * @param omit - Keys the composite does not forward.
 * @returns The entries, to spread into the composite's descriptor.
 */
export function forwardedProps<P, const O extends keyof P = never>(
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
					? { invalidates: Invalidate.NONE }
					: { default: entry.default, invalidates: Invalidate.NONE };
	}
	return Object.freeze(out) as unknown as PropsDescriptor<Omit<P, O>>;
}

/**
 * A `Readable` of one of a composite's props *as set*: `undefined` while
 * unset, where `ctx.prop(key)` would report the descriptor default.
 *
 * @param ctx - The composite's context.
 * @param key - The prop.
 * @returns A view children can be bound to.
 */
export function rawProp<P, K extends keyof P>(
	ctx: CompositeContext<P>,
	key: K,
): Readable<P[K]> {
	const view = ctx.node.readable(key);
	return {
		peek: () => ctx.props[key],
		subscribe: (onStale) => view.subscribe(onStale),
	};
}

/**
 * Binds each of `keys` on `child` to the composite's prop of the same name
 * (values) or sets it once (handlers; see {@link forwardHandlers}).
 *
 * @param ctx - The composite's context.
 * @param child - The node receiving the props.
 * @param keys - The forwarded keys, usually `Object.keys(forwardedProps(...))`.
 */
export function forwardProps<P>(
	ctx: CompositeContext<P>,
	child: SceneNode,
	keys: readonly (keyof P)[],
): void {
	const descriptor = ctx.node.definition.descriptor as unknown as AnyDescriptor;
	const target = child as SceneNode<Record<PropertyKey, unknown>>;
	for (const key of keys) {
		if (descriptor[key as string]?.kind === "event") {
			const handler = ctx.props[key];
			if (handler !== undefined) target.set(key as string, handler);
		} else {
			target.set(key as string, rawProp(ctx, key) as Readable<unknown>);
		}
	}
}

/**
 * Sets the handlers among `changed` on `child`: call from `update`.
 *
 * @param changed - What changed since the last `update`.
 * @param ctx - The composite's context.
 * @param child - The node receiving the handlers.
 */
export function forwardHandlers<P>(
	changed: ReadonlySet<unknown>,
	ctx: CompositeContext<P>,
	child: SceneNode,
): void {
	const descriptor = ctx.node.definition.descriptor as unknown as AnyDescriptor;
	const target = child as SceneNode<Record<PropertyKey, unknown>>;
	const childDescriptor = child.definition
		.descriptor as unknown as AnyDescriptor;
	for (const key of changed) {
		if (typeof key !== "string") continue;
		if (descriptor[key]?.kind !== "event" || !childDescriptor[key]) continue;
		target.set(key, ctx.props[key as keyof P]);
	}
}
