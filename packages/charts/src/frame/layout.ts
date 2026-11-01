/**
 * How much room a `chart`'s guides take around its plot, and so the plot's
 * size and centre: pure measurements (text measured through `measureLabel`)
 * and {@link createChartLayout}, which wires them to the frame with caches
 * so a frame of a transition re-measures nothing it measured before.
 */

import type {
	AxisOptions,
	XAxisPosition,
	YAxisPosition,
} from "@sophistry/core";
import { axisPositionValue, crossingValue } from "@sophistry/core";
import type {
	BandKey,
	BandScale,
	Bounds,
	Point,
	Range,
	RangeTransition,
} from "@sophistry/core/geometry";
import { isRangeTransition } from "@sophistry/core/geometry";
import {
	axisFacesFar,
	clamp01,
	measureAxisNumbers,
} from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import { colorbarWidth } from "../guides/colorbar.js";
import { measureLegend } from "../guides/legend.js";
import type { SizeKeyMeasures, SizeKeysEnds } from "../guides/size-legend.js";
import {
	flowSizeKeys,
	measureSizeKeyExtents,
	sameOffsets,
	sameSizeKeyMeasures,
	sameSizeKeysEnds,
	sizeKeyOffsets,
} from "../guides/size-legend.js";
import type { JoinStages, StageWindow } from "../math/join.js";
import { textWidth } from "../text-width.js";
import { keyedMemo, shallowEqual, stableValue } from "../util.js";
import type {
	AxisSwap,
	FittedTransition,
	GivenRange,
	MergedAxisOptions,
	ResolvedAxis,
} from "./fit.js";
import {
	AXIS_LABEL_FONT_SIZE,
	AXIS_LABEL_GAP,
	COLORBAR_THICKNESS,
	halfLine,
	KEYS_GAP,
	type KeyEnds,
	type KeyExtent,
	keyExtentNow,
	LEGEND_GAP,
	sameKeyEnds,
	sameKeyExtent,
	TITLE_FONT_SIZE,
	TITLE_GAP,
} from "./guide-metrics.js";
import type { ChartKeys, FrameLegendEntry } from "./keys.js";
import type {
	ChartLayerExtent,
	ChartMargin,
	ChartProps,
	ChartSide,
} from "./types.js";

/** A category name's font size when the axis gives none. */
export const DEFAULT_CATEGORY_FONT_SIZE = 0.28;
/** The gap between a band axis's line and its names when the axis gives none. */
export const DEFAULT_CATEGORY_NUMBER_GAP = 0.16;
/** The subtitle's font size when none is given. */
export const DEFAULT_SUBTITLE_FONT_SIZE = 0.3;
/** The gap between the title and the subtitle under it. */
export const SUBTITLE_GAP = 0.14;
/** The least of `width` (or `height`) the plot keeps when the guides beside it would take more. */
export const MIN_PLOT_SHARE = 0.4;
/** The sides of the plotting area, in the order margins are read. */
const SIDES = ["top", "right", "bottom", "left"] as const;

/** Room on the two sides of one axis of the plot. */
export interface Sides {
	low: number;
	high: number;
}

/* ------------------------------------------------------------ measurement */

/** The widest category name a band axis writes, in scene units; 0 when it writes none. */
export function bandNamesWidth(
	options: MergedAxisOptions,
	band: BandScale,
	fontFamily: string,
): number {
	const size = options.numberFontSize ?? DEFAULT_CATEGORY_FONT_SIZE;
	let width = 0;
	band.domain.forEach((key, index) => {
		const text = options.categoryLabel?.(key, index) ?? String(key);
		if (text) width = Math.max(width, textWidth(text, size, fontFamily));
	});
	return width;
}

/** The chart-only keys stripped, for an axis's options to reach `numberLine`. */
export function numberLineOptions(options: MergedAxisOptions): AxisOptions {
	const {
		scale,
		categories: _categories,
		categoryLabel: _categoryLabel,
		padding: _padding,
		zero: _zero,
		nice: _nice,
		margin: _margin,
		reverse: _reverse,
		clamp: _clamp,
		slot: _slot,
		visible: _visible,
		line: _line,
		position: _position,
		zeroLine: _zeroLine,
		...rest
	} = options as MergedAxisOptions & { alignTicks?: boolean };
	delete (rest as { alignTicks?: boolean }).alignTicks;
	return { ...rest, scale: scale === "band" ? undefined : scale };
}

/** What an axis's `numberLine` is given: the transition while one runs, else the resolved range. */
export function axisRange(
	given: Range | RangeTransition | undefined,
	resolved: Range,
): Range | RangeTransition {
	return isRangeTransition(given) ? given : resolved;
}

/* ------------------------------------------------------------- pure rooms */

/**
 * Two ends' rooms mixed at `t`; a group's panel keeps the larger, since the
 * group's grid holds still through a transition.
 */
export function mixRoom(
	from: number,
	to: number,
	t: number,
	grouped: boolean,
): number {
	if (from === to) return from;
	if (grouped) return Math.max(from, to);
	return from + (to - from) * t;
}

/** A room measured at a range, or at each end of a range transition and mixed by its progress. */
export function roomOver(
	range: Range | RangeTransition,
	measure: (at: Range) => number,
	grouped: boolean,
): number {
	if (!isRangeTransition(range)) return measure(range);
	return mixRoom(
		measure(range.from),
		measure(range.to),
		clamp01(range.t),
		grouped,
	);
}

/** Whether an axis's line stands on the plot's low edge (bottom, left), where its numbers hang outside. */
export function atLowEdge(
	position: XAxisPosition | YAxisPosition,
	band: boolean,
	other: Range,
	otherBand: boolean,
): boolean {
	if (band && position === "zero") return true;
	const at =
		position === "zero"
			? otherBand
				? Math.min(other[0], other[1])
				: crossingValue(other)
			: axisPositionValue(position, other);
	return at === other[0];
}

/** The layers' reserved margins: the widest request per side. */
export function widestMargins(
	reports: readonly ChartLayerExtent[],
): Required<ChartMargin> {
	const sides = { top: 0, right: 0, bottom: 0, left: 0 };
	for (const report of reports) {
		const own = report.margin;
		if (!own) continue;
		for (const side of SIDES)
			sides[side] = Math.max(sides[side], own[side] ?? 0);
	}
	return sides;
}

/**
 * The keys on the right: the legend, then the size keys under it, or beside
 * it when the two stacked would run past `maxHeight` (read only then).
 */
export function keysColumnOf(
	legend: KeyExtent | undefined,
	size: KeyExtent | undefined,
	maxHeight: () => number,
): (KeyExtent & { beside: boolean }) | undefined {
	if (!legend && !size) return undefined;
	if (!legend || !size) {
		const only = (legend ?? size) as KeyExtent;
		return { ...only, beside: false };
	}
	// The gaps between the keys go with either when its end lists nothing.
	const both = legend.presence * size.presence;
	const presence = Math.max(legend.presence, size.presence);
	const stacked = legend.height + KEYS_GAP * both + size.height;
	return stacked <= maxHeight()
		? {
				width: Math.max(legend.width, size.width),
				height: stacked,
				presence,
				beside: false,
			}
		: {
				width: legend.width + LEGEND_GAP * both + size.width,
				height: Math.max(legend.height, size.height),
				presence,
				beside: true,
			};
}

/** The keys above the plot: the legend's rows, then the size key's under them. */
export function keysRowOf(
	legend: KeyExtent | undefined,
	size: KeyExtent | undefined,
): KeyExtent | undefined {
	if (!legend && !size) return undefined;
	return {
		width: Math.max(legend?.width ?? 0, size?.width ?? 0),
		height:
			(legend?.height ?? 0) +
			(legend && size ? KEYS_GAP * legend.presence * size.presence : 0) +
			(size?.height ?? 0),
		presence: Math.max(legend?.presence ?? 0, size?.presence ?? 0),
	};
}

/** The room keys above the plot take: the gap before them (as present as they are) and their rows. */
export function keysRoom(keys: KeyExtent | undefined): number {
	return LEGEND_GAP * (keys?.presence ?? 1) + (keys?.height ?? 0);
}

/** The room the title and subtitle take above everything else, with the gap under them. */
export function headingRoom(heading: {
	title?: string;
	titleFontSize?: number;
	subtitle?: string;
	subtitleFontSize?: number;
}): number {
	const subtitle = heading.subtitle
		? (heading.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE) * 1.2
		: 0;
	const title = heading.title
		? (heading.titleFontSize ?? TITLE_FONT_SIZE) * 1.2 +
			(subtitle > 0 ? SUBTITLE_GAP : 0)
		: 0;
	return title + subtitle > 0 ? TITLE_GAP + title + subtitle : 0;
}

/** The plot's extent along one axis: what `total` leaves after the guides, down to `MIN_PLOT_SHARE` of it. */
export function plotExtent(total: number, sides: Sides): number {
	return Math.max(total * MIN_PLOT_SHARE, total - sides.low - sides.high);
}

/** How far the plot's centre sits from the footprint's: toward the side with less room. */
export function centerOffset(shrink: number, sides: Sides): number {
	const total = sides.low + sides.high;
	return total > 0 ? (shrink * (sides.low - sides.high)) / (2 * total) : 0;
}

/**
 * A side's reserved margin in scene units: the band beside `box`, past
 * `numbers` (that side's axis numbers), `depth` deep.
 */
export function marginBand(
	box: Bounds,
	side: ChartSide,
	depth: number,
	numbers: number,
): Bounds {
	switch (side) {
		case "top": {
			const minY = box.maxY + numbers;
			return { ...box, minY, maxY: minY + depth };
		}
		case "bottom": {
			const maxY = box.minY - numbers;
			return { ...box, minY: maxY - depth, maxY };
		}
		case "right": {
			const minX = box.maxX + numbers;
			return { ...box, minX, maxX: minX + depth };
		}
		default: {
			const maxX = box.minX - numbers;
			return { ...box, minX: maxX - depth, maxX };
		}
	}
}

/* ------------------------------------------------------------------ wiring */

/** One primary axis as the layout reads it. */
export interface LayoutAxis {
	options: MergedAxisOptions;
	axis: ResolvedAxis;
	given: GivenRange;
	range: Range;
	fitted: FittedTransition | undefined;
}

/** One secondary axis as the layout reads it. */
export interface LayoutSecondaryAxis {
	options: MergedAxisOptions;
	axis: ResolvedAxis;
	given: GivenRange;
	has: boolean;
}

/** What one update of a chart's layout reads. */
export interface ChartLayoutInput {
	props: Readonly<ChartProps>;
	theme: Theme;
	/** Whether the chart is a panel of a group. */
	grouped: boolean;
	reports: readonly ChartLayerExtent[];
	stage(pick: (stages: JoinStages) => StageWindow): number;
	x: LayoutAxis;
	y: LayoutAxis;
	x2: LayoutSecondaryAxis;
	y2: LayoutSecondaryAxis;
	axisBands: { x: boolean; y: boolean };
	keys: ChartKeys;
}

/** A chart's rooms, plot size and centre on one update. */
export interface ChartLayout {
	xPosition: XAxisPosition;
	yPosition: YAxisPosition;
	xFar: boolean;
	yFar: boolean;
	margin: Required<ChartMargin>;
	leftNumbersRoom: number;
	bottomNumbersRoom: number;
	rightNumbersRoom: number;
	y2NumbersRoom: number;
	topNumbersRoom: number;
	rightAxisRoom: number;
	topAxisRoom: number;
	legendColumn: KeyExtent | undefined;
	legendRow: KeyExtent | undefined;
	sizeColumn: KeyExtent | undefined;
	sizeRow: KeyExtent | undefined;
	sizeOffsets: readonly Point[];
	keysColumn: (KeyExtent & { beside: boolean }) | undefined;
	/** The frame's keys, laid out where they go: the column on the right, or the rows on top. */
	keysNow: KeyExtent | undefined;
	leftRoom: number;
	rightRoom: number;
	topRoom: number;
	bottomRoom: number;
	plotWidth: number;
	plotHeight: number;
	center: Point;
	titleSize: number;
}

/**
 * A chart's layout. Make one per chart in `setup`; call the result in every
 * update. Text is measured once per options and range (a range transition's
 * frames mix their ends' measurements), legends and keys once per entry list.
 */
export function createChartLayout(): (input: ChartLayoutInput) => ChartLayout {
	/** Each axis's numbers as measured at a range, kept per options object and range. */
	const numbersMeasured = new WeakMap<
		MergedAxisOptions,
		WeakMap<
			Range,
			{ fontFamily: string; room: ReturnType<typeof measureAxisNumbers> }
		>
	>();
	const bandNames = new WeakMap<
		MergedAxisOptions,
		WeakMap<BandScale, { fontFamily: string; width: number }>
	>();
	const legendColumnMemo = keyedMemo<KeyEnds | undefined>();
	const legendColumnStable = stableValue<KeyEnds | undefined>(sameKeyEnds);
	const legendRowMemo = keyedMemo<KeyEnds | undefined>();
	const legendRowStable = stableValue<KeyEnds | undefined>(sameKeyEnds);
	const sizeColumnMeasuresMemo = keyedMemo<SizeKeyMeasures | undefined>();
	const sizeColumnMeasuresStable = stableValue<SizeKeyMeasures | undefined>(
		sameSizeKeyMeasures,
	);
	const sizeColumnEndsStable = stableValue<SizeKeysEnds | undefined>(
		sameSizeKeysEnds,
	);
	const sizeColumnEndsMemo = keyedMemo<SizeKeysEnds | undefined>();
	const sizeRowMemo = keyedMemo<SizeKeysEnds | undefined>();
	const sizeRowStable = stableValue<SizeKeysEnds | undefined>(sameSizeKeysEnds);
	const offsetsStable = stableValue<readonly Point[]>((a, b) =>
		sameOffsets(a, b),
	);
	const colorbarMemo = keyedMemo<number>();
	const marginStable = stableValue<Required<ChartMargin>>(shallowEqual);
	const marginMemo = keyedMemo<Required<ChartMargin>>();
	const centerStable = stableValue<Point>(shallowEqual);

	return (input) => {
		const { props, grouped, stage, keys, x2, y2, axisBands } = input;
		const fontFamily = input.theme.defaults.fontFamily;
		const xOptions = input.x.options;
		const yOptions = input.y.options;

		const numbersAt = (options: MergedAxisOptions, at: Range) => {
			let byRange = numbersMeasured.get(options);
			if (!byRange) {
				byRange = new WeakMap();
				numbersMeasured.set(options, byRange);
			}
			const kept = byRange.get(at);
			if (kept?.fontFamily === fontFamily) return kept.room;
			const room = measureAxisNumbers(
				numberLineOptions(options),
				at,
				fontFamily,
			);
			byRange.set(at, { fontFamily, room });
			return room;
		};
		const namesWidth = (options: MergedAxisOptions, band: BandScale) => {
			let byBand = bandNames.get(options);
			if (!byBand) {
				byBand = new WeakMap();
				bandNames.set(options, byBand);
			}
			const kept = byBand.get(band);
			if (kept?.fontFamily === fontFamily) return kept.width;
			const width = bandNamesWidth(options, band, fontFamily);
			byBand.set(band, { fontFamily, width });
			return width;
		};

		/** Where each axis is drawn. */
		const xPosition = (xOptions.position ??
			(axisBands.x ? "edge" : "zero")) as XAxisPosition;
		const yPosition = (yOptions.position ??
			(axisBands.y ? "edge" : "zero")) as YAxisPosition;
		const xFar = axisFacesFar(xPosition);
		const yFar = axisFacesFar(yPosition);

		/** An axis changing kind: the two ends' rooms mixed as the axes cross-fade. */
		const swapRoom = (
			swap: AxisSwap,
			measure: (end: ResolvedAxis) => number,
		): number => mixRoom(measure(swap.from), measure(swap.to), swap.u, grouped);
		/** Room a y axis's numbers (or category names) take beside its line; 0 for an axis drawing none. */
		const yNumbersRoom = (
			options: MergedAxisOptions,
			axis: ResolvedAxis,
			given: Range | RangeTransition | undefined,
			fit?: FittedTransition,
		): number => {
			if (options.visible === false || options.numbers === false) return 0;
			if (fit?.kind === "swap")
				return swapRoom(fit, (end) => yNumbersRoom(options, end, undefined));
			if (axis.kind === "band") {
				const names = (band: BandScale) => {
					const width = namesWidth(options, band);
					return width > 0
						? (options.numberGap ?? DEFAULT_CATEGORY_NUMBER_GAP) + width
						: 0;
				};
				if (fit?.kind !== "band" || grouped) return names(axis.band);
				// Category names mix on the update stage.
				const from = names(fit.from);
				const to = names(fit.to);
				return from === to
					? from
					: from + (to - from) * stage((stages) => stages.update);
			}
			return roomOver(
				axisRange(given, axis.range),
				(at) => {
					const room = numbersAt(options, at);
					return room.width > 0 ? room.gap + room.width : 0;
				},
				grouped,
			);
		};
		/** Room an x axis's numbers (or names) take below or above its line. */
		const xNumbersRoomOf = (
			options: MergedAxisOptions,
			axis: ResolvedAxis,
			given: Range | RangeTransition | undefined,
		): number => {
			if (axis.kind === "band") {
				return (
					(options.numberGap ?? DEFAULT_CATEGORY_NUMBER_GAP) +
					(options.numberFontSize ?? DEFAULT_CATEGORY_FONT_SIZE) * 1.2
				);
			}
			return roomOver(
				axisRange(given, axis.range),
				(at) => {
					const room = numbersAt(options, at);
					return room.height > 0 ? room.gap + room.height : 0;
				},
				grouped,
			);
		};
		const xNumbersRoom = (): number => {
			if (xOptions.visible === false || xOptions.numbers === false) return 0;
			const fit = input.x.fitted;
			if (fit?.kind === "swap")
				return swapRoom(fit, (end) => xNumbersRoomOf(xOptions, end, undefined));
			return xNumbersRoomOf(xOptions, input.x.axis, input.x.given);
		};
		const margin = marginStable(
			marginMemo([input.reports], () => widestMargins(input.reports)),
		);
		/**
		 * Whether anything needs the room on the left and bottom: `"contain"`,
		 * a group laying panels out, or a margin there to place.
		 */
		const measuresLowSides = (side: "left" | "bottom") =>
			props.autosize === "contain" || grouped || margin[side] > 0;
		const leftNumbersRoom =
			measuresLowSides("left") &&
			!yFar &&
			atLowEdge(yPosition, axisBands.y, input.x.range, axisBands.x)
				? yNumbersRoom(yOptions, input.y.axis, input.y.given, input.y.fitted)
				: 0;
		const bottomNumbersRoom =
			measuresLowSides("bottom") &&
			!xFar &&
			atLowEdge(xPosition, axisBands.x, input.y.range, axisBands.y)
				? xNumbersRoom()
				: 0;
		const rightNumbersRoom = yFar
			? yNumbersRoom(yOptions, input.y.axis, input.y.given, input.y.fitted)
			: 0;
		const y2NumbersRoom = y2.has
			? yNumbersRoom(y2.options, y2.axis, y2.given)
			: 0;
		const x2NumbersRoom =
			!x2.has || x2.options.visible === false || x2.options.numbers === false
				? 0
				: xNumbersRoomOf(x2.options, x2.axis, x2.given);
		const topNumbersRoom = (xFar ? xNumbersRoom() : 0) + x2NumbersRoom;
		/** Room on the right before the legend and colour bar: right axes' numbers and the right margin. */
		const rightAxisRoom = rightNumbersRoom + y2NumbersRoom + margin.right;
		/** Room above the plot before the titles: a top axis's numbers and the top margin. */
		const topAxisRoom = topNumbersRoom + margin.top;

		/** The room a key takes now: see `keyExtentNow`. */
		const sizeNow = (ends: KeyEnds | undefined) =>
			keyExtentNow(ends, () => stage((stages) => stages.update));
		/** The legend's size at each end, measured as `legend` lays it out. */
		const legendSizes = (
			direction: "row" | "column",
			maxWidth?: number,
		): KeyEnds => {
			const measure = (entries: readonly FrameLegendEntry[]): KeyExtent => {
				// An end listing nothing has no legend: no room, no gap, no title.
				if (entries.length === 0) return { width: 0, height: 0, presence: 0 };
				const own = measureLegend(entries as never, {
					direction,
					maxWidth,
					title: props.legendTitle,
					fontSize: props.legendFontSize,
					fontFamily,
				});
				return { width: own.width, height: own.height, presence: 1 };
			};
			const all = keys.legendEntries;
			const ends = keys.legendEnds;
			if (!ends) return { from: measure(all), to: undefined };
			const listed = (list: readonly BandKey[]) => {
				const set = new Set(list);
				return all.filter(
					(entry) => entry.key === undefined || set.has(entry.key),
				);
			};
			const from = measure(listed(ends.from));
			const to = measure(listed(ends.to));
			return { from, to: sameKeyExtent(from, to) ? undefined : to };
		};
		const legendDeps = [
			keys.legendEntries,
			keys.legendEnds,
			props.legendTitle,
			props.legendFontSize,
			fontFamily,
		];
		const legendColumnEnds = legendColumnStable(
			legendColumnMemo([keys.legendPosition, ...legendDeps], () =>
				keys.legendPosition === "right" ? legendSizes("column") : undefined,
			),
		);
		const legendColumn = sizeNow(legendColumnEnds);
		/** The size keys at each end, measured as `sizeLegend` lays them out. */
		const sizeMeasures = (direction: "row" | "column", maxWidth?: number) => {
			const options = keys.sizeOptions;
			return measureSizeKeyExtents(keys.sizeKeys, {
				direction,
				maxWidth,
				title: options.title,
				values: options.values,
				fontSize: props.legendFontSize,
				format: options.format,
				fontFamily,
			});
		};
		const sizeDeps = [
			keys.sizeKeys,
			keys.sizeOptions,
			props.legendFontSize,
			fontFamily,
		];
		const titleSize = props.axisLabelFontSize ?? AXIS_LABEL_FONT_SIZE;
		const sizeColumnMeasures = sizeColumnMeasuresStable(
			sizeColumnMeasuresMemo([keys.sizePosition, ...sizeDeps], () =>
				keys.sizePosition === "right" ? sizeMeasures("column") : undefined,
			),
		);
		/** A title's width in scene units, as the frame writes it. */
		const titleWidth = (text: string) => textWidth(text, titleSize, fontFamily);

		/** The colour bar's width, with the gap before it; 0 without one. */
		const bar = keys.ramp;
		const colorbarRoom = colorbarMemo(
			[bar, props.colorbarLabel, fontFamily],
			() =>
				bar
					? LEGEND_GAP +
						colorbarWidth(
							{
								domain: bar.domain,
								scale: bar.scale,
								thickness: COLORBAR_THICKNESS,
								label: props.colorbarLabel,
							},
							fontFamily,
						)
					: 0,
		);

		/*
		 * The plot's height feeds the size keys' columns, and the keys'
		 * width feeds the plot's width under `"fit"`/`"contain"`; the height
		 * depends only on the top and bottom rooms (never the right column),
		 * so it is worked out first.
		 */
		const axisTitles =
			props.yLabel || (y2.has && props.y2Label)
				? titleSize + AXIS_LABEL_GAP
				: 0;
		const bottomRoom = bottomNumbersRoom + margin.bottom;
		// The top row's legend needs the plot's width, which needs the right
		// column, which needs the plot's height: rows on top only come with
		// `legend: "top"`, when there is no column, so the column is laid out
		// with the height first.
		const heightWithoutTopKeys = (topKeys: number) =>
			plotExtent(
				props.height,
				props.autosize === "contain"
					? {
							low: bottomRoom,
							high: topAxisRoom + axisTitles + topKeys + headingRoom(props),
						}
					: { low: 0, high: 0 },
			);

		let plotHeight = heightWithoutTopKeys(0);
		/** How tall the keys on the right may run: down to where an x axis's title ends. */
		const keysHeightOf = (height: number) =>
			height - (props.xLabel ? halfLine(titleSize) + AXIS_LABEL_GAP : 0);
		/** The size keys' stack on the right at each end, flowing into columns past `keysHeight`. */
		const sizeColumnEnds = sizeColumnEndsStable(
			sizeColumnEndsMemo(
				[sizeColumnMeasures, plotHeight, props.xLabel, titleSize],
				() =>
					sizeColumnMeasures
						? flowSizeKeys(sizeColumnMeasures, KEYS_GAP, {
								maxHeight: keysHeightOf(plotHeight),
								gap: LEGEND_GAP,
							})
						: undefined,
			),
		);
		const sizeColumn = sizeNow(sizeColumnEnds);
		const keysColumn = keysColumnOf(legendColumn, sizeColumn, () =>
			keysHeightOf(plotHeight),
		);
		/** The guides on the right, out to the colour bar: what `"fit"` reserves. */
		const rightGuides =
			rightAxisRoom +
			(keysColumn ? LEGEND_GAP * keysColumn.presence + keysColumn.width : 0) +
			colorbarRoom;
		/** Left of the plot: the y axis's numbers on the left edge, half its title, and the left margin. */
		const leftRoom =
			Math.max(
				leftNumbersRoom,
				props.yLabel && leftNumbersRoom > 0 ? titleWidth(props.yLabel) / 2 : 0,
			) + margin.left;
		/** Right of the plot: the guides, or an x axis's title past them, or half the secondary y axis's title. */
		const xTitle =
			props.xLabel && xOptions.visible !== false
				? rightAxisRoom + AXIS_LABEL_GAP + titleWidth(props.xLabel)
				: 0;
		const y2Title = y2.has && props.y2Label ? titleWidth(props.y2Label) / 2 : 0;
		const x2Title =
			x2.has && props.x2Label && x2.options.visible !== false
				? rightAxisRoom + AXIS_LABEL_GAP + titleWidth(props.x2Label)
				: 0;
		const rightRoom = Math.max(rightGuides, xTitle, y2Title, x2Title);
		/**
		 * The room given up across the plot: under `"fit"` the guides on its
		 * right, under `"contain"` every side, under `"pad"` none.
		 */
		const sidesX: Sides =
			props.autosize === "pad"
				? { low: 0, high: 0 }
				: props.autosize !== "contain"
					? { low: 0, high: rightGuides }
					: { low: leftRoom, high: rightRoom };
		const plotWidth = plotExtent(props.width, sidesX);
		const legendRowEnds = legendRowStable(
			legendRowMemo([keys.legendPosition, plotWidth, ...legendDeps], () =>
				keys.legendPosition === "top"
					? legendSizes("row", plotWidth)
					: undefined,
			),
		);
		const legendRow = sizeNow(legendRowEnds);
		/** The size keys' stack on top at each end: one key's rows under another's. */
		const sizeRowEnds = sizeRowStable(
			sizeRowMemo([keys.sizePosition, plotWidth, ...sizeDeps], () =>
				keys.sizePosition === "top"
					? flowSizeKeys(sizeMeasures("row", plotWidth), KEYS_GAP)
					: undefined,
			),
		);
		const sizeRow = sizeNow(sizeRowEnds);
		const keysRow = keysRowOf(legendRow, sizeRow);
		/** Above the plot: a top axis's numbers and margin, the y axes' titles, a top legend and the heading. */
		const topKeys = keys.guidesPosition === "top" ? keysRoom(keysRow) : 0;
		const topRoom = topAxisRoom + axisTitles + topKeys + headingRoom(props);
		if (topKeys !== 0) plotHeight = heightWithoutTopKeys(topKeys);
		const sidesY: Sides =
			props.autosize === "contain"
				? { low: bottomRoom, high: topRoom }
				: { low: 0, high: 0 };
		/** Each size key's place in the stack now, blended on the update stage. */
		const sizeOffsets = offsetsStable(
			sizeKeyOffsets(
				sizeColumnEnds ?? sizeRowEnds,
				stage((stages) => stages.update),
			),
		);
		const given = props.center ?? { x: 0, y: 0 };
		const dx = centerOffset(props.width - plotWidth, sidesX);
		const dy = centerOffset(props.height - plotHeight, sidesY);
		const center = centerStable(
			dx === 0 && dy === 0 ? given : { x: given.x + dx, y: given.y + dy },
		);
		return {
			xPosition,
			yPosition,
			xFar,
			yFar,
			margin,
			leftNumbersRoom,
			bottomNumbersRoom,
			rightNumbersRoom,
			y2NumbersRoom,
			topNumbersRoom,
			rightAxisRoom,
			topAxisRoom,
			legendColumn,
			legendRow,
			sizeColumn,
			sizeRow,
			sizeOffsets,
			keysColumn,
			keysNow: keysColumn ?? keysRow,
			leftRoom,
			rightRoom,
			topRoom,
			bottomRoom,
			plotWidth,
			plotHeight,
			center,
			titleSize,
		};
	};
}
