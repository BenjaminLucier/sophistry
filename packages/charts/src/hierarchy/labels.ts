/**
 * Node names of the hierarchy, flow and mosaic charts: one `label` node per
 * name drawn, keyed by its node (so a name moving through a transition
 * keeps its node), and a text-width cache so fitting names on every frame
 * of a reveal or zoom measures each string once. Internal to the family.
 */

import type { CompositeContext, LabelProps, SceneNode } from "@sophistry/core";
import { label } from "@sophistry/core";
import type { Theme } from "@sophistry/core/themes";
import { textWidth } from "../text-width.js";

/** One label of a keyed list: its key and the label's props. */
export interface KeyedLabel {
	key: unknown;
	props: LabelProps;
}

/**
 * Keyed `label` nodes for one list (`slot`): a node per key, created once
 * and updated in place, disposed when its key leaves.
 */
export function labelList<P>(
	ctx: CompositeContext<P>,
	slot: string,
	labels: readonly KeyedLabel[],
): SceneNode[] {
	return ctx.list(slot, labels, {
		key: (entry) => entry.key,
		create: (entry) => label.create(entry.props),
		update: (node, entry) => {
			node.update(entry.props);
		},
	});
}

/** Entries kept before the width cache starts over. */
const CACHE_LIMIT = 4096;

/**
 * A text-width cache for one chart: `(text, fontSize, theme, weight?)` is
 * `textWidth` at the theme's font, measured once per string and size.
 * Call once, in `setup`.
 */
export function createLabelMeasure(): (
	text: string,
	fontSize: number,
	theme: Theme,
	fontWeight?: number,
) => number {
	let family = "";
	const widths = new Map<string, number>();
	return (text, fontSize, theme, fontWeight) => {
		if (theme.defaults.fontFamily !== family) {
			family = theme.defaults.fontFamily;
			widths.clear();
		}
		const key = `${fontSize}\u0000${fontWeight ?? ""}\u0000${text}`;
		let width = widths.get(key);
		if (width === undefined) {
			if (widths.size >= CACHE_LIMIT) widths.clear();
			width = textWidth(text, fontSize, family, fontWeight);
			widths.set(key, width);
		}
		return width;
	};
}
