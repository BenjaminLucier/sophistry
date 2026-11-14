/**
 * The tree the algorithms work on: each input node with its style parsed,
 * a sizing cache, and the box its final layout wrote.
 */

import type { Edges, Resolved, ResolvedStyle, Size } from "./style.js";
import { resolve } from "./style.js";

/** What a node may be given along one axis: a length, or an intrinsic size to take. */
export type AvailableSpace = number | "min-content" | "max-content";

/** A size whose dimensions may still be unknown. */
export type MaybeSize = Size<number | undefined>;

/**
 * Sizes a leaf's content. `known` holds the content-box dimensions already
 * decided; `available` is the content-box space to fit in, or the intrinsic
 * size wanted. Returns the content-box size. Text, for example, wraps at
 * `known.width` when given, else at a numeric `available.width` (returning
 * the width it used), and takes its longest word under `"min-content"`.
 */
export type MeasureFunction = (
	known: MaybeSize,
	available: Size<AvailableSpace>,
) => Size;

/** The inputs every sizing call takes. */
export interface SizingInputs {
	/** Border-box dimensions the caller has already decided. */
	known: MaybeSize;
	/** The containing block's content box, for percentages. */
	parentSize: MaybeSize;
	/** Space for the node's border box, or the intrinsic size wanted. */
	available: Size<AvailableSpace>;
	/** Whether to lay out the subtree and record boxes, or only report a size. */
	perform: boolean;
	/**
	 * An axis along which to ignore the node's own size, min and max (not its
	 * descendants'): the size of its content alone, as a flex item's base size
	 * and content-based minimum need. The other axis keeps its constraints.
	 */
	contentAxis?: "width" | "height";
}

/** Sizes (and with `perform`, lays out) one node. */
export type ComputeNode = (node: Entry, inputs: SizingInputs) => Size;

/** Where a node ended up, relative to its parent's border box. */
export interface PlacedBox {
	x: number;
	y: number;
	width: number;
	height: number;
	margin: Edges<number>;
	padding: Edges<number>;
	border: Edges<number>;
}

/** One node of the working tree. */
export interface Entry {
	style: ResolvedStyle;
	children: Entry[];
	measure: MeasureFunction | undefined;
	/** Sizes already computed for these inputs, during this layout only. */
	cache: Map<string, Size>;
	box: PlacedBox;
}

/** All-zero edges. */
export function zeroEdges(): Edges<number> {
	return { top: 0, right: 0, bottom: 0, left: 0 };
}

/** A fresh zero box. */
export function zeroBox(): PlacedBox {
	return {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		margin: zeroEdges(),
		padding: zeroEdges(),
		border: zeroEdges(),
	};
}

/** Every side of `edges` against `basis`; `auto` and unresolvable percentages are 0. */
export function resolveEdges(
	edges: Edges<Resolved>,
	basis: number | undefined,
): Edges<number> {
	return {
		top: resolve(edges.top, basis) ?? 0,
		right: resolve(edges.right, basis) ?? 0,
		bottom: resolve(edges.bottom, basis) ?? 0,
		left: resolve(edges.left, basis) ?? 0,
	};
}

/** Which sides of `edges` are `auto`. */
export function autoEdges(edges: Edges<Resolved>): Edges<boolean> {
	return {
		top: edges.top.kind === "auto",
		right: edges.right.kind === "auto",
		bottom: edges.bottom.kind === "auto",
		left: edges.left.kind === "auto",
	};
}

/** `value` within `[min, max]`; the minimum wins when they conflict, as in CSS. */
export function clamp(
	value: number,
	min: number | undefined,
	max: number | undefined,
): number {
	let result = value;
	if (max !== undefined && result > max) result = max;
	if (min !== undefined && result < min) result = min;
	return result;
}

/** {@link clamp} for a value that may be unknown. */
export function maybeClamp(
	value: number | undefined,
	min: number | undefined,
	max: number | undefined,
): number | undefined {
	return value === undefined ? undefined : clamp(value, min, max);
}

/** A numeric available space less `amount`, never below 0; intrinsic constraints pass through. */
export function shrinkSpace(
	space: AvailableSpace,
	amount: number,
): AvailableSpace {
	return typeof space === "number" ? Math.max(0, space - amount) : space;
}

/** Fills the unknown dimension of `size` from the other through `ratio` (width / height). */
export function applyAspectRatio(
	size: MaybeSize,
	ratio: number | undefined,
): MaybeSize {
	if (ratio === undefined) return size;
	if (size.width !== undefined && size.height === undefined) {
		return { width: size.width, height: size.width / ratio };
	}
	if (size.height !== undefined && size.width === undefined) {
		return { width: size.height * ratio, height: size.height };
	}
	return size;
}

/** Zeroes the boxes of a subtree that is not displayed. */
export function hideSubtree(entry: Entry): void {
	entry.box = zeroBox();
	for (const child of entry.children) hideSubtree(child);
}
