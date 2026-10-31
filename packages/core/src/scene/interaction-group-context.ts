/**
 * The non-node half of `interactionGroup`: the context key and what it
 * carries.
 *
 * Split out of `interaction-group.ts` (which defines the container node)
 * because `node.ts` reads this key to decide whether a drawable is a group
 * member, and the container module imports `node.ts` through `container.ts`;
 * the key here imports nothing from the scene, so there is no cycle.
 */

import type { InteractionHandlers, PointerEvents } from "../interact/types";
import type { ContextKey } from "./types";

/**
 * What a group's members inherit. Functions, read when the registry or the
 * driver needs them, so the group's props stay live without re-providing.
 *
 * @category Interaction plumbing
 */
export interface InteractionGroupValue {
	/** The group node's id. */
	readonly id: number;
	/** The merged handlers (this group's over its enclosing groups'). */
	handlers(): InteractionHandlers;
	/** The inherited hit mode, or undefined to leave it to each node. */
	pointerEvents(): PointerEvents | undefined;
	/** The inherited CSS cursor, or null. */
	cursor(): string | null;
	/** The accessible name for the group's tab stop, or null. */
	label(): string | null;
	/** The ARIA role for the group's tab stop, or null. */
	role(): string | null;
	/** Explicit tab-stop override for the group, or undefined for the default. */
	focusable(): boolean | undefined;
	/**
	 * The outermost enclosing group (this one when it is not nested). Nested
	 * groups are one gesture and so one tab stop, and it belongs to the
	 * outermost of them; the registry elects its owner per outermost group.
	 */
	root(): InteractionGroupValue;
}

/**
 * The enclosing interaction group, provided by every `interactionGroup` node
 * to its subtree; null outside one (the common case).
 *
 * @category Interaction plumbing
 */
export const interactionGroupContext: ContextKey<InteractionGroupValue | null> =
	Object.freeze({ name: "interactionGroup", defaultValue: null });
