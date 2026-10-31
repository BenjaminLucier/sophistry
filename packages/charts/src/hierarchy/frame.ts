/**
 * The steps every zoomable hierarchy chart (`treemap`, `icicle`, `sunburst`,
 * `circlePack`, `tree`) takes on an update before drawing: lay out (both
 * ends of a keyed transition, joined at `blend`), key, colour, resolve the
 * drill-down and the zoom window, close a tooltip the view moved away from.
 * Each step is cached on its inputs (see `shared.ts`), so a `progress` frame
 * re-lays out nothing and a zoom scrub only moves the window.
 *
 * Internal to the family.
 */

import type { CompositeContext, SceneNode } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { Theme } from "@sophistry/core/themes";
import type { HierarchyNodeInfo } from "../math/hierarchy";
import type { TooltipState } from "../tooltip";
import type { ChartBreadcrumbsFrame } from "./breadcrumbs";
import { createChartBreadcrumbs } from "./breadcrumbs";
import type {
	HierarchyDrill,
	HierarchyDrillProps,
	NodeInteractionProps,
	NodeInteractionState,
} from "./drill";
import { createHierarchyDrill, createNodeInteraction } from "./drill";
import { createOwnTooltip } from "./own-tooltip";
import type {
	HierarchyChartBaseProps,
	HierarchyEnds,
	HierarchyFocusSpec,
	HierarchyTransitionProps,
	HierarchyView,
	HierarchyZoom,
	Joined,
} from "./shared";
import {
	createHierarchyFills,
	createHierarchyKeys,
	createHierarchyLayout,
	createHierarchyZoom,
	createTooltipCloser,
	lerpView,
} from "./shared";

/** The props the shared steps read. */
export type ZoomableChartProps<T> = HierarchyChartBaseProps<T> &
	HierarchyTransitionProps<T> &
	HierarchyDrillProps<T> & { focus?: HierarchyFocusSpec<T> };

/** One update's shared state of a hierarchy chart. @internal */
export interface HierarchyChartFrame<T, N extends HierarchyNodeInfo<T>> {
	ends: HierarchyEnds<N>;
	/** The layout drawn: `data`'s, or both ends joined at `blend`. */
	layout: readonly Joined<N>[];
	/** Each node's identity (its path of names): the instance key of its mark. */
	keys: readonly string[];
	/** Each node's fill. */
	fills: readonly string[];
	drill: HierarchyDrill<T>;
	zoom: HierarchyZoom;
	/** The chart's tooltip: the enclosing chart's, else its own. */
	tooltip: TooltipState;
	/** Whether nodes take part in interaction (taps, tooltips, the item list). */
	interactive: boolean;
}

/** How a chart turns its layout into the windows its zoom moves between. */
export interface HierarchyViewOptions<N> {
	/** The window showing the subtree of the node at `position`. */
	viewOf: (layout: readonly Joined<N>[], position: number) => HierarchyView;
	/** How two windows blend. @default linear */
	blend?: (a: HierarchyView, b: HierarchyView, t: number) => HierarchyView;
}

/** A hierarchy chart's shared machinery. See {@link createHierarchyChart}. @internal */
export interface HierarchyChart<T, N extends HierarchyNodeInfo<T>> {
	/** Runs the shared steps for this update. */
	frame(
		props: ZoomableChartProps<T>,
		theme: Theme,
		layoutOf: (data: T, end: "from" | "to") => N[],
		deps: readonly unknown[],
		view: HierarchyViewOptions<N>,
	): HierarchyChartFrame<T, N>;
	/**
	 * The batched node's interaction props for this update, named `name`;
	 * `positionOf` and `atOf` map a batched item to its node and tooltip anchor.
	 */
	interaction(
		name: string,
		positionOf: (item: number) => number | undefined,
		atOf: (item: number) => Point | undefined,
	): NodeInteractionProps;
	/** Taps the node at layout `position`, as a tap on its item does (for a node's name). */
	tapNode(position: number, at: Point): void;
	/** The chart's own trail, or null for none. */
	breadcrumbs(
		frame: Omit<ChartBreadcrumbsFrame<T>, "nodes" | "resolved" | "drill">,
	): SceneNode | null;
}

/**
 * A hierarchy chart's shared machinery: its layout cache, keys, fills,
 * drill-down, zoom, tooltip and trail. Call once, in `setup`.
 *
 * @param fields - The numeric fields that place a node (for the keyed join).
 * @internal
 */
export function createHierarchyChart<
	T,
	N extends HierarchyNodeInfo<T>,
	P extends ZoomableChartProps<T>,
>(
	ctx: CompositeContext<P>,
	fields: readonly (keyof N & string)[],
): HierarchyChart<T, N> {
	const layoutCache = createHierarchyLayout<T, N>(fields);
	const keysOf = createHierarchyKeys<T>();
	const fillsOf = createHierarchyFills<T>();
	const drillOf = createHierarchyDrill<T, P>(ctx);
	const zoomOf = createHierarchyZoom<T>();
	const closeTooltip = createTooltipCloser();
	const trail = createChartBreadcrumbs<T>();
	const tooltipOf = createOwnTooltip();
	let last: HierarchyChartFrame<T, N> | null = null;
	let spec: ZoomableChartProps<T>["tooltip"];
	let positionOf: (item: number) => number | undefined = () => undefined;
	let atOf: (item: number) => Point | undefined = () => undefined;
	const interactionState = (): NodeInteractionState<T> => {
		const frame = last as HierarchyChartFrame<T, N>;
		return {
			tooltip: frame.tooltip,
			spec,
			nodes: frame.layout,
			target: frame.zoom.target,
			resolved: frame.zoom.resolved,
			drill: frame.drill,
			positionOf,
			atOf,
		};
	};
	const interaction = createNodeInteraction<T>(interactionState);
	return {
		frame(props, theme, layoutOf, deps, view) {
			const ends = layoutCache(props, layoutOf, deps);
			const layout = ends.layout;
			const keys = keysOf(layout);
			const fills = fillsOf(
				props,
				theme,
				ends as HierarchyEnds<HierarchyNodeInfo<T>>,
			);
			const drill = drillOf(props, layout);
			const zoom = zoomOf(
				layout,
				drill.focus,
				(position) => view.viewOf(layout, position),
				view.blend ?? lerpView,
			);
			const tooltip = tooltipOf(ctx);
			closeTooltip(tooltip, [zoom.view, layout]);
			spec = props.tooltip;
			last = {
				ends,
				layout,
				keys,
				fills,
				drill,
				zoom,
				tooltip,
				interactive:
					drill.enabled ||
					(props.tooltip !== undefined && props.tooltip !== false),
			};
			return last;
		},
		interaction(name, position, at) {
			positionOf = position;
			atOf = at;
			return interaction.props(name);
		},
		tapNode: (position, at) => interaction.tapNode(position, at),
		breadcrumbs(frame) {
			const current = last as HierarchyChartFrame<T, N>;
			return trail({
				...frame,
				nodes: current.layout,
				resolved: current.zoom.resolved,
				drill: current.drill,
			});
		},
	};
}
