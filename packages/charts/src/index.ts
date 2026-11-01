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
export * from "./bars/index.js";
export type {
	BatchedMark,
	BatchedMarkOptions,
	BatchItem,
	MarkTransition,
} from "./batch.js";
export { createBatchedMark } from "./batch.js";
export { chart, chartHandle } from "./chart.js";
export type { ChartLayer } from "./context.js";
export { chartContext, chartLayer, chartLayersContext } from "./context.js";
export * from "./curves/index.js";
export * from "./data/channels.js";
export type * from "./frame/types.js";
export * from "./grids/index.js";
export * from "./guides/index.js";
export * from "./hierarchy/index.js";
export * from "./math/index.js";
export * from "./multiview/index.js";
export * from "./points/index.js";
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
} from "./props.js";
export * from "./radial/index.js";
export * from "./statistics/index.js";
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
} from "./tooltip.js";
export { createTooltipState, tooltipContext, tooltipLabel } from "./tooltip.js";
