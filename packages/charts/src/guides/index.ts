/** Family barrel: guides. Owned by its family; re-exported from the package entry. */

// The frame's own definitions that are public but live with `chart`.
export type {
	SecondaryXProps,
	SecondaryYProps,
} from "../frame/secondary-axes.js";
export { secondaryX, secondaryY } from "../frame/secondary-axes.js";
export type { TooltipOverlayProps } from "../frame/tooltip-overlay.js";
export { layoutTooltip, tooltipOverlay } from "../frame/tooltip-overlay.js";
export type { ColorbarProps } from "./colorbar.js";
export { colorbar } from "./colorbar.js";
export type { LegendEntry, LegendProps, LegendTransition } from "./legend.js";
export { legend } from "./legend.js";
export type { SizeLegendProps, SizeLegendTransition } from "./size-legend.js";
export { sizeLegend } from "./size-legend.js";
