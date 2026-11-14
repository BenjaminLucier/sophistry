/**
 * A flexbox and grid layout engine in plain TypeScript. Describe a tree of nodes with
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
	GridAutoFlow,
	GridPlacement,
	JustifyContent,
	JustifyItems,
	JustifySelf,
	LayoutStyle,
	Length,
	Overflow,
	Position,
	Size,
	TrackBreadth,
	TrackList,
	TrackRepeat,
	TrackSize,
} from "./style.js";
