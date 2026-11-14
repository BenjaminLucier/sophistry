/**
 * Layout transitions: an animation that changes boxes' styles and children
 * and moves everything from where it was to where the new layout puts it.
 *
 * It is an ordinary seekable leaf. When it starts it notes where every node
 * in the tree is, applies the changes and lays out once; as it runs, each
 * box's size and each node's position blend from the old place to the new.
 * Nodes are matched by identity, across the whole tree, so a child that
 * moves to another position (or another box in the same tree) travels there.
 * Rewound to its start, the boxes get their old styles and children back.
 */

import type { Animation, LeafTiming, SceneNode } from "@sophistry/core";
import { easedLeaf } from "@sophistry/core";
import type { BaseNode } from "@sophistry/core/internal";
import type { LayoutRect } from "./box.js";
import { BoxNode } from "./box.js";
import type { BoxStyle } from "./style.js";

/**
 * What a layout transition changes on one box.
 *
 * @category Box
 */
export interface LayoutChange {
	/** The new style. Omitted, the style stays. */
	style?: BoxStyle;
	/** The new children, in order. Omitted, the children stay. */
	children?: readonly SceneNode[];
}

interface Captured {
	node: BoxNode;
	change: LayoutChange;
	style: BoxStyle | undefined;
	children: readonly SceneNode[];
}

/**
 * Animates boxes to a new layout: sets each box's new style or children and
 * moves every box, text and scene node in the tree from its old place to its
 * new one, resizing boxes on the way. Reordered children slide past each
 * other; a node that only appears in the new layout is there from the start,
 * and one that is dropped goes at once.
 *
 * Styles change at the start (colours do not blend; text wraps at its new
 * width from the start), and only places blend.
 *
 * @example
 * ```ts
 * import { box, layoutTo } from "@sophistry/box";
 * import { text, timeline } from "@sophistry/core";
 *
 * const a = text.create({ text: "first" });
 * const b = text.create({ text: "second" });
 * const row = box.create({ style: { gap: 24 }, children: [a, b] });
 * const swap = layoutTo(row, { children: [b, a], style: { gap: 48 } }, { duration: 0.8 });
 * timeline(swap).seek(0.4);
 * ```
 *
 * @param target - A box and its change, or several.
 * @param change - With one box: what changes on it.
 * @param options - Duration, delay and easing.
 * @returns The animation.
 *
 * @category Box
 */
export function layoutTo(
	target: BoxNode,
	change: LayoutChange,
	options?: LeafTiming,
): Animation;
export function layoutTo(
	target: readonly (readonly [BoxNode, LayoutChange])[],
	options?: LeafTiming,
): Animation;
export function layoutTo(
	target: BoxNode | readonly (readonly [BoxNode, LayoutChange])[],
	changeOrOptions?: LayoutChange | LeafTiming,
	maybeOptions?: LeafTiming,
): Animation {
	const changes: readonly (readonly [BoxNode, LayoutChange])[] = Array.isArray(
		target,
	)
		? target
		: [[target as BoxNode, (changeOrOptions ?? {}) as LayoutChange]];
	const options = (Array.isArray(target) ? changeOrOptions : maybeOptions) as
		| LeafTiming
		| undefined;

	let captured: Captured[] = [];
	let from = new Map<BaseNode, ReadonlyMap<BaseNode, LayoutRect>>();
	let applied = false;

	/** The outermost box of each changed box, once each. */
	const roots = () => {
		const list: BoxNode[] = [];
		for (const { node } of captured) {
			const root = rootOf(node);
			if (!list.includes(root)) list.push(root);
		}
		return list;
	};

	const apply = () => {
		if (applied) return;
		applied = true;
		for (const { node, change } of captured) {
			if (change.style !== undefined) node.set("style", change.style);
			if (change.children !== undefined) node.setChildren(change.children);
		}
	};

	const revert = () => {
		if (!applied) return;
		applied = false;
		for (const { node, change, style, children } of captured) {
			if (change.style !== undefined) node.set("style", style);
			if (change.children !== undefined) node.setChildren(children);
		}
	};

	return easedLeaf(options ?? {}, {
		begin() {
			applied = false;
			captured = changes.map(([node, change]) => ({
				node,
				change,
				style: node.get("style"),
				children: node.children,
			}));
			from = new Map();
			for (const root of roots()) from.set(root, root.layoutRects());
		},
		apply(eased, raw) {
			if (raw <= 0) {
				revert();
				for (const root of roots()) root.setLayoutBlend(null);
				return;
			}
			apply();
			for (const root of roots()) {
				root.setLayoutBlend(raw >= 1 ? null : (from.get(root) ?? null), eased);
			}
		},
	});
}

/** The outermost box of the tree a box is laid out in. */
function rootOf(node: BoxNode): BoxNode {
	let root = node;
	while (root.parentNode instanceof BoxNode) root = root.parentNode;
	return root;
}
