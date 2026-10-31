/**
 * Small helpers the guides share for keeping child nodes across updates.
 * A guide keeps its nodes for as long as what they stand for exists, hiding
 * one with `visible: false` (no spec) when it is not shown, and writes only the props whose values changed. Internal to the
 * guides.
 */

import type { SceneNode } from "@sophistry/core";
import { deepEqual } from "../util";

/**
 * Writes the props of `next` that differ by value from `node`'s current
 * ones (points and point lists compared by structure), so a guide's update
 * re-bakes only the children it moved.
 */
export function write<P extends object>(
	node: SceneNode<P>,
	next: Partial<P>,
): void {
	for (const key of Object.keys(next) as (keyof P)[]) {
		const value = next[key] as P[keyof P];
		if (deepEqual(node.get(key), value)) continue;
		node.set(key, value);
	}
}
