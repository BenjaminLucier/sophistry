/**
 * The style a layout node takes, and its resolved form.
 *
 * Values follow CSS: a number is a length, `"50%"` a percentage of the
 * containing block, `"auto"` lets the algorithm decide. Every size is a
 * border-box size (CSS `box-sizing: border-box`). Lengths are unitless; the
 * caller decides what one unit means.
 */

/** A length, or a percentage of the containing block such as `"50%"`. */
export type Length = number | `${number}%`;

/** A {@link Length}, or `"auto"`. */
export type Dimension = Length | "auto";

/** One value per side. */
export interface Edges<T> {
	top: T;
	right: T;
	bottom: T;
	left: T;
}

/** A width and a height. */
export interface Size<T = number> {
	width: T;
	height: T;
}

/** How a node takes part in layout. */
export type Display = "flex" | "none";

/** `"absolute"` takes a node out of flow, placed by its insets against its parent's padding box. */
export type Position = "relative" | "absolute";

/** The main axis of a flex container, and whether it runs backwards. */
export type FlexDirection = "row" | "row-reverse" | "column" | "column-reverse";

/** Whether flex items wrap onto several lines. */
export type FlexWrap = "nowrap" | "wrap" | "wrap-reverse";

/** Where free space on the main axis goes. */
export type JustifyContent =
	| "flex-start"
	| "flex-end"
	| "center"
	| "space-between"
	| "space-around"
	| "space-evenly";

/** How an item sits on its line's cross axis. */
export type AlignItems = "flex-start" | "flex-end" | "center" | "stretch";

/** `alignSelf` adds `"auto"`: use the container's `alignItems`. */
export type AlignSelf = AlignItems | "auto";

/** How lines share the container's cross axis. */
export type AlignContent =
	| "flex-start"
	| "flex-end"
	| "center"
	| "stretch"
	| "space-between"
	| "space-around"
	| "space-evenly";

/** `"hidden"` clips the node's content, and lets a flex item shrink below its content. */
export type Overflow = "visible" | "hidden";

/**
 * Everything a node's layout depends on. Every property is optional; the
 * defaults are CSS's, except that `display` defaults to `"flex"`.
 */
export interface LayoutStyle {
	/** @default "flex" */
	display?: Display;
	/** @default "relative" */
	position?: Position;
	/** Insets. On an absolute node they place it; on a relative one they offset it. */
	top?: Dimension;
	right?: Dimension;
	bottom?: Dimension;
	left?: Dimension;

	width?: Dimension;
	height?: Dimension;
	minWidth?: Dimension;
	minHeight?: Dimension;
	maxWidth?: Dimension;
	maxHeight?: Dimension;
	/** Width divided by height, applied when only one of them is known. */
	aspectRatio?: number;

	/** Percentages, vertical ones included, resolve against the containing block's width. */
	margin?: Partial<Edges<Dimension>>;
	padding?: Partial<Edges<Length>>;
	border?: Partial<Edges<Length>>;
	/** @default "visible" */
	overflow?: Overflow;

	/** @default "row" */
	flexDirection?: FlexDirection;
	/** @default "nowrap" */
	flexWrap?: FlexWrap;
	/** @default "flex-start" */
	justifyContent?: JustifyContent;
	/** @default "stretch" */
	alignItems?: AlignItems;
	/** @default "auto" */
	alignSelf?: AlignSelf;
	/** @default "stretch" */
	alignContent?: AlignContent;
	/** Space between rows of items (between lines in a row container). @default 0 */
	rowGap?: Length;
	/** Space between columns of items. @default 0 */
	columnGap?: Length;
	/** @default 0 */
	flexGrow?: number;
	/** @default 1 */
	flexShrink?: number;
	/** @default "auto" */
	flexBasis?: Dimension;
}

/* ------------------------------------------------------------- resolving */

/**
 * A parsed dimension. `percent` is a fraction (0.5 for `"50%"`).
 *
 * @internal
 */
export type Resolved =
	| { kind: "length"; value: number }
	| { kind: "percent"; value: number }
	| { kind: "auto" };

const AUTO: Resolved = { kind: "auto" };
const ZERO: Resolved = { kind: "length", value: 0 };

/**
 * Parses a style value once.
 *
 * @internal
 */
export function parseDimension(
	value: Dimension | undefined,
	fallback: Resolved = AUTO,
): Resolved {
	if (value === undefined) return fallback;
	if (value === "auto") return AUTO;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new RangeError(`layout: ${value} is not a finite length`);
		}
		return { kind: "length", value };
	}
	const match = /^(-?(?:\d+\.?\d*|\.\d+))%$/.exec(value);
	if (!match) throw new RangeError(`layout: cannot read "${value}"`);
	return { kind: "percent", value: Number(match[1]) / 100 };
}

/**
 * A dimension against its basis: a number, or `undefined` when it is `auto`
 * or a percentage of an unknown basis.
 *
 * @internal
 */
export function resolve(
	value: Resolved,
	basis: number | undefined,
): number | undefined {
	switch (value.kind) {
		case "length":
			return value.value;
		case "percent":
			return basis === undefined ? undefined : value.value * basis;
		default:
			return undefined;
	}
}

/**
 * A style with every value parsed, made once per node per layout.
 *
 * @internal
 */
export interface ResolvedStyle {
	display: Display;
	position: Position;
	inset: Edges<Resolved>;
	size: Size<Resolved>;
	minSize: Size<Resolved>;
	maxSize: Size<Resolved>;
	aspectRatio: number | undefined;
	margin: Edges<Resolved>;
	padding: Edges<Resolved>;
	border: Edges<Resolved>;
	overflow: Overflow;
	flexDirection: FlexDirection;
	flexWrap: FlexWrap;
	justifyContent: JustifyContent;
	alignItems: AlignItems;
	alignSelf: AlignSelf;
	alignContent: AlignContent;
	gap: Size<Resolved>;
	flexGrow: number;
	flexShrink: number;
	flexBasis: Resolved;
}

function edges(
	value: Partial<Edges<Dimension>> | undefined,
	fallback: Resolved,
): Edges<Resolved> {
	return {
		top: parseDimension(value?.top, fallback),
		right: parseDimension(value?.right, fallback),
		bottom: parseDimension(value?.bottom, fallback),
		left: parseDimension(value?.left, fallback),
	};
}

function nonNegative(
	name: string,
	value: number | undefined,
	fallback: number,
) {
	if (value === undefined) return fallback;
	if (!(value >= 0) || !Number.isFinite(value)) {
		throw new RangeError(`layout: ${name} must be a finite number ≥ 0`);
	}
	return value;
}

/**
 * Parses every value of `style`, filling in the defaults.
 *
 * @internal
 */
export function resolveStyle(style: LayoutStyle): ResolvedStyle {
	const aspectRatio = style.aspectRatio;
	if (
		aspectRatio !== undefined &&
		!(aspectRatio > 0 && Number.isFinite(aspectRatio))
	) {
		throw new RangeError("layout: aspectRatio must be a positive number");
	}
	return {
		display: style.display ?? "flex",
		position: style.position ?? "relative",
		inset: {
			top: parseDimension(style.top),
			right: parseDimension(style.right),
			bottom: parseDimension(style.bottom),
			left: parseDimension(style.left),
		},
		size: {
			width: parseDimension(style.width),
			height: parseDimension(style.height),
		},
		minSize: {
			width: parseDimension(style.minWidth),
			height: parseDimension(style.minHeight),
		},
		maxSize: {
			width: parseDimension(style.maxWidth),
			height: parseDimension(style.maxHeight),
		},
		aspectRatio,
		margin: edges(style.margin, ZERO),
		padding: edges(style.padding, ZERO),
		border: edges(style.border, ZERO),
		overflow: style.overflow ?? "visible",
		flexDirection: style.flexDirection ?? "row",
		flexWrap: style.flexWrap ?? "nowrap",
		justifyContent: style.justifyContent ?? "flex-start",
		alignItems: style.alignItems ?? "stretch",
		alignSelf: style.alignSelf ?? "auto",
		alignContent: style.alignContent ?? "stretch",
		gap: {
			width: parseDimension(style.columnGap, ZERO),
			height: parseDimension(style.rowGap, ZERO),
		},
		flexGrow: nonNegative("flexGrow", style.flexGrow, 0),
		flexShrink: nonNegative("flexShrink", style.flexShrink, 1),
		flexBasis: parseDimension(style.flexBasis),
	};
}
