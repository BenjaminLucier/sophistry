/**
 * Boxes: laid out with flexbox or grid by `@sophistry/layout`, painted with
 * backgrounds and rounded borders, holding text and any scene node.
 */

export type { BoxProps, LayoutRect } from "./box.js";
export { BoxNode, box } from "./box.js";
export type {
	BoxDimension,
	BoxLength,
	BoxSpacing,
	BoxStyle,
	BoxTrackBreadth,
	BoxTrackList,
	BoxTrackSize,
} from "./style.js";
export type { LayoutChange } from "./transition.js";
export { layoutTo } from "./transition.js";
