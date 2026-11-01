/**
 * What the grid presets (`pairPlot`, `jointPlot`) share: a panel is a
 * `chart` inside a plain `group` that provides its group scope. Internal.
 */

import type {
	CompositeContext,
	ContainerNode,
	SceneNode,
} from "@sophistry/core";
import { group as groupNode } from "@sophistry/core";
import { chart } from "../chart.js";
import type { SideRoom } from "../math/facet.js";
import type { ChartGroup, ChartGroupScope } from "./chart-group.js";
import { chartGroupContext } from "./chart-group.js";

/** A panel's nodes: the wrapper providing its scope, and its chart. */
export interface PanelNodes {
	wrapper: ContainerNode;
	plot: SceneNode;
}

/** Makes a panel: a chart with `children`, inside a group providing `scope`. */
export function makePanel(
	scope: ChartGroupScope,
	children: readonly SceneNode[],
): PanelNodes {
	const plot = chart.create({ width: 1, height: 1, children });
	const wrapper = groupNode.create({}) as unknown as ContainerNode;
	wrapper.provide(chartGroupContext, scope);
	wrapper.setChildren([plot]);
	return { wrapper, plot };
}

/**
 * The room kept free around a preset's grid of plots, inside its
 * footprint, by `autosize`: none (`"pad"`), the right-hand guides
 * (`"fit"`), or every side (`"contain"`).
 */
export function outerRoom(
	autosize: "fit" | "pad" | "contain" | undefined,
	panels: SideRoom,
	own: SideRoom,
	contained: SideRoom = {
		left: panels.left + own.left,
		right: panels.right + own.right,
		top: panels.top + own.top,
		bottom: panels.bottom + own.bottom,
	},
): SideRoom {
	if (autosize === "pad") return { left: 0, right: 0, top: 0, bottom: 0 };
	if (autosize !== "contain")
		return { left: 0, right: panels.right + own.right, top: 0, bottom: 0 };
	return contained;
}

/** Watches a preset's group: reruns its update when a panel published something new. */
export function watchGroup<P>(
	ctx: CompositeContext<P>,
	group: ChartGroup,
	reason: Parameters<CompositeContext<P>["invalidate"]>[0],
): void {
	ctx.onDispose(group.watch(() => ctx.invalidate(reason)));
}
