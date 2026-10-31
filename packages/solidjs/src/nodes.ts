/**
 * Helpers shared by `wrap` and `<Stage>`: picking the scene nodes out of
 * resolved Solid children, comparing node lists, and dev warnings issued once.
 */

import { isDev } from "@solidjs/web";
import type { SceneNode } from "@sophistry/core";
import { BaseNode } from "@sophistry/core/internal";

/** The empty node list, shared so "no children" keeps one identity. */
export const NO_NODES: readonly SceneNode[] = Object.freeze([]);

const warned = new Set<string>();

/**
 * `console.warn(message)` once per `key` for the page's lifetime, in
 * development only.
 *
 * @internal
 */
export function warnOnce(key: string, message: string): void {
	if (!isDev || warned.has(key)) return;
	warned.add(key);
	console.warn(`[@sophistry/solidjs] ${message}`);
}

/**
 * The scene nodes among resolved (flattened) Solid children, in order.
 * Anything else (a string, a DOM node) is dropped with a dev warning once per
 * parent kind; `null`, `undefined` and booleans are dropped silently (what
 * `<Show>` renders while hidden).
 *
 * @param resolved - `children(...).toArray()`.
 * @param parent - The parent's name, for the warning.
 * @internal
 */
export function childNodes(
	resolved: readonly unknown[],
	parent: string,
): readonly SceneNode[] {
	if (resolved.length === 0) return NO_NODES;
	const nodes: SceneNode[] = [];
	for (const child of resolved) {
		if (child instanceof BaseNode) nodes.push(child);
		else if (
			child !== null &&
			child !== undefined &&
			typeof child !== "boolean"
		) {
			warnOnce(
				`${parent}:non-node`,
				`<${parent}> ignores children that are not scene nodes (got ${typeof child === "string" ? `"${child}"` : String(child)}). Put text in a <Label>, DOM outside the <Stage>.`,
			);
		}
	}
	return nodes;
}

/**
 * Whether two node lists hold the same nodes in the same order.
 *
 * @internal
 */
export function sameNodes(
	a: readonly SceneNode[],
	b: readonly SceneNode[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
