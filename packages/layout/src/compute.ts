/**
 * The entry point and the dispatcher: `computeLayout` builds the working
 * tree, sizes and places the root, and reads the boxes back out.
 * `computeNode` routes each node to its algorithm and caches the sizes
 * measured along the way, so the many probes a flex layout makes cost one
 * computation per distinct question.
 */

import { layoutFlex } from "./flexbox.js";
import type {
	AvailableSpace,
	Entry,
	MeasureFunction,
	SizingInputs,
} from "./node.js";
import {
	applyAspectRatio,
	clamp,
	hideSubtree,
	maybeClamp,
	resolveEdges,
	shrinkSpace,
	zeroBox,
} from "./node.js";
import type { Edges, LayoutStyle, Size } from "./style.js";
import { resolve, resolveStyle } from "./style.js";

/** A node to lay out: a style, and either children or a way to measure its content. */
export interface LayoutNode {
	style?: LayoutStyle;
	children?: readonly LayoutNode[];
	/** Sizes a leaf's content (text, an image). Ignored on a node with children. */
	measure?: MeasureFunction;
}

/** Where one node ended up. `x` and `y` are its border box's offset from its parent's border box. */
export interface LayoutBox {
	x: number;
	y: number;
	width: number;
	height: number;
	margin: Edges<number>;
	padding: Edges<number>;
	border: Edges<number>;
	/** One box per input child, in order; children that are not displayed get a zero box. */
	children: LayoutBox[];
}

function buildEntry(node: LayoutNode): Entry {
	return {
		style: resolveStyle(node.style ?? {}),
		children: (node.children ?? []).map(buildEntry),
		measure: node.measure,
		cache: new Map(),
		box: zeroBox(),
	};
}

function readBox(entry: Entry): LayoutBox {
	return { ...entry.box, children: entry.children.map(readBox) };
}

/**
 * Lays out a tree. The root is sized like an absolutely positioned element:
 * its `width` and `height` when given (percentages resolve against a numeric
 * `available`), otherwise as wide as its content up to `available.width`,
 * and as tall as its content. It sits at its top-left margin.
 *
 * @param root - The tree.
 * @param available - The space the root is laid out in.
 * @returns The root's box, with every descendant's.
 */
export function computeLayout(
	root: LayoutNode,
	available: Size<AvailableSpace>,
): LayoutBox {
	const entry = buildEntry(root);
	const parentSize = {
		width: typeof available.width === "number" ? available.width : undefined,
		height: typeof available.height === "number" ? available.height : undefined,
	};
	if (entry.style.display === "none") {
		hideSubtree(entry);
		return readBox(entry);
	}
	const margin = resolveEdges(entry.style.margin, parentSize.width);
	const size = computeNode(entry, {
		known: { width: undefined, height: undefined },
		parentSize,
		available: {
			width: shrinkSpace(available.width, margin.left + margin.right),
			height: shrinkSpace(available.height, margin.top + margin.bottom),
		},
		perform: true,
	});
	entry.box = {
		...entry.box,
		x: margin.left,
		y: margin.top,
		width: size.width,
		height: size.height,
		margin,
	};
	return readBox(entry);
}

function cacheKey(inputs: SizingInputs): string {
	const { known, available, parentSize, sizing } = inputs;
	return `${known.width}|${known.height}|${available.width}|${available.height}|${parentSize.width}|${parentSize.height}|${sizing}`;
}

/**
 * Sizes one node and, with `inputs.perform`, lays out its subtree. Size-only
 * calls are cached per node for the rest of the layout.
 */
export function computeNode(entry: Entry, inputs: SizingInputs): Size {
	if (entry.style.display === "none") {
		if (inputs.perform) hideSubtree(entry);
		return { width: 0, height: 0 };
	}
	if (inputs.perform) return run(entry, inputs);
	const key = cacheKey(inputs);
	const cached = entry.cache.get(key);
	if (cached) return cached;
	const size = run(entry, inputs);
	entry.cache.set(key, size);
	return size;
}

function run(entry: Entry, inputs: SizingInputs): Size {
	if (entry.children.length === 0) return layoutLeaf(entry, inputs);
	return layoutFlex(entry, inputs, computeNode);
}

/** A node without children: its style's size, else its measured content plus padding and border. */
function layoutLeaf(entry: Entry, inputs: SizingInputs): Size {
	const style = entry.style;
	const { known, parentSize, available } = inputs;
	const content = inputs.sizing === "content";
	const padding = resolveEdges(style.padding, parentSize.width);
	const border = resolveEdges(style.border, parentSize.width);
	const insetW = padding.left + padding.right + border.left + border.right;
	const insetH = padding.top + padding.bottom + border.top + border.bottom;
	const own = (
		value: Parameters<typeof resolve>[0],
		basis: number | undefined,
	) => (content ? undefined : resolve(value, basis));
	const min = {
		width: own(style.minSize.width, parentSize.width),
		height: own(style.minSize.height, parentSize.height),
	};
	const max = {
		width: own(style.maxSize.width, parentSize.width),
		height: own(style.maxSize.height, parentSize.height),
	};
	const styled = applyAspectRatio(
		{
			width:
				known.width ??
				maybeClamp(
					own(style.size.width, parentSize.width),
					min.width,
					max.width,
				),
			height:
				known.height ??
				maybeClamp(
					own(style.size.height, parentSize.height),
					min.height,
					max.height,
				),
		},
		content ? undefined : style.aspectRatio,
	);

	let width = styled.width;
	let height = styled.height;
	if (width === undefined || height === undefined) {
		const content = entry.measure
			? entry.measure(
					{
						width:
							width === undefined ? undefined : Math.max(0, width - insetW),
						height:
							height === undefined ? undefined : Math.max(0, height - insetH),
					},
					{
						width: shrinkSpace(
							max.width === undefined || typeof available.width !== "number"
								? available.width
								: Math.min(available.width, max.width),
							insetW,
						),
						height: shrinkSpace(available.height, insetH),
					},
				)
			: { width: 0, height: 0 };
		width ??= clamp(content.width + insetW, min.width, max.width);
		if (height === undefined) {
			const fromRatio =
				content || style.aspectRatio === undefined
					? undefined
					: width / style.aspectRatio;
			height = clamp(
				fromRatio ?? content.height + insetH,
				min.height,
				max.height,
			);
		}
	}

	const size = {
		width: Math.max(width, insetW),
		height: Math.max(height, insetH),
	};
	if (inputs.perform) {
		entry.box = {
			...entry.box,
			width: size.width,
			height: size.height,
			padding,
			border,
		};
	}
	return size;
}
