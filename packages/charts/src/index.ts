/**
 * `@sophistry/charts`: charts built on instanced primitives, scales and
 * keyed joins. A `chart` fits its axes to the layers inside it; per-datum
 * marks draw as one instances node, marks with distinct outlines as one path
 * batch, rasters as images.
 *
 * @module @sophistry/charts
 * @packageDocumentation
 */

// Families (each owns its barrel).
export * from "./bars/index";
export type {
	BatchedMark,
	BatchedMarkOptions,
	BatchItem,
	MarkTransition,
} from "./batch";
export { createBatchedMark } from "./batch";
export { chart, chartHandle } from "./chart";
export type { ChartLayer } from "./context";
export { chartContext, chartLayer, chartLayersContext } from "./context";
export * from "./curves/index";
export * from "./data/channels";
export type * from "./frame/types";
export * from "./grids/index";
export * from "./guides/index";
export * from "./hierarchy/index";
export * from "./math/index";
export * from "./multiview/index";
export * from "./points/index";
export type {
	AnyDatum,
	BarReveal,
	CurveReveal,
	DensityReveal,
	KeyedTransitionProps,
	LayersReveal,
	RadialReveal,
	RevealProps,
	SeriesTransitionProps,
	StackReveal,
	StaggerOrder,
	TransitionProps,
} from "./props";
export * from "./radial/index";
export * from "./statistics/index";
export type {
	ActiveTooltip,
	TooltipAnchor,
	TooltipConfig,
	TooltipContent,
	TooltipField,
	TooltipFormat,
	TooltipOptions,
	TooltipPoint,
	TooltipRow,
	TooltipSpec,
	TooltipState,
} from "./tooltip";
export { createTooltipState, tooltipContext, tooltipLabel } from "./tooltip";
