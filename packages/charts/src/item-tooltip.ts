/**
 * Tooltips for a batched layer: one node, one tooltip per item.
 *
 * `tooltipHandlers` serves a node that is one datum. A batched layer (see
 * `instances()` or a path batch) is one node for every datum, and the pointer driver
 * tells it which item it is on through `event.item` — leaving one item and
 * entering the next as the pointer crosses between them. These handlers turn
 * that into the same show/hide calls, with each item's own text and anchor.
 */

import type { ScenePointerEvent } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { TooltipContent, TooltipState } from "./tooltip";
import { tooltipLabel } from "./tooltip";

/**
 * Hover and tap handlers showing item `event.item`'s tooltip.
 *
 * @param tooltip - The chart's tooltip, or undefined for none.
 * @param textOf - An item's tooltip, or undefined for none.
 * @param atOf - Where an item's tooltip points, in scene units.
 * Spread the result into the batched node's `shared` props (instances) or
 * props (path batch); handlers receive `event.item`.
 *
 * @param label - The layer's accessible name: a batched layer is one tab stop,
 *   whose items the arrow keys walk (see `InteractionHandlers.itemLabel`).
 *
 * @internal
 */
export function itemTooltipHandlers(
	tooltip: TooltipState | null | undefined,
	textOf: (item: number) => TooltipContent | undefined,
	atOf: (item: number) => Point | undefined,
	label: () => string | undefined,
): {
	readonly label?: string;
	readonly onEnter?: (event: ScenePointerEvent) => void;
	readonly onLeave?: (event: ScenePointerEvent) => void;
	readonly onTap?: (event: ScenePointerEvent) => void;
	readonly itemLabel?: (item: number) => string | undefined;
} {
	const owner = {};
	const open = (item: number | null | undefined, follow: boolean): boolean => {
		if (!tooltip || item === null || item === undefined) return false;
		const text = textOf(item);
		const at = atOf(item);
		if (text === undefined || !at) return false;
		tooltip.show(owner, text, at, follow);
		return true;
	};
	return {
		get label() {
			return tooltip ? label() : undefined;
		},
		get onEnter() {
			return tooltip
				? (event: ScenePointerEvent) => {
						const mouse =
							event.pointerId >= 0 && event.native?.pointerType !== "touch";
						open(event.item, mouse);
					}
				: undefined;
		},
		// Each item's tooltip, read out as the keys walk the layer.
		get itemLabel() {
			return tooltip
				? (item: number) => {
						const text = textOf(item);
						return text === undefined ? undefined : tooltipLabel(text);
					}
				: undefined;
		},
		get onLeave() {
			return tooltip ? () => tooltip.hide(owner) : undefined;
		},
		get onTap() {
			return tooltip
				? (event: ScenePointerEvent) => {
						const active = tooltip.active.peek();
						if (active?.owner === owner && event.item === undefined) {
							tooltip.hide(owner);
							return;
						}
						if (!open(event.item, false)) tooltip.hide(owner);
					}
				: undefined;
		},
	};
}
