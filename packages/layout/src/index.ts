/**
 * A flexbox layout engine in plain TypeScript. Describe a tree of nodes with
 * CSS-like styles, give leaves a way to measure their content, and
 * {@link computeLayout} returns every node's box. No DOM, no dependencies.
 */

export type { LayoutBox, LayoutNode } from "./compute.js";
export { computeLayout } from "./compute.js";
export type { AvailableSpace, MaybeSize, MeasureFunction } from "./node.js";
export type {
	AlignContent,
	AlignItems,
	AlignSelf,
	Dimension,
	Display,
	Edges,
	FlexDirection,
	FlexWrap,
	JustifyContent,
	LayoutStyle,
	Length,
	Overflow,
	Position,
	Size,
} from "./style.js";
