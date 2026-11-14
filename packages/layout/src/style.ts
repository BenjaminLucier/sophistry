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

/** How a node lays out its children, or `"none"` to leave it out of layout entirely. */
export type Display = "flex" | "grid" | "none";

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

/** The size of a grid track, or one end of a `minmax`: a length, `"auto"`, an intrinsic size, or a share of the free space. */
export type TrackBreadth =
	| Length
	| "auto"
	| "min-content"
	| "max-content"
	| { fr: number };

/**
 * The size of one grid track: a {@link TrackBreadth}, `{ minmax: [min, max] }`
 * (the minimum cannot be a fraction), or `{ fitContent: limit }`, which sizes
 * to the content but no larger than `limit`.
 */
export type TrackSize =
	| TrackBreadth
	| {
			minmax: readonly [
				min: Exclude<TrackBreadth, { fr: number }>,
				max: TrackBreadth,
			];
	  }
	| { fitContent: Length };

/**
 * Tracks repeated `repeat` times. `"auto-fill"` repeats as often as fits the
 * container; `"auto-fit"` does too, then collapses the repeated tracks no item
 * occupies. Both need tracks with a definite size on at least one end.
 */
export interface TrackRepeat {
	repeat: number | "auto-fill" | "auto-fit";
	tracks: readonly TrackSize[];
}

/** The tracks of one axis of an explicit grid, in order. */
export type TrackList = readonly (TrackSize | TrackRepeat)[];

/**
 * Where an item sits along one axis of a grid: a line number (1 is the first
 * line; negative numbers count from the last line of the explicit grid), or
 * `start` and `end` lines and a `span` of tracks. Anything left out is
 * automatic: `{ span: 2 }` takes two tracks wherever auto-placement puts it,
 * `{ start: 2 }` takes one track starting at line 2.
 */
export type GridPlacement =
	| number
	| { start?: number; end?: number; span?: number };

/** How items that name no position are placed, and whether they fill earlier gaps (`"dense"`). */
export type GridAutoFlow = "row" | "column" | "row dense" | "column dense";

/** How a grid item sits within its area on the inline (horizontal) axis. */
export type JustifyItems = "start" | "end" | "center" | "stretch";

/** `justifySelf` adds `"auto"`: use the container's `justifyItems`. */
export type JustifySelf = JustifyItems | "auto";

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
	/**
	 * In a flex container, where free space on the main axis goes; in a grid
	 * container, how the columns share the container's width. Unset, a grid
	 * stretches its `auto` columns to fill the width.
	 * @default "flex-start"
	 */
	justifyContent?: JustifyContent;
	/**
	 * Where an item sits on the cross axis of its flex line, or on the block
	 * (vertical) axis of its grid area, where `"flex-start"` and `"flex-end"`
	 * mean the start and end of the area.
	 * @default "stretch"
	 */
	alignItems?: AlignItems;
	/** @default "auto" */
	alignSelf?: AlignSelf;
	/**
	 * In a flex container, how lines share the cross axis; in a grid container,
	 * how the rows share the container's height. `"stretch"` grows `auto` rows
	 * and lines.
	 * @default "stretch"
	 */
	alignContent?: AlignContent;
	/** Space between rows of items (between lines in a row container, between grid rows). @default 0 */
	rowGap?: Length;
	/** Space between columns of items (between grid columns). @default 0 */
	columnGap?: Length;
	/** @default 0 */
	flexGrow?: number;
	/** @default 1 */
	flexShrink?: number;
	/** @default "auto" */
	flexBasis?: Dimension;

	/**
	 * The columns of a grid container's explicit grid. Columns an item needs
	 * beyond these are sized by {@link LayoutStyle.gridAutoColumns}.
	 * @default []
	 */
	gridTemplateColumns?: TrackList;
	/** The rows of a grid container's explicit grid. @default [] */
	gridTemplateRows?: TrackList;
	/**
	 * Sizes of the columns that are not in the explicit grid, repeating in
	 * order for as many as there are.
	 * @default ["auto"]
	 */
	gridAutoColumns?: readonly TrackSize[];
	/**
	 * Sizes of the rows that are not in the explicit grid, repeating in order
	 * for as many as there are.
	 * @default ["auto"]
	 */
	gridAutoRows?: readonly TrackSize[];
	/** How a grid container places the items that have no position of their own. @default "row" */
	gridAutoFlow?: GridAutoFlow;
	/** The columns a grid item occupies. @default automatic: one column */
	gridColumn?: GridPlacement;
	/** The rows a grid item occupies. @default automatic: one row */
	gridRow?: GridPlacement;
	/**
	 * How a grid container's items sit within their areas on the inline
	 * (horizontal) axis.
	 * @default "stretch"
	 */
	justifyItems?: JustifyItems;
	/** Overrides the container's `justifyItems` for one grid item. @default "auto" */
	justifySelf?: JustifySelf;
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
	// Parsed without a backtracking pattern: the number before the "%" must
	// be a plain decimal.
	const number = value.endsWith("%") ? value.slice(0, -1) : "";
	if (!/^-?[\d.]+$/.test(number) || !Number.isFinite(Number(number))) {
		throw new RangeError(`layout: cannot read "${value}"`);
	}
	return { kind: "percent", value: Number(number) / 100 };
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
	/** `undefined` when unset: a flex container packs to the start, a grid stretches. */
	justifyContent: JustifyContent | undefined;
	alignItems: AlignItems;
	alignSelf: AlignSelf;
	alignContent: AlignContent;
	gap: Size<Resolved>;
	flexGrow: number;
	flexShrink: number;
	flexBasis: Resolved;
	gridTemplateColumns: ParsedTemplate;
	gridTemplateRows: ParsedTemplate;
	gridAutoColumns: ParsedTrack[];
	gridAutoRows: ParsedTrack[];
	gridAutoFlow: GridAutoFlow;
	gridColumn: ParsedPlacement;
	gridRow: ParsedPlacement;
	justifyItems: JustifyItems;
	justifySelf: JustifySelf;
}

/**
 * One end of a parsed track size.
 *
 * @internal
 */
export type ParsedBreadth =
	| { kind: "length"; value: number }
	| { kind: "percent"; value: number }
	| { kind: "auto" }
	| { kind: "min-content" }
	| { kind: "max-content" }
	| { kind: "fr"; value: number }
	| { kind: "fit-content"; limit: Resolved };

/**
 * A parsed track size.
 *
 * @internal
 */
export interface ParsedTrack {
	min: ParsedBreadth;
	max: ParsedBreadth;
}

/**
 * A parsed track list: tracks and repeats, in order.
 *
 * @internal
 */
export type ParsedTemplate = readonly (
	| { kind: "track"; track: ParsedTrack }
	| {
			kind: "repeat";
			count: number | "auto-fill" | "auto-fit";
			tracks: ParsedTrack[];
	  }
)[];

/**
 * A grid placement along one axis: every part optional, lines nonzero integers.
 *
 * @internal
 */
export interface ParsedPlacement {
	start?: number;
	end?: number;
	span?: number;
}

const AUTO_BREADTH: ParsedBreadth = { kind: "auto" };

function parseBreadth(value: TrackBreadth): ParsedBreadth {
	if (typeof value === "object") {
		if (!(value.fr >= 0) || !Number.isFinite(value.fr)) {
			throw new RangeError("layout: a fraction must be a finite number ≥ 0");
		}
		return { kind: "fr", value: value.fr };
	}
	if (value === "min-content" || value === "max-content") {
		return { kind: value };
	}
	const parsed = parseDimension(value);
	if (parsed.kind === "length" && parsed.value < 0) {
		throw new RangeError("layout: a track size cannot be negative");
	}
	return parsed;
}

function parseTrack(value: TrackSize): ParsedTrack {
	if (typeof value === "object" && "minmax" in value) {
		const [min, max] = value.minmax;
		return { min: parseBreadth(min), max: parseBreadth(max) };
	}
	if (typeof value === "object" && "fitContent" in value) {
		const limit = parseDimension(value.fitContent);
		if (limit.kind === "auto") {
			throw new RangeError("layout: fitContent needs a length");
		}
		return { min: AUTO_BREADTH, max: { kind: "fit-content", limit } };
	}
	const breadth = parseBreadth(value);
	// A fraction is minmax(auto, fr); every other size is both ends.
	return { min: breadth.kind === "fr" ? AUTO_BREADTH : breadth, max: breadth };
}

function parseTemplate(list: TrackList | undefined): ParsedTemplate {
	return (list ?? []).map((entry) => {
		if (typeof entry === "object" && "repeat" in entry) {
			const { repeat } = entry;
			if (
				typeof repeat === "number" &&
				!(Number.isInteger(repeat) && repeat >= 1)
			) {
				throw new RangeError("layout: a repeat count must be an integer ≥ 1");
			}
			return {
				kind: "repeat" as const,
				count: repeat,
				tracks: entry.tracks.map(parseTrack),
			};
		}
		return { kind: "track" as const, track: parseTrack(entry) };
	});
}

function parseAutoTracks(
	list: readonly TrackSize[] | undefined,
): ParsedTrack[] {
	const tracks = (list ?? []).map(parseTrack);
	return tracks.length > 0
		? tracks
		: [{ min: AUTO_BREADTH, max: AUTO_BREADTH }];
}

function parsePlacement(value: GridPlacement | undefined): ParsedPlacement {
	if (value === undefined) return {};
	const placement = typeof value === "number" ? { start: value } : value;
	for (const line of [placement.start, placement.end]) {
		if (line !== undefined && !(Number.isInteger(line) && line !== 0)) {
			throw new RangeError("layout: a grid line must be a nonzero integer");
		}
	}
	if (
		placement.span !== undefined &&
		!(Number.isInteger(placement.span) && placement.span >= 1)
	) {
		throw new RangeError("layout: a grid span must be an integer ≥ 1");
	}
	return { ...placement };
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
		justifyContent: style.justifyContent,
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
		gridTemplateColumns: parseTemplate(style.gridTemplateColumns),
		gridTemplateRows: parseTemplate(style.gridTemplateRows),
		gridAutoColumns: parseAutoTracks(style.gridAutoColumns),
		gridAutoRows: parseAutoTracks(style.gridAutoRows),
		gridAutoFlow: style.gridAutoFlow ?? "row",
		gridColumn: parsePlacement(style.gridColumn),
		gridRow: parsePlacement(style.gridRow),
		justifyItems: style.justifyItems ?? "stretch",
		justifySelf: style.justifySelf ?? "auto",
	};
}
