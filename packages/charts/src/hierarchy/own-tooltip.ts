/**
 * The tooltip a standalone hierarchy, flow or mosaic chart shows through:
 * the enclosing chart's, else its own. Internal to the family.
 *
 * Outside a chart the state is kept (handlers, accessible names, the item
 * walked by the keys) but no panel is drawn yet: the overlay is the chart
 * frame's (`frame/tooltip-overlay.ts`).
 */

import type { CompositeContext } from "@sophistry/core";
import type { TooltipState } from "../tooltip";
import { createTooltipState, tooltipContext } from "../tooltip";

/** Call once, in `setup`; read the result in each `update`. */
export function createOwnTooltip(): <P>(
	ctx: CompositeContext<P>,
) => TooltipState {
	let own: TooltipState | undefined;
	return (ctx) => {
		const chart = ctx.context(tooltipContext);
		if (chart) return chart;
		own ??= createTooltipState();
		return own;
	};
}
