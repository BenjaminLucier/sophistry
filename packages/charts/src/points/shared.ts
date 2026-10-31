/**
 * Plumbing the point marks share: stable tooltip handlers for a batched
 * layer, and a last-value cache for the shared props handed to it. Internal.
 */

import type { Point } from "@sophistry/core/geometry";
import { itemTooltipHandlers } from "../item-tooltip";
import type { TooltipContent, TooltipState } from "../tooltip";
import { shallowEqual } from "../util";

/** The interaction props of a batched layer with tooltips. */
export interface ItemHandlerProps {
	label?: string;
	onEnter?: (event: never) => void;
	onLeave?: (event: never) => void;
	onTap?: (event: never) => void;
	itemLabel?: (item: number) => string | undefined;
}

/**
 * A batched layer's tooltip handlers, made once so their identities hold
 * across updates (the layer's shared props then compare equal and the node
 * restyles nothing). Call once, in `setup`.
 *
 * @param tooltip - The chart's tooltip state, or null outside a chart.
 * @param textOf - Item `event.item`'s tooltip, or undefined for none.
 * @param atOf - Where item `event.item`'s tooltip points, in scene units.
 * @returns `(enabled, label)`: the props to spread into the layer's shared
 *   props, empty when `enabled` is false or there is no tooltip.
 */
export function createItemHandlers(
	tooltip: TooltipState | null,
	textOf: (item: number) => TooltipContent | undefined,
	atOf: (item: number) => Point | undefined,
): (enabled: boolean, label: string) => ItemHandlerProps {
	if (!tooltip) return () => ({});
	const handlers = itemTooltipHandlers(tooltip, textOf, atOf, () => undefined);
	const fixed = {
		onEnter: handlers.onEnter,
		onLeave: handlers.onLeave,
		onTap: handlers.onTap,
		itemLabel: handlers.itemLabel,
	} as ItemHandlerProps;
	return (enabled, label) => (enabled ? { ...fixed, label } : {});
}

/** Whether a mark with this `tooltip` prop shows tooltips in this chart. */
export function tooltipsOn(
	tooltip: TooltipState | null,
	own: unknown,
): boolean {
	if (!tooltip) return false;
	const config = tooltip.config();
	if (config === false) return false;
	return own !== undefined || config !== undefined;
}

/**
 * A last-value cache for a batched layer's shared props: hands back the
 * previous object while the next one is shallowly equal, so the node sees
 * no change.
 */
export function stableShared<P extends object>(): (next: P) => P {
	let last: P | undefined;
	return (next) => {
		if (last && shallowEqual(last, next)) return last;
		last = next;
		return next;
	};
}
