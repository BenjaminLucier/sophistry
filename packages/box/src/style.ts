/**
 * A box's style: typed inline properties, one object per box, in the shape
 * of CSS. Nothing cascades; the text properties are handed down to the text
 * inside, and nothing else is.
 *
 * Lengths are numbers in the box's `lengthUnit` (design pixels unless it
 * says otherwise), percentages of the parent's size, `"2u"` for scene units
 * or `"100px"` for design pixels whatever the unit, or `"auto"`.
 */

import type { ColorInput, PaintSpec } from "@sophistry/core";
import type { CornerRadius } from "@sophistry/core/geometry";
import type {
	AlignContent,
	AlignItems,
	AlignSelf,
	Dimension,
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
	TrackBreadth,
	TrackList,
	TrackSize,
} from "@sophistry/layout";

/**
 * A length: a number in the box's unit, a percentage of the parent's size,
 * scene units (`"2u"`) or design pixels (`"100px"`).
 *
 * @category Box
 */
export type BoxLength = number | `${number}%` | `${number}u` | `${number}px`;

/**
 * A length or `"auto"`.
 *
 * @category Box
 */
export type BoxDimension = BoxLength | "auto";

/**
 * Space on four sides: one length for all, `[vertical, horizontal]`, or
 * `[top, right, bottom, left]`.
 *
 * @category Box
 */
export type BoxSpacing<T = BoxLength> =
	| T
	| readonly [vertical: T, horizontal: T]
	| readonly [top: T, right: T, bottom: T, left: T];

/**
 * A grid track's minimum or maximum: a length, `"auto"`, an intrinsic size,
 * or a share of the free space (`{ fr: 1 }`).
 *
 * @category Box
 */
export type BoxTrackBreadth =
	| BoxLength
	| "auto"
	| "min-content"
	| "max-content"
	| { fr: number };

/**
 * One grid track: a breadth, `{ minmax: [min, max] }`, or
 * `{ fitContent: length }`.
 *
 * @category Box
 */
export type BoxTrackSize =
	| BoxTrackBreadth
	| {
			minmax: readonly [
				min: Exclude<BoxTrackBreadth, { fr: number }>,
				max: BoxTrackBreadth,
			];
	  }
	| { fitContent: BoxLength };

/**
 * The tracks of one axis of a grid, in order; `{ repeat, tracks }` repeats
 * some, a number of times or as many as fit (`"auto-fill"`, `"auto-fit"`).
 *
 * @category Box
 */
export type BoxTrackList = readonly (
	| BoxTrackSize
	| {
			repeat: number | "auto-fill" | "auto-fit";
			tracks: readonly BoxTrackSize[];
	  }
)[];

/**
 * A box's style.
 *
 * @category Box
 */
export interface BoxStyle {
	/**
	 * `"grid"` lays the children out on a grid; `"none"` takes the box (and
	 * everything in it) out of the layout.
	 * @default "flex"
	 */
	display?: "flex" | "grid" | "none";
	/** `"absolute"` places the box by its insets, out of the flow. */
	position?: "relative" | "absolute";
	top?: BoxDimension;
	right?: BoxDimension;
	bottom?: BoxDimension;
	left?: BoxDimension;

	/** Sizes include padding and border. */
	width?: BoxDimension;
	height?: BoxDimension;
	minWidth?: BoxDimension;
	maxWidth?: BoxDimension;
	minHeight?: BoxDimension;
	maxHeight?: BoxDimension;
	/** Width over height. */
	aspectRatio?: number;

	margin?: BoxSpacing<BoxDimension>;
	marginTop?: BoxDimension;
	marginRight?: BoxDimension;
	marginBottom?: BoxDimension;
	marginLeft?: BoxDimension;
	padding?: BoxSpacing;
	paddingTop?: BoxLength;
	paddingRight?: BoxLength;
	paddingBottom?: BoxLength;
	paddingLeft?: BoxLength;

	flexDirection?: FlexDirection;
	flexWrap?: FlexWrap;
	/** `n` grows and shrinks from a basis of 0, as CSS's `flex: n`; `"none"` neither. */
	flex?: number | "none" | "auto";
	flexGrow?: number;
	flexShrink?: number;
	flexBasis?: BoxDimension;
	justifyContent?: JustifyContent;
	alignItems?: AlignItems;
	alignSelf?: AlignSelf;
	alignContent?: AlignContent;
	/** Space between rows and columns: one length, or `[row, column]`. */
	gap?: BoxLength | readonly [row: BoxLength, column: BoxLength];
	rowGap?: BoxLength;
	columnGap?: BoxLength;

	/** The grid's columns, e.g. `[{ fr: 1 }, 240, { fr: 2 }]`. */
	gridTemplateColumns?: BoxTrackList;
	/** The grid's rows. */
	gridTemplateRows?: BoxTrackList;
	/** The size of columns made beyond the template. */
	gridAutoColumns?: readonly BoxTrackSize[];
	/** The size of rows made beyond the template. */
	gridAutoRows?: readonly BoxTrackSize[];
	/** How children without a place fill the grid. @default "row" */
	gridAutoFlow?: GridAutoFlow;
	/** Where this box sits across a grid's columns: a line, or `{ start, end, span }`. */
	gridColumn?: GridPlacement;
	/** Where this box sits across a grid's rows. */
	gridRow?: GridPlacement;
	/** How children sit across their grid areas. @default "stretch" */
	justifyItems?: JustifyItems;
	/** How this box sits across its grid area. @default "auto" */
	justifySelf?: JustifySelf;

	/** Fills the border box: a colour or a gradient. */
	background?: PaintSpec;
	/** One width, or `[top, right, bottom, left]`. */
	borderWidth?: BoxSpacing<number>;
	borderColor?: ColorInput;
	/** One radius, or one per corner from the top left, clockwise. */
	borderRadius?:
		| CornerRadius
		| readonly [CornerRadius, CornerRadius, CornerRadius, CornerRadius];
	/** Multiplies into the box and everything in it, 0..1. */
	opacity?: number;
	/** `"hidden"` clips the contents to the padding box. */
	overflow?: "visible" | "hidden";

	/** Text colour, handed down to the text inside. */
	color?: ColorInput;
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: string | number;
	italic?: boolean;
	letterSpacing?: number;
	/** A multiple of the largest font size on each line. */
	lineHeight?: number;
	textAlign?: CanvasTextAlign;
	underline?: boolean;
	strikethrough?: boolean;
}

/**
 * How the box's numbers become layout pixels: `unit` design pixels per
 * number, `perSceneUnit` design pixels per scene unit.
 */
export interface LengthScale {
	unit: number;
	perSceneUnit: number;
}

/** A length in layout pixels (or a percentage, which the engine resolves). */
export function toLength(value: BoxLength, scale: LengthScale): Length {
	if (typeof value === "number") return value * scale.unit;
	if (value.endsWith("%")) return value as `${number}%`;
	if (value.endsWith("px")) return Number.parseFloat(value);
	if (value.endsWith("u")) return Number.parseFloat(value) * scale.perSceneUnit;
	throw new TypeError(`Box: "${value}" is not a length.`);
}

function toDimension(
	value: BoxDimension | undefined,
	scale: LengthScale,
): Dimension | undefined {
	if (value === undefined) return undefined;
	return value === "auto" ? "auto" : toLength(value, scale);
}

function toBreadth(value: BoxTrackBreadth, scale: LengthScale): TrackBreadth {
	if (typeof value === "object") return value;
	if (value === "auto" || value === "min-content" || value === "max-content") {
		return value;
	}
	return toLength(value, scale);
}

function toTrack(value: BoxTrackSize, scale: LengthScale): TrackSize {
	if (typeof value === "object" && "minmax" in value) {
		const [min, max] = value.minmax;
		return {
			minmax: [
				toBreadth(min, scale) as Exclude<TrackBreadth, { fr: number }>,
				toBreadth(max, scale),
			],
		};
	}
	if (typeof value === "object" && "fitContent" in value) {
		return { fitContent: toLength(value.fitContent, scale) };
	}
	return toBreadth(value, scale);
}

function toTrackList(list: BoxTrackList, scale: LengthScale): TrackList {
	return list.map((entry) =>
		typeof entry === "object" && "repeat" in entry
			? {
					repeat: entry.repeat,
					tracks: entry.tracks.map((track) => toTrack(track, scale)),
				}
			: toTrack(entry, scale),
	);
}

/** Four sides from a shorthand. */
export function sides<T>(value: BoxSpacing<T>): Edges<T> {
	if (!Array.isArray(value)) {
		const one = value as T;
		return { top: one, right: one, bottom: one, left: one };
	}
	const list = value as readonly T[];
	if (list.length === 2) {
		const [vertical, horizontal] = list as [T, T];
		return {
			top: vertical,
			right: horizontal,
			bottom: vertical,
			left: horizontal,
		};
	}
	const [top, right, bottom, left] = list as [T, T, T, T];
	return { top, right, bottom, left };
}

function edges<T, R>(
	all: BoxSpacing<T> | undefined,
	own: Partial<Edges<T | undefined>>,
	convert: (value: T) => R,
): Partial<Edges<R>> | undefined {
	const base: Partial<Edges<T>> = all === undefined ? {} : sides(all);
	const out: Partial<Edges<R>> = {};
	let any = false;
	for (const side of ["top", "right", "bottom", "left"] as const) {
		const value = own[side] ?? base[side];
		if (value !== undefined) {
			out[side] = convert(value);
			any = true;
		}
	}
	return any ? out : undefined;
}

/** The layout engine's style for a box's style. */
export function layoutStyleOf(
	style: BoxStyle,
	scale: LengthScale,
): LayoutStyle {
	const out: LayoutStyle = {};
	const set = <K extends keyof LayoutStyle>(
		key: K,
		value: LayoutStyle[K] | undefined,
	) => {
		if (value !== undefined) out[key] = value;
	};
	set("display", style.display);
	set("position", style.position);
	set("top", toDimension(style.top, scale));
	set("right", toDimension(style.right, scale));
	set("bottom", toDimension(style.bottom, scale));
	set("left", toDimension(style.left, scale));
	set("width", toDimension(style.width, scale));
	set("height", toDimension(style.height, scale));
	set("minWidth", toDimension(style.minWidth, scale));
	set("maxWidth", toDimension(style.maxWidth, scale));
	set("minHeight", toDimension(style.minHeight, scale));
	set("maxHeight", toDimension(style.maxHeight, scale));
	set("aspectRatio", style.aspectRatio);
	set(
		"margin",
		edges<BoxDimension, Dimension>(
			style.margin,
			{
				top: style.marginTop,
				right: style.marginRight,
				bottom: style.marginBottom,
				left: style.marginLeft,
			},
			(value) => toDimension(value, scale) as Dimension,
		),
	);
	set(
		"padding",
		edges<BoxLength, Length>(
			style.padding,
			{
				top: style.paddingTop,
				right: style.paddingRight,
				bottom: style.paddingBottom,
				left: style.paddingLeft,
			},
			(value) => toLength(value, scale),
		),
	);
	set(
		"border",
		edges<number, Length>(style.borderWidth, {}, (value) => value * scale.unit),
	);
	set("overflow", style.overflow);
	set("flexDirection", style.flexDirection);
	set("flexWrap", style.flexWrap);
	set("justifyContent", style.justifyContent);
	set("alignItems", style.alignItems);
	set("alignSelf", style.alignSelf);
	set("alignContent", style.alignContent);
	if (style.gridTemplateColumns) {
		out.gridTemplateColumns = toTrackList(style.gridTemplateColumns, scale);
	}
	if (style.gridTemplateRows) {
		out.gridTemplateRows = toTrackList(style.gridTemplateRows, scale);
	}
	if (style.gridAutoColumns) {
		out.gridAutoColumns = style.gridAutoColumns.map((t) => toTrack(t, scale));
	}
	if (style.gridAutoRows) {
		out.gridAutoRows = style.gridAutoRows.map((t) => toTrack(t, scale));
	}
	set("gridAutoFlow", style.gridAutoFlow);
	set("gridColumn", style.gridColumn);
	set("gridRow", style.gridRow);
	set("justifyItems", style.justifyItems);
	set("justifySelf", style.justifySelf);

	const flex = style.flex;
	if (typeof flex === "number") {
		out.flexGrow = flex;
		out.flexShrink = 1;
		out.flexBasis = 0;
	} else if (flex === "none") {
		out.flexGrow = 0;
		out.flexShrink = 0;
		out.flexBasis = "auto";
	} else if (flex === "auto") {
		out.flexGrow = 1;
		out.flexShrink = 1;
		out.flexBasis = "auto";
	}
	set("flexGrow", style.flexGrow);
	set("flexShrink", style.flexShrink);
	set("flexBasis", toDimension(style.flexBasis, scale));

	const gap = style.gap;
	if (gap !== undefined) {
		const [row, column] = Array.isArray(gap)
			? (gap as readonly [BoxLength, BoxLength])
			: [gap as BoxLength, gap as BoxLength];
		out.rowGap = toLength(row, scale);
		out.columnGap = toLength(column, scale);
	}
	if (style.rowGap !== undefined) out.rowGap = toLength(style.rowGap, scale);
	if (style.columnGap !== undefined) {
		out.columnGap = toLength(style.columnGap, scale);
	}
	return out;
}
