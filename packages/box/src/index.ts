/**
 * `@sophistry/box`: boxes laid out with flexbox, painted with backgrounds
 * and rounded borders, holding text and any scene node, drawn on the canvas
 * with the rest of a Sophistry scene.
 */

export type { BoxProps, LayoutRect } from "./box.js";
export { BoxNode, box } from "./box.js";
export type {
	BoxDimension,
	BoxLength,
	BoxSpacing,
	BoxStyle,
} from "./style.js";
export type { LayoutChange } from "./transition.js";
export { layoutTo } from "./transition.js";
