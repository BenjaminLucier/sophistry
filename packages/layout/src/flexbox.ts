/**
 * Flex layout, following the CSS Flexible Box Layout algorithm (§9): flex
 * base sizes, lines, resolving flexible lengths, cross sizes, stretching,
 * alignment on both axes, then absolutely positioned children.
 *
 * Two choices go beyond the specification's letter and follow what browsers
 * do: a column container settles its width before anything else (block
 * layout decides the inline size first), and an automatic width is
 * fit-content (as wide as the content, up to the space available), while an
 * automatic height is always the content's height.
 *
 * Everything is computed in logical terms (main and cross offsets from the
 * start sides) and turned into physical `x`/`y` only when boxes are written,
 * so the reverse directions are a choice of start side, not a second code path.
 */

import type {
	AvailableSpace,
	ComputeNode,
	Entry,
	MaybeSize,
	SizingInputs,
} from "./node.js";
import {
	applyAspectRatio,
	autoEdges,
	clamp,
	hideSubtree,
	maybeClamp,
	resolveEdges,
	shrinkSpace,
} from "./node.js";
import type {
	AlignContent,
	AlignItems,
	Edges,
	JustifyContent,
	Size,
} from "./style.js";
import { resolve } from "./style.js";

type Side = keyof Edges<number>;

const OPPOSITE: Record<Side, Side> = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left",
};

/** Tolerance for comparing accumulated lengths. */
const EPSILON = 1e-6;

/** One in-flow child, with everything the algorithm works out for it. */
interface Item {
	entry: Entry;
	size: MaybeSize;
	min: MaybeSize;
	max: MaybeSize;
	margin: Edges<number>;
	autoMargin: Edges<boolean>;
	/** Padding plus border, per axis. */
	inset: Size;
	align: AlignItems;
	/** The cross size taken as definite while measuring, when there is one. */
	definiteCross: number | undefined;
	flexBase: number;
	minMain: number;
	maxMain: number | undefined;
	hypotheticalMain: number;
	/** The main size being resolved, then the final one. */
	target: number;
	frozen: boolean;
	violation: number;
	hypotheticalCross: number;
	targetCross: number;
	mainOffset: number;
	crossOffset: number;
}

/** Start offset and extra space between items, for a distribution of `free` over `count` items. */
export function distribute(
	mode: JustifyContent | AlignContent,
	free: number,
	count: number,
): [start: number, between: number] {
	switch (mode) {
		case "flex-end":
			return [free, 0];
		case "center":
			return [free / 2, 0];
		case "space-between":
			return free > 0 && count > 1 ? [0, free / (count - 1)] : [0, 0];
		// The space-* modes fall back to the start when there is no free space
		// to share (their fallback alignment is safe).
		case "space-around":
			return free > 0 ? [free / count / 2, free / count] : [0, 0];
		case "space-evenly":
			return free > 0 ? [free / (count + 1), free / (count + 1)] : [0, 0];
		default:
			return [0, 0];
	}
}

/** The fit-content size between two intrinsic sizes, for an available space. */
export function fitContent(
	available: AvailableSpace,
	minContent: number,
	maxContent: number,
): number {
	if (available === "min-content") return minContent;
	if (available === "max-content") return maxContent;
	return Math.max(minContent, Math.min(available, maxContent));
}

function capSpace(
	space: AvailableSpace,
	max: number | undefined,
): AvailableSpace {
	return typeof space === "number" && max !== undefined
		? Math.min(space, max)
		: space;
}

function sum(values: Iterable<number>): number {
	let total = 0;
	for (const value of values) total += value;
	return total;
}

/**
 * Sizes a flex container and, with `inputs.perform`, lays out its children.
 *
 * @param entry - The container.
 * @param inputs - Known size, containing block, available space, mode.
 * @param compute - Sizes (or lays out) a child.
 * @returns The container's border-box size.
 */
export function layoutFlex(
	entry: Entry,
	inputs: SizingInputs,
	compute: ComputeNode,
): Size {
	const style = entry.style;
	const { known, parentSize, available, perform } = inputs;

	const row =
		style.flexDirection === "row" || style.flexDirection === "row-reverse";
	const reverse = style.flexDirection.endsWith("-reverse");
	const wrap = style.flexWrap !== "nowrap";
	const mainStart: Side = row
		? reverse
			? "right"
			: "left"
		: reverse
			? "bottom"
			: "top";
	const mainEnd = OPPOSITE[mainStart];
	const crossStart: Side = row
		? style.flexWrap === "wrap-reverse"
			? "bottom"
			: "top"
		: style.flexWrap === "wrap-reverse"
			? "right"
			: "left";
	const crossEnd = OPPOSITE[crossStart];
	const mainOf = <T>(size: Size<T>): T => (row ? size.width : size.height);
	const crossOf = <T>(size: Size<T>): T => (row ? size.height : size.width);
	const fromAxes = <T>(main: T, cross: T): Size<T> =>
		row ? { width: main, height: cross } : { width: cross, height: main };

	/* ------------------------------------------------- the container's box */

	const own = (
		value: Parameters<typeof resolve>[0],
		basis: number | undefined,
		axis: "width" | "height",
	) => (inputs.contentAxis === axis ? undefined : resolve(value, basis));
	const padding = resolveEdges(style.padding, parentSize.width);
	const border = resolveEdges(style.border, parentSize.width);
	const inset: Size = {
		width: padding.left + padding.right + border.left + border.right,
		height: padding.top + padding.bottom + border.top + border.bottom,
	};
	const min: MaybeSize = {
		width: own(style.minSize.width, parentSize.width, "width"),
		height: own(style.minSize.height, parentSize.height, "height"),
	};
	const max: MaybeSize = {
		width: own(style.maxSize.width, parentSize.width, "width"),
		height: own(style.maxSize.height, parentSize.height, "height"),
	};
	const styled = applyAspectRatio(
		{
			width:
				known.width ??
				maybeClamp(
					own(style.size.width, parentSize.width, "width"),
					min.width,
					max.width,
				),
			height:
				known.height ??
				maybeClamp(
					own(style.size.height, parentSize.height, "height"),
					min.height,
					max.height,
				),
		},
		inputs.contentAxis ? undefined : style.aspectRatio,
	);
	const outerWidth =
		styled.width === undefined
			? undefined
			: Math.max(styled.width, inset.width);
	const outerHeight =
		styled.height === undefined
			? undefined
			: Math.max(styled.height, inset.height);
	if (!perform && outerWidth !== undefined && outerHeight !== undefined) {
		return { width: outerWidth, height: outerHeight };
	}

	const innerMin: MaybeSize = {
		width:
			min.width === undefined
				? undefined
				: Math.max(0, min.width - inset.width),
		height:
			min.height === undefined
				? undefined
				: Math.max(0, min.height - inset.height),
	};
	const innerMax: MaybeSize = {
		width:
			max.width === undefined
				? undefined
				: Math.max(0, max.width - inset.width),
		height:
			max.height === undefined
				? undefined
				: Math.max(0, max.height - inset.height),
	};
	const inner: MaybeSize = {
		width: outerWidth === undefined ? undefined : outerWidth - inset.width,
		height: outerHeight === undefined ? undefined : outerHeight - inset.height,
	};
	const availableInner: Size<AvailableSpace> = {
		width:
			inner.width ??
			shrinkSpace(capSpace(available.width, max.width), inset.width),
		height:
			inner.height ??
			shrinkSpace(capSpace(available.height, max.height), inset.height),
	};

	const flow: Entry[] = [];
	const absolute: Entry[] = [];
	for (const child of entry.children) {
		if (child.style.display === "none") {
			if (perform) hideSubtree(child);
		} else if (child.style.position === "absolute") {
			absolute.push(child);
		} else {
			flow.push(child);
		}
	}

	/**
	 * A child's outer intrinsic size along one physical axis, for sizing the
	 * container before its own size is known (percentages count as `auto`).
	 */
	const contribution = (
		child: Entry,
		axis: "width" | "height",
		mode: "min-content" | "max-content",
		crossKnown: number | undefined,
	): number => {
		const cs = child.style;
		const margin = resolveEdges(cs.margin, undefined);
		const outerMargin =
			axis === "width"
				? margin.left + margin.right
				: margin.top + margin.bottom;
		const childPadding = resolveEdges(cs.padding, undefined);
		const childBorder = resolveEdges(cs.border, undefined);
		const childInset =
			axis === "width"
				? childPadding.left +
					childPadding.right +
					childBorder.left +
					childBorder.right
				: childPadding.top +
					childPadding.bottom +
					childBorder.top +
					childBorder.bottom;
		const specified = resolve(cs.size[axis], undefined);
		const value =
			specified ??
			compute(child, {
				known:
					axis === "width"
						? { width: undefined, height: crossKnown }
						: { width: crossKnown, height: undefined },
				parentSize: { width: undefined, height: undefined },
				available:
					axis === "width"
						? { width: mode, height: crossKnown ?? "max-content" }
						: { width: crossKnown ?? "max-content", height: mode },
				perform: false,
			})[axis];
		const clamped = clamp(
			value,
			resolve(cs.minSize[axis], undefined),
			resolve(cs.maxSize[axis], undefined),
		);
		return Math.max(clamped, childInset) + outerMargin;
	};

	// The width is settled first, as block layout settles the inline size
	// before anything else, so percentages inside resolve against it.
	if (inner.width === undefined) {
		let minContent = 0;
		let maxContent = 0;
		const heightLimit = inner.height ?? innerMax.height;
		if (row) {
			const gap = resolve(style.gap.width, undefined) ?? 0;
			const gaps = gap * Math.max(0, flow.length - 1);
			maxContent = gaps;
			minContent = wrap ? 0 : gaps;
			for (const child of flow) {
				maxContent += contribution(child, "width", "max-content", undefined);
				const smallest = contribution(child, "width", "min-content", undefined);
				minContent = wrap
					? Math.max(minContent, smallest)
					: minContent + smallest;
			}
		} else if (wrap && heightLimit !== undefined) {
			// A wrapping column is as wide as its lines, broken at its height.
			const mainGap = resolve(style.gap.height, inner.height) ?? 0;
			const crossGap = resolve(style.gap.width, undefined) ?? 0;
			let lineCount = 0;
			let lineWidth = 0;
			let used = 0;
			let total = 0;
			for (const child of flow) {
				const childWidth = contribution(
					child,
					"width",
					"max-content",
					undefined,
				);
				const childHeight = contribution(
					child,
					"height",
					"max-content",
					undefined,
				);
				if (
					lineCount > 0 &&
					used + mainGap + childHeight > heightLimit + EPSILON
				) {
					total += lineWidth;
					lineWidth = 0;
					used = 0;
					lineCount++;
				} else if (lineCount === 0) {
					lineCount = 1;
				} else {
					used += mainGap;
				}
				used += childHeight;
				lineWidth = Math.max(lineWidth, childWidth);
			}
			total += lineWidth + crossGap * Math.max(0, lineCount - 1);
			minContent = total;
			maxContent = total;
		} else {
			for (const child of flow) {
				minContent = Math.max(
					minContent,
					contribution(child, "width", "min-content", undefined),
				);
				maxContent = Math.max(
					maxContent,
					contribution(child, "width", "max-content", undefined),
				);
			}
		}
		inner.width = clamp(
			fitContent(availableInner.width, minContent, maxContent),
			innerMin.width,
			innerMax.width,
		);
		availableInner.width = inner.width;
	}

	const containingBlock: MaybeSize = {
		width: inner.width,
		height: inner.height,
	};
	const initialMainInner = mainOf(inner);
	let crossInner = crossOf(inner);
	const availableMain = mainOf(availableInner);
	const availableCross = crossOf(availableInner);
	const mainGap =
		resolve(row ? style.gap.width : style.gap.height, initialMainInner) ?? 0;
	const crossGap =
		resolve(row ? style.gap.height : style.gap.width, crossInner) ?? 0;

	/* ------------------------------------------------------- the flex items */

	const items: Item[] = flow.map((child) => {
		const cs = child.style;
		const childPadding = resolveEdges(cs.padding, containingBlock.width);
		const childBorder = resolveEdges(cs.border, containingBlock.width);
		return {
			entry: child,
			size: applyAspectRatio(
				{
					width: resolve(cs.size.width, containingBlock.width),
					height: resolve(cs.size.height, containingBlock.height),
				},
				cs.aspectRatio,
			),
			min: {
				width: resolve(cs.minSize.width, containingBlock.width),
				height: resolve(cs.minSize.height, containingBlock.height),
			},
			max: {
				width: resolve(cs.maxSize.width, containingBlock.width),
				height: resolve(cs.maxSize.height, containingBlock.height),
			},
			margin: resolveEdges(cs.margin, containingBlock.width),
			autoMargin: autoEdges(cs.margin),
			inset: {
				width:
					childPadding.left +
					childPadding.right +
					childBorder.left +
					childBorder.right,
				height:
					childPadding.top +
					childPadding.bottom +
					childBorder.top +
					childBorder.bottom,
			},
			align: cs.alignSelf === "auto" ? style.alignItems : cs.alignSelf,
			definiteCross: undefined,
			flexBase: 0,
			minMain: 0,
			maxMain: undefined,
			hypotheticalMain: 0,
			target: 0,
			frozen: false,
			violation: 0,
			hypotheticalCross: 0,
			targetCross: 0,
			mainOffset: 0,
			crossOffset: 0,
		};
	});
	const marginMain = (item: Item) =>
		item.margin[mainStart] + item.margin[mainEnd];
	const marginCross = (item: Item) =>
		item.margin[crossStart] + item.margin[crossEnd];
	const crossAutoMargin = (item: Item) =>
		item.autoMargin[crossStart] || item.autoMargin[crossEnd];
	const isStretched = (item: Item) =>
		item.align === "stretch" &&
		crossOf(item.size) === undefined &&
		!crossAutoMargin(item);

	/** The child's size along the main axis, measured under `mode`. */
	const measureMain = (
		item: Item,
		mode: AvailableSpace,
		ignoreOwnSize = false,
	): number =>
		mainOf(
			compute(item.entry, {
				known: fromAxes(undefined, item.definiteCross),
				parentSize: containingBlock,
				available: fromAxes(
					mode,
					item.definiteCross ?? shrinkSpace(availableCross, marginCross(item)),
				),
				perform: false,
				contentAxis: ignoreOwnSize ? (row ? "width" : "height") : undefined,
			}),
		);

	// §9.2.3: flex base size and hypothetical main size.
	for (const item of items) {
		const cs = item.entry.style;
		const insetMain = mainOf(item.inset);
		const minCross = crossOf(item.min);
		const maxCross = crossOf(item.max);
		// A stretched item in a single-line container with a definite cross
		// size has a definite cross size too.
		item.definiteCross =
			crossOf(item.size) ??
			(!wrap && crossInner !== undefined && isStretched(item)
				? clamp(crossInner - marginCross(item), minCross, maxCross)
				: undefined);

		const basis = resolve(cs.flexBasis, initialMainInner);
		const ratio = cs.aspectRatio;
		const crossToMain = (cross: number) =>
			ratio === undefined ? undefined : row ? cross * ratio : cross / ratio;
		let base: number;
		if (basis !== undefined) {
			base = basis;
		} else if (mainOf(item.size) !== undefined) {
			base = mainOf(item.size) as number;
		} else if (item.definiteCross !== undefined && ratio !== undefined) {
			base = crossToMain(item.definiteCross) as number;
		} else {
			base = measureMain(
				item,
				availableMain === "min-content" ? "min-content" : "max-content",
				true,
			);
		}
		item.flexBase = Math.max(base, insetMain);

		// §4.5: the automatic minimum size of a flex item.
		const explicitMin = mainOf(item.min);
		item.maxMain = mainOf(item.max);
		let minMain: number;
		if (explicitMin !== undefined) {
			minMain = explicitMin;
		} else if (cs.overflow === "hidden") {
			minMain = 0;
		} else {
			const content = measureMain(item, "min-content", true);
			const specified = mainOf(item.size);
			const transferred =
				item.definiteCross === undefined
					? undefined
					: crossToMain(item.definiteCross);
			minMain = Math.min(specified ?? transferred ?? content, content);
			if (item.maxMain !== undefined) minMain = Math.min(minMain, item.maxMain);
		}
		item.minMain = Math.max(minMain, insetMain);
		item.hypotheticalMain = clamp(item.flexBase, item.minMain, item.maxMain);
	}

	/* --------------------------------------------- the container's main size */

	// Only a column's height can still be unknown: it is the content's.
	let mainInner =
		initialMainInner ??
		clamp(
			mainGap * Math.max(0, items.length - 1) +
				sum(items.map((item) => item.hypotheticalMain + marginMain(item))),
			mainOf(innerMin),
			mainOf(innerMax),
		);

	/* ------------------------------------------------------------- lines */

	const lines: Item[][] = [];
	if (!wrap || items.length === 0) {
		lines.push(items);
	} else {
		let line: Item[] = [];
		let used = 0;
		for (const item of items) {
			const outer = item.hypotheticalMain + marginMain(item);
			if (line.length > 0 && used + mainGap + outer > mainInner + EPSILON) {
				lines.push(line);
				line = [];
				used = 0;
			}
			used += (line.length > 0 ? mainGap : 0) + outer;
			line.push(item);
		}
		lines.push(line);
		// Lines broke at the largest height allowed; the container is then as
		// tall as its longest line.
		if (initialMainInner === undefined) {
			const lengths = lines.map(
				(line) =>
					mainGap * Math.max(0, line.length - 1) +
					sum(line.map((item) => item.hypotheticalMain + marginMain(item))),
			);
			mainInner = clamp(
				Math.max(...lengths),
				mainOf(innerMin),
				mainOf(innerMax),
			);
		}
	}

	/* ---------------------------------------- §9.7 resolving flexible lengths */

	for (const line of lines) {
		resolveFlexibleLengths(line, mainInner, mainGap, marginMain, mainOf);
	}

	/* ------------------------------------------------------- cross sizes */

	for (const item of items) {
		const cs = item.entry.style;
		const minCross = crossOf(item.min);
		const maxCross = crossOf(item.max);
		const specified = crossOf(item.size);
		let cross: number;
		if (specified !== undefined) {
			cross = specified;
		} else if (cs.aspectRatio !== undefined) {
			cross = row ? item.target / cs.aspectRatio : item.target * cs.aspectRatio;
		} else {
			cross = crossOf(
				compute(item.entry, {
					known: fromAxes(item.target, undefined),
					parentSize: containingBlock,
					available: fromAxes(
						item.target,
						crossInner !== undefined
							? Math.max(0, crossInner - marginCross(item))
							: shrinkSpace(availableCross, marginCross(item)),
					),
					perform: false,
				}),
			);
		}
		item.hypotheticalCross = Math.max(
			clamp(cross, minCross, maxCross),
			crossOf(item.inset),
		);
	}

	const lineCross: number[] = lines.map((line) =>
		Math.max(
			0,
			...line.map((item) => item.hypotheticalCross + marginCross(item)),
		),
	);
	if (!wrap) {
		lineCross[0] =
			crossInner ??
			clamp(lineCross[0] ?? 0, crossOf(innerMin), crossOf(innerMax));
	}
	if (crossInner === undefined) {
		crossInner = clamp(
			sum(lineCross) + crossGap * Math.max(0, lines.length - 1),
			crossOf(innerMin),
			crossOf(innerMax),
		);
	}
	if (wrap && style.alignContent === "stretch") {
		const extra =
			crossInner - sum(lineCross) - crossGap * Math.max(0, lines.length - 1);
		if (extra > 0) {
			for (let i = 0; i < lineCross.length; i++) {
				lineCross[i] = (lineCross[i] as number) + extra / lineCross.length;
			}
		}
	}

	lines.forEach((line, index) => {
		for (const item of line) {
			item.targetCross = isStretched(item)
				? Math.max(
						clamp(
							(lineCross[index] as number) - marginCross(item),
							crossOf(item.min),
							crossOf(item.max),
						),
						crossOf(item.inset),
					)
				: item.hypotheticalCross;
		}
	});

	const width = outerWidth ?? (row ? mainInner : crossInner) + inset.width;
	const height = outerHeight ?? (row ? crossInner : mainInner) + inset.height;
	if (!perform) return { width, height };

	/* --------------------------------------------------------- alignment */

	const usedMargins = new Map<Item, Edges<number>>();
	for (const line of lines) {
		const gaps = mainGap * Math.max(0, line.length - 1);
		let autoCount = 0;
		let occupied = gaps;
		for (const item of line) {
			occupied += item.target;
			for (const side of [mainStart, mainEnd]) {
				if (item.autoMargin[side]) autoCount++;
				else occupied += item.margin[side];
			}
		}
		const free = mainInner - occupied;
		const autoValue = autoCount > 0 && free > 0 ? free / autoCount : 0;
		const [start, between] =
			autoCount > 0 && free > 0
				? [0, 0]
				: distribute(style.justifyContent ?? "flex-start", free, line.length);
		let offset = start;
		for (const item of line) {
			const margins = { ...item.margin };
			for (const side of [mainStart, mainEnd]) {
				if (item.autoMargin[side]) margins[side] = autoValue;
			}
			offset += margins[mainStart];
			item.mainOffset = offset;
			offset += item.target + margins[mainEnd] + mainGap + between;
			usedMargins.set(item, margins);
		}
	}

	const crossGaps = crossGap * Math.max(0, lines.length - 1);
	const [lineStart, lineBetween] = wrap
		? distribute(
				style.alignContent,
				crossInner - sum(lineCross) - crossGaps,
				lines.length,
			)
		: [0, 0];
	let lineOffset = lineStart;
	lines.forEach((line, index) => {
		const size = lineCross[index] as number;
		for (const item of line) {
			const margins = usedMargins.get(item) as Edges<number>;
			const autoStart = item.autoMargin[crossStart];
			const autoEnd = item.autoMargin[crossEnd];
			if (autoStart || autoEnd) {
				const free =
					size -
					item.targetCross -
					(autoStart ? 0 : margins[crossStart]) -
					(autoEnd ? 0 : margins[crossEnd]);
				const share = free > 0 ? free / (autoStart && autoEnd ? 2 : 1) : 0;
				if (autoStart) margins[crossStart] = share;
				if (autoEnd) margins[crossEnd] = share;
				item.crossOffset = lineOffset + margins[crossStart];
				continue;
			}
			let within: number;
			switch (item.align) {
				case "flex-end":
					within = size - item.targetCross - margins[crossEnd];
					break;
				case "center":
					within =
						margins[crossStart] +
						(size -
							item.targetCross -
							margins[crossStart] -
							margins[crossEnd]) /
							2;
					break;
				default:
					within = margins[crossStart];
			}
			item.crossOffset = lineOffset + within;
		}
		lineOffset += size + crossGap + lineBetween;
	});

	/* ----------------------------------------------------- writing boxes */

	const contentLeft = border.left + padding.left;
	const contentTop = border.top + padding.top;
	const contentStart = (side: Side) =>
		side === "left" || side === "right" ? contentLeft : contentTop;
	const place = (
		side: Side,
		extent: number,
		offset: number,
		size: number,
	): number =>
		side === "left" || side === "top"
			? contentStart(side) + offset
			: contentStart(side) + extent - offset - size;

	for (const item of items) {
		const size = compute(item.entry, {
			known: fromAxes(item.target, item.targetCross),
			parentSize: containingBlock,
			available: fromAxes(item.target, item.targetCross),
			perform: true,
		});
		const main = place(mainStart, mainInner, item.mainOffset, mainOf(size));
		const cross = place(
			crossStart,
			crossInner,
			item.crossOffset,
			crossOf(size),
		);
		const position = fromAxes(main, cross);
		const offset = relativeOffset(item.entry, containingBlock);
		item.entry.box = {
			...item.entry.box,
			x: position.width + offset.width,
			y: position.height + offset.height,
			margin: usedMargins.get(item) as Edges<number>,
		};
	}

	layoutAbsolute(absolute, compute, {
		width,
		height,
		border,
		padding,
		mainStart,
		crossStart,
		row,
		justifyContent: style.justifyContent ?? "flex-start",
		alignItems: style.alignItems,
	});

	entry.box = { ...entry.box, width, height, padding, border };
	return { width, height };
}

/** The shift a relatively positioned node's insets give it. */
export function relativeOffset(entry: Entry, containingBlock: MaybeSize): Size {
	const inset = entry.style.inset;
	const left = resolve(inset.left, containingBlock.width);
	const right = resolve(inset.right, containingBlock.width);
	const top = resolve(inset.top, containingBlock.height);
	const bottom = resolve(inset.bottom, containingBlock.height);
	return {
		width: left ?? (right === undefined ? 0 : -right),
		height: top ?? (bottom === undefined ? 0 : -bottom),
	};
}

/**
 * §9.7: grows or shrinks the items of one line until they fill it, freezing
 * items as they hit their minimum or maximum.
 */
function resolveFlexibleLengths(
	line: Item[],
	mainInner: number,
	gap: number,
	marginMain: (item: Item) => number,
	mainOf: (size: Size) => number,
): void {
	const gaps = gap * Math.max(0, line.length - 1);
	const used =
		gaps + sum(line.map((item) => item.hypotheticalMain + marginMain(item)));
	const growing = used < mainInner;
	const factor = (item: Item) =>
		growing ? item.entry.style.flexGrow : item.entry.style.flexShrink;

	for (const item of line) {
		item.target = item.hypotheticalMain;
		item.frozen =
			factor(item) === 0 ||
			(growing && item.flexBase > item.hypotheticalMain) ||
			(!growing && item.flexBase < item.hypotheticalMain);
	}
	const freeSpace = () =>
		mainInner -
		gaps -
		sum(
			line.map(
				(item) =>
					(item.frozen ? item.target : item.flexBase) + marginMain(item),
			),
		);
	const initialFree = freeSpace();

	for (;;) {
		const unfrozen = line.filter((item) => !item.frozen);
		if (unfrozen.length === 0) break;
		let free = freeSpace();
		const factors = sum(unfrozen.map(factor));
		if (factors < 1) {
			const scaled = initialFree * factors;
			if (Math.abs(scaled) < Math.abs(free)) free = scaled;
		}
		if (Math.abs(free) > EPSILON) {
			if (growing) {
				for (const item of unfrozen) {
					item.target = item.flexBase + (free * factor(item)) / factors;
				}
			} else {
				const scaled = (item: Item) =>
					factor(item) * (item.flexBase - mainOf(item.inset));
				const total = sum(unfrozen.map(scaled));
				for (const item of unfrozen) {
					item.target =
						total > 0
							? item.flexBase - (Math.abs(free) * scaled(item)) / total
							: item.flexBase;
				}
			}
		} else {
			for (const item of unfrozen) item.target = item.flexBase;
		}
		let totalViolation = 0;
		for (const item of unfrozen) {
			const clamped = clamp(item.target, item.minMain, item.maxMain);
			item.violation = clamped - item.target;
			item.target = clamped;
			totalViolation += item.violation;
		}
		for (const item of unfrozen) {
			if (
				Math.abs(totalViolation) <= EPSILON ||
				(totalViolation > 0 && item.violation > 0) ||
				(totalViolation < 0 && item.violation < 0)
			) {
				item.frozen = true;
			}
		}
	}
}

export interface AbsoluteContext {
	width: number;
	height: number;
	border: Edges<number>;
	padding: Edges<number>;
	mainStart: Side;
	crossStart: Side;
	row: boolean;
	justifyContent: JustifyContent;
	alignItems: AlignItems;
}

/**
 * Lays out absolutely positioned children against the container's padding
 * box. An axis with neither inset set takes the static position: where the
 * child would sit as the container's only flex item.
 */
export function layoutAbsolute(
	children: Entry[],
	compute: ComputeNode,
	context: AbsoluteContext,
): void {
	const { width, height, border, padding } = context;
	const box: Size = {
		width: width - border.left - border.right,
		height: height - border.top - border.bottom,
	};
	for (const child of children) {
		const cs = child.style;
		const margin = resolveEdges(cs.margin, box.width);
		const left = resolve(cs.inset.left, box.width);
		const right = resolve(cs.inset.right, box.width);
		const top = resolve(cs.inset.top, box.height);
		const bottom = resolve(cs.inset.bottom, box.height);
		const min: MaybeSize = {
			width: resolve(cs.minSize.width, box.width),
			height: resolve(cs.minSize.height, box.height),
		};
		const max: MaybeSize = {
			width: resolve(cs.maxSize.width, box.width),
			height: resolve(cs.maxSize.height, box.height),
		};
		const spaceWidth = Math.max(
			0,
			box.width - (left ?? 0) - (right ?? 0) - margin.left - margin.right,
		);
		const spaceHeight = Math.max(
			0,
			box.height - (top ?? 0) - (bottom ?? 0) - margin.top - margin.bottom,
		);
		let size = applyAspectRatio(
			{
				width:
					resolve(cs.size.width, box.width) ??
					(left !== undefined && right !== undefined ? spaceWidth : undefined),
				height:
					resolve(cs.size.height, box.height) ??
					(top !== undefined && bottom !== undefined ? spaceHeight : undefined),
			},
			cs.aspectRatio,
		);
		size = {
			width: maybeClamp(size.width, min.width, max.width),
			height: maybeClamp(size.height, min.height, max.height),
		};
		const parentSize = { width: box.width, height: box.height };
		const final = compute(child, {
			known: size,
			parentSize,
			available: {
				width: size.width ?? spaceWidth,
				height: size.height ?? spaceHeight,
			},
			perform: true,
		});

		// The static position, as the only flex item.
		const contentWidth = box.width - padding.left - padding.right;
		const contentHeight = box.height - padding.top - padding.bottom;
		const staticOffset = (
			side: Side,
			extent: number,
			itemSize: number,
			startMargin: number,
			endMargin: number,
			mode: JustifyContent | AlignItems,
		) => {
			const free = extent - itemSize - startMargin - endMargin;
			const shift =
				mode === "flex-end"
					? free
					: mode === "center" ||
							mode === "space-around" ||
							mode === "space-evenly"
						? free / 2
						: 0;
			const offset = shift + startMargin;
			const contentStart =
				side === "left" || side === "right"
					? border.left + padding.left
					: border.top + padding.top;
			return side === "left" || side === "top"
				? contentStart + offset
				: contentStart + extent - offset - itemSize;
		};
		const staticFor = (side: Side, mode: JustifyContent | AlignItems) => {
			const horizontal = side === "left" || side === "right";
			return staticOffset(
				side,
				horizontal ? contentWidth : contentHeight,
				horizontal ? final.width : final.height,
				margin[side],
				margin[OPPOSITE[side]],
				mode,
			);
		};
		const align = cs.alignSelf === "auto" ? context.alignItems : cs.alignSelf;
		const horizontalSide = context.row ? context.mainStart : context.crossStart;
		const verticalSide = context.row ? context.crossStart : context.mainStart;
		const horizontalMode = context.row ? context.justifyContent : align;
		const verticalMode = context.row ? align : context.justifyContent;

		const x =
			left !== undefined
				? border.left + left + margin.left
				: right !== undefined
					? width - border.right - right - margin.right - final.width
					: staticFor(horizontalSide, horizontalMode);
		const y =
			top !== undefined
				? border.top + top + margin.top
				: bottom !== undefined
					? height - border.bottom - bottom - margin.bottom - final.height
					: staticFor(verticalSide, verticalMode);
		child.box = { ...child.box, x, y, margin };
	}
}
