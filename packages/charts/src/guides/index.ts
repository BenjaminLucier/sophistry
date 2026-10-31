/** Family barrel: guides. Owned by its family; re-exported from the package entry. */

// The frame's own definitions that are public but live with `chart`.
export type {
	SecondaryXProps,
	SecondaryYProps,
} from "../frame/secondary-axes";
export { secondaryX, secondaryY } from "../frame/secondary-axes";
export type { TooltipOverlayProps } from "../frame/tooltip-overlay";
export { layoutTooltip, tooltipOverlay } from "../frame/tooltip-overlay";
export type { ColorbarProps } from "./colorbar";
export { colorbar } from "./colorbar";
export type { LegendEntry, LegendProps, LegendTransition } from "./legend";
export { legend } from "./legend";
export type { SizeLegendProps, SizeLegendTransition } from "./size-legend";
export { sizeLegend } from "./size-legend";
