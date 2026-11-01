/**
 * What a `chart` draws around its layers: the grid, zero lines, axes
 * (number lines and band axes, with a kind swap's ghost), titles, the colour
 * bar, the legend and the size keys.
 *
 * {@link createChartGuides} is made once per chart; its function runs in
 * every chart update, keeps each guide's node by role (writing props into
 * it rather than rebuilding it) and returns the nodes in paint order.
 */

import type {
	AxisOptions,
	CompositeContext,
	CoordinateSystem,
	SceneNode,
	XAxisPosition,
	YAxisPosition,
} from "@sophistry/core";
import {
	axisPositionValue,
	crossingValue,
	LEFT,
	label,
	line,
	measuresText,
	numberLine,
	RIGHT,
	UP,
} from "@sophistry/core";
import type {
	Point,
	Range,
	RangeTransition,
	WeightedTick,
} from "@sophistry/core/geometry";
import {
	anchoredLabelProps,
	axisFacesFar,
	axisTicksAt,
	contains,
	DEFAULT_GRID_OPACITY,
	DEFAULT_GRID_STROKE_WIDTH,
	DEFAULT_GRID_Z_INDEX,
	fullOptions,
	gridLineNodes,
	originBlocks,
	originFade,
	originWeight as originWeightOf,
	resolveOrigin,
	stablePoint,
	weightedTicks,
	writesOrigin,
	yieldOrigin,
} from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import { colorbar } from "../guides/colorbar.js";
import { legend } from "../guides/legend.js";
import { sizeKeyStack } from "../guides/size-legend.js";
import type { JoinStages, StageWindow } from "../math/join.js";
import { keyedMemo } from "../util.js";
import { bandAxis } from "./band-axis.js";
import type { ChartCoords } from "./coords.js";
import type {
	AxisEnds,
	AxisSwapView,
	FittedTransition,
	GivenRange,
	MergedAxisOptions,
	ResolvedAxis,
} from "./fit.js";
import { bandWeight } from "./fit.js";
import {
	AXIS_LABEL_GAP,
	COLORBAR_THICKNESS,
	halfLine,
	KEYS_GAP,
	LEGEND_GAP,
	TITLE_FONT_SIZE,
	TITLE_GAP,
} from "./guide-metrics.js";
import type { ChartKeys } from "./keys.js";
import type { ChartLayout } from "./layout.js";
import {
	axisRange,
	DEFAULT_SUBTITLE_FONT_SIZE,
	keysRoom,
	numberLineOptions,
	SUBTITLE_GAP,
} from "./layout.js";
import type { ChartLayerExtent, ChartProps } from "./types.js";

/** One primary axis as the guides draw it. */
export interface GuideAxis {
	options: MergedAxisOptions;
	axis: ResolvedAxis;
	range: Range;
	given: GivenRange;
	fitted: FittedTransition | undefined;
	ends: AxisEnds | undefined;
	/** A kind swap's cross-fade (see `createAxisSwap`). */
	swap: AxisSwapView;
}

/** One secondary axis as the guides draw it. */
export interface GuideSecondaryAxis {
	has: boolean;
	options: MergedAxisOptions;
	given: GivenRange;
	range: Range;
}

/** The frame state the guides draw from on one update. */
export interface GuideFrame {
	props: Readonly<ChartProps>;
	theme: Theme;
	reports: readonly ChartLayerExtent[];
	x: GuideAxis;
	y: GuideAxis;
	x2: GuideSecondaryAxis;
	y2: GuideSecondaryAxis;
	axisZeros: {
		xSpans: boolean;
		ySpans: boolean;
		xFrom: boolean;
		yFrom: boolean;
	};
	axisBands: { x: boolean; y: boolean };
	stage(pick: (stages: JoinStages) => StageWindow): number;
	layout: ChartLayout;
	keys: ChartKeys;
	coords: ChartCoords;
	frameProgress: number;
	legendProgress: number;
}

/** An axis's opacity faded by `fade` (a kind swap's cross-fade). */
const faded = (own: number | undefined, fade: number) =>
	fade >= 1 ? own : (own ?? 1) * fade;

/**
 * A continuous axis's major ticks: the ones it draws, cross-faded the same
 * way while a range transition runs. The grid stands on them.
 */
function majorTicks(
	axis: ResolvedAxis,
	options: MergedAxisOptions,
	given: Range | RangeTransition | undefined,
): WeightedTick[] {
	if (axis.kind !== "continuous") return [];
	const source = {
		scale: axis.scale,
		base: axis.base,
		timeZone: axis.timeZone,
		step: options.step,
	};
	return weightedTicks(
		(range) => axisTicksAt(source, range).majors,
		given,
		axis.range,
	);
}

/** A kind-swapping axis's grid: the continuous end's lines, fading with that end's axis. */
function swapGrid(
	axis: ResolvedAxis,
	ghost: ResolvedAxis,
	fade: number,
	options: MergedAxisOptions,
): WeightedTick[] {
	const [end, weight] =
		axis.kind === "continuous" ? [axis, fade] : [ghost, 1 - fade];
	return majorTicks(end, options, undefined).flatMap((tick) =>
		tick.weight * weight > 0
			? [{ value: tick.value, weight: tick.weight * weight }]
			: [],
	);
}

/** No grid lines. */
const NO_TICKS: WeightedTick[] = [];

/**
 * The frame's guides. Make one per chart in `setup`; call the result in
 * every update with the chart's context and frame state.
 */
export function createChartGuides(): (
	ctx: CompositeContext<ChartProps>,
	frame: GuideFrame,
) => SceneNode[] {
	/** Kept guide nodes by role, with the definition that made each. */
	const slots = new Map<string, { definition: unknown; node: SceneNode }>();
	const gridX = keyedMemo<WeightedTick[]>();
	const gridY = keyedMemo<WeightedTick[]>();

	return (ctx, frame) => {
		measuresText(ctx);
		const { props: chart, theme, x, y, x2, y2, layout, keys, stage } = frame;
		const { axisZeros, axisBands, frameProgress, legendProgress } = frame;
		const { coords, ghostX, ghostY, ghostAt, swapOrigin, origin } =
			frame.coords;
		const { xAxisAt, yAxisAt, titlesAt, area } = frame.coords;
		const fontFamily = theme.defaults.fontFamily;
		const xOptions = x.options;
		const yOptions = y.options;
		const nodes: SceneNode[] = [];
		const used = new Set<string>();

		/** Creates or updates the node in `slot`, made by `definition`. */
		const keep = (
			slot: string,
			definition: { create(props: never): SceneNode },
			props: object,
		): SceneNode => {
			used.add(slot);
			let kept = slots.get(slot);
			if (kept && kept.definition !== definition) kept = undefined;
			if (kept) kept.node.update(props as never);
			else {
				kept = { definition, node: definition.create(props as never) };
				slots.set(slot, kept);
			}
			nodes.push(kept.node);
			return kept.node;
		};
		/**
		 * A prop of the node last kept in `slot`, or undefined when there is
		 * none or it has no such prop (an axis that changed kind, e.g. a band
		 * axis in the slot a number line now takes, as a scrub swaps them).
		 */
		const previous = (slot: string, key: string) => {
			const kept = slots.get(slot);
			const descriptor = (
				kept?.definition as { descriptor?: Record<string, unknown> } | undefined
			)?.descriptor;
			return (
				descriptor && key in descriptor
					? kept?.node.get(key as never)
					: undefined
			) as never;
		};

		/**
		 * Whether the plain chart at one end of a kind swap hides the y axis's
		 * "0": both axes continuous, spanning 0 and standing at 0, the x axis
		 * writing its "0".
		 */
		const hidesOriginAt = (xEnd: ResolvedAxis, yEnd: ResolvedAxis): boolean => {
			if (
				xOptions.visible === false ||
				!writesOrigin(xOptions) ||
				xEnd.kind !== "continuous" ||
				yEnd.kind !== "continuous" ||
				!contains(xEnd.range, 0) ||
				!contains(yEnd.range, 0)
			)
				return false;
			const at = (position: XAxisPosition | YAxisPosition, other: Range) =>
				position === "zero"
					? crossingValue(other)
					: axisPositionValue(position, other);
			return (
				at(xOptions.position ?? "zero", yEnd.range) === 0 &&
				at(yOptions.position ?? "zero", xEnd.range) === 0
			);
		};
		/**
		 * `originWeight` mid-swap, so the y axis's "0" fades instead of
		 * popping at the midpoint. When x swaps the two ends' rules mix by the
		 * update stage; when y swaps, its continuous end's rule holds.
		 */
		const swapOriginState = ():
			| { weight: number; share: number; end: "from" | "to" }
			| undefined => {
			const swap = frame.coords.kindSwap;
			if (!swap) return undefined;
			const endOf = (end: "from" | "to") =>
				hidesOriginAt(x.ends?.[end] ?? x.axis, y.ends?.[end] ?? y.axis);
			const from = endOf("from");
			const to = endOf("to");
			if (from === to) return undefined;
			const u = stage((stages) => stages.update);
			if (!(u > 0 && u < 1)) return undefined;
			/** How far the end where the axes cross is in effect. */
			const share = from ? 1 - u : u;
			return { weight: swap.y ? 1 : share, share, end: from ? "from" : "to" };
		};
		const swapping = swapOriginState();
		/**
		 * How strongly the x axis shows a "0" exactly where the y axis's "0"
		 * would be, 0..1; the y axis's own fades by as much.
		 */
		const originWeight =
			swapping?.weight ??
			(xOptions.visible === false
				? 0
				: originWeightOf(
						xOptions,
						() =>
							axisZeros.xSpans &&
							axisZeros.ySpans &&
							xAxisAt === 0 &&
							yAxisAt === 0,
						x.given,
						(given) => majorTicks(x.axis, xOptions, given),
					));
		/** Whether a layer covers the plotting area, so the axes' text gets a halo. */
		const covered = frame.reports.some((report) => report.covers);
		/**
		 * An axis's halo: its own `numberHalo`, else on over a covering layer
		 * (numbers coloured by the axis's `stroke` keep the contrast it chose).
		 */
		const haloOf = (
			options: MergedAxisOptions,
			numbers = false,
		): AxisOptions["numberHalo"] =>
			options.numberHalo ??
			(covered && !(numbers && options.stroke !== undefined)
				? true
				: undefined);
		/** An axis's `numberLine` options with the halo resolved. */
		const haloed = (
			options: AxisOptions,
			from: MergedAxisOptions,
		): AxisOptions => {
			const halo = haloOf(from, true);
			return halo === options.numberHalo
				? options
				: { ...options, numberHalo: halo };
		};
		const xMerged = haloed(numberLineOptions(xOptions), xOptions);
		const xFaced: AxisOptions =
			layout.xFar && xMerged.numberDirection === undefined
				? { ...xMerged, numberDirection: UP }
				: xMerged;
		const yMerged = haloed(numberLineOptions(yOptions), yOptions);
		const yDirection = yMerged.numberDirection ?? (layout.yFar ? RIGHT : LEFT);
		/**
		 * Neither "0" is written where the other axis's line runs through it. Mid-swap, read at the
		 * end where the axes cross and eased in with it, so the hand-over fades.
		 */
		const blocksAt = (xRange: Range, yRange: Range) =>
			originBlocks(xRange, yRange, xFaced.numberDirection, yDirection);
		const originRule = swapping
			? (() => {
					const xEnd = x.ends?.[swapping.end] ?? x.axis;
					const yEnd = y.ends?.[swapping.end] ?? y.axis;
					const blocks = blocksAt(xEnd.range, yEnd.range);
					// A swapping axis writes a "0" only at its continuous end, so its
					// block holds whole; the other's eases in with the crossing end.
					const swap = frame.coords.kindSwap;
					return resolveOrigin(true, originWeight, {
						x: swap?.x ? blocks.x : blocks.x * swapping.share,
						y: swap?.y ? blocks.y : blocks.y * swapping.share,
					});
				})()
			: resolveOrigin(
					axisZeros.xSpans &&
						axisZeros.ySpans &&
						xAxisAt === 0 &&
						yAxisAt === 0,
					originWeight,
					blocksAt(x.range, y.range),
				);
		const yLineOptions: AxisOptions = {
			numberDirection: layout.yFar ? RIGHT : LEFT,
			...yieldOrigin(yMerged, originFade(originRule.yYield)),
		};
		const xLineOptions: AxisOptions =
			originRule.xYield > 0
				? yieldOrigin(xFaced, originFade(originRule.xYield))
				: xFaced;
		/** The secondary y axis: numbers on the right, facing out. */
		const y2LineOptions: AxisOptions = {
			numberDirection: RIGHT,
			...haloed(numberLineOptions(y2.options), y2.options),
		};
		/** The secondary x axis: numbers above the top edge, facing out. */
		const x2LineOptions: AxisOptions = {
			numberDirection: UP,
			...haloed(numberLineOptions(x2.options), x2.options),
		};
		/** A number line's props: every option written (unset ones too), plus the frame's. */
		const lineProps = (
			options: AxisOptions,
			extra: {
				range: Range | RangeTransition;
				length: number;
				center: Point;
				rotation?: number;
				opacity?: number;
			},
			slot: string,
		) => ({
			...fullOptions({
				tip: chart.tip,
				zIndex: chart.zIndex,
				visible: chart.visible,
				...options,
			}),
			...extra,
			opacity: "opacity" in extra ? extra.opacity : options.opacity,
			center: stablePoint(previous(slot, "center"), extra.center),
			rotation: extra.rotation ?? 0,
			progress: frameProgress,
		});

		/* ------------------------------------------------------------ grid */

		const gridOn = (axis: "x" | "y") =>
			chart.grid === true || chart.grid === axis;
		const gridXTicks = gridX(
			[gridOn("x"), x.axis, xOptions, x.given, x.swap.ghost, x.swap.fade],
			() => {
				if (!gridOn("x")) return NO_TICKS;
				const ghost = x.swap.ghost;
				if (ghost) return swapGrid(x.axis, ghost, x.swap.fade, xOptions);
				return majorTicks(x.axis, xOptions, x.given);
			},
		);
		const gridYTicks = gridY(
			[gridOn("y"), y.axis, yOptions, y.given, y.swap.ghost, y.swap.fade],
			() => {
				if (!gridOn("y")) return NO_TICKS;
				const ghost = y.swap.ghost;
				if (ghost) return swapGrid(y.axis, ghost, y.swap.fade, yOptions);
				return majorTicks(y.axis, yOptions, y.given);
			},
		);
		/** What the grid lines are placed through: the plot's mapping, or a continuous ghost's. */
		const gridXCoords: CoordinateSystem =
			x.swap.ghost?.kind === "continuous" ? ghostX : coords;
		const gridYCoords: CoordinateSystem =
			y.swap.ghost?.kind === "continuous" ? ghostY : coords;
		const gridStyle = {
			area,
			opacity: DEFAULT_GRID_OPACITY,
			stroke: chart.gridColor ?? theme.palette.grid,
			strokeWidth: DEFAULT_GRID_STROKE_WIDTH,
			zIndex: (chart.zIndex ?? 0) + DEFAULT_GRID_Z_INDEX,
			visible: chart.visible,
			progress: frameProgress,
		};
		for (const node of gridLineNodes(ctx, "gridX", {
			...gridStyle,
			axis: "x",
			ticks: gridXTicks,
			place: (value) => gridXCoords.coordsToPoint(value, 0).x,
		}))
			nodes.push(node);
		for (const node of gridLineNodes(ctx, "gridY", {
			...gridStyle,
			axis: "y",
			ticks: gridYTicks,
			place: (value) => gridYCoords.coordsToPoint(0, value).y,
		}))
			nodes.push(node);

		/* ------------------------------------------------------- zero lines */

		/**
		 * A zero line along one continuous axis: where the other axis would
		 * stand at the crossing. Off when that axis is drawn there already,
		 * hidden, or a band axis without its line; an other axis at "zero"
		 * decides it from the options alone.
		 */
		const zeroLineOn = (
			axis: "x" | "y",
			options: MergedAxisOptions,
			other: MergedAxisOptions,
			otherBand: boolean,
			otherPosition: XAxisPosition | YAxisPosition,
			otherAt: number,
		): boolean => {
			if (options.zeroLine === false) return false;
			const otherDrawn =
				other.visible !== false && !(otherBand && other.line === false);
			if (otherDrawn && otherPosition === "zero") return false;
			if (!(axis === "x" ? axisZeros.xSpans : axisZeros.ySpans)) return false;
			if (otherDrawn && otherAt === 0) return false;
			if (options.zeroLine === true) return true;
			return otherDrawn && (axis === "x" ? axisZeros.xFrom : axisZeros.yFrom);
		};
		/** Styled as the axis line it stands in for. */
		const zeroLine = (moved: MergedAxisOptions) => ({
			stroke:
				typeof moved.stroke === "string"
					? moved.stroke
					: theme.palette.foreground,
			strokeWidth: moved.strokeWidth,
			zIndex: chart.zIndex,
			visible: chart.visible,
			progress: frameProgress,
		});
		const zero = coords.coordsToPoint(0, 0);
		if (
			zeroLineOn(
				"x",
				xOptions,
				yOptions,
				axisBands.y,
				layout.yPosition,
				yAxisAt,
			)
		)
			keep("zeroX", line, {
				...zeroLine(yOptions),
				from: stablePoint(previous("zeroX", "from"), {
					x: zero.x,
					y: area.minY,
				}),
				to: stablePoint(previous("zeroX", "to"), { x: zero.x, y: area.maxY }),
			});
		if (
			zeroLineOn(
				"y",
				yOptions,
				xOptions,
				axisBands.x,
				layout.xPosition,
				xAxisAt,
			)
		)
			keep("zeroY", line, {
				...zeroLine(xOptions),
				from: stablePoint(previous("zeroY", "from"), {
					x: area.minX,
					y: zero.y,
				}),
				to: stablePoint(previous("zeroY", "to"), { x: area.maxX, y: zero.y }),
			});

		/* ------------------------------------------------------------- axes */

		const bandProps = (
			band: NonNullable<ResolvedAxis & { kind: "band" }>["band"],
			options: MergedAxisOptions,
			own: {
				weight?: (key: never) => number;
				coords: CoordinateSystem;
				along: "x" | "y";
				at: number;
				across?: number;
				far: boolean;
				opacity: number;
			},
		) => ({
			band,
			weight: own.weight,
			options,
			halo: haloOf(options),
			coords: own.coords,
			along: own.along,
			at: own.at,
			across: own.across,
			far: own.far,
			opacity: own.opacity,
			progress: frameProgress,
			zIndex: chart.zIndex,
			visible: chart.visible,
		});
		if (xOptions.visible !== false) {
			if (x.axis.kind === "band")
				keep(
					"xAxis",
					bandAxis,
					bandProps(x.axis.band, xOptions, {
						weight: bandWeight(x.fitted, stage),
						coords,
						along: "x",
						at: xAxisAt,
						across: swapOrigin?.y2 ? origin.y : undefined,
						far: layout.xFar,
						opacity: x.swap.fade,
					}),
				);
			else
				keep(
					"xAxis",
					numberLine,
					lineProps(
						xLineOptions,
						{
							opacity: faded(xLineOptions.opacity, x.swap.fade),
							range: axisRange(x.given, x.range),
							length: layout.plotWidth,
							center: { x: layout.center.x, y: origin.y },
						},
						"xAxis",
					),
				);
			const ghost = x.swap.ghost;
			if (ghost) {
				if (ghost.kind === "band")
					keep(
						"xGhost",
						bandAxis,
						bandProps(ghost.band, xOptions, {
							coords: ghostX,
							along: "x",
							at: ghostAt("x", ghost),
							far: axisFacesFar(xOptions.position ?? "edge"),
							opacity: 1 - x.swap.fade,
						}),
					);
				else
					keep(
						"xGhost",
						numberLine,
						lineProps(
							xLineOptions,
							{
								opacity: faded(xLineOptions.opacity, 1 - x.swap.fade),
								range: ghost.range,
								length: layout.plotWidth,
								center: {
									x: layout.center.x,
									y: coords.coordsToPoint(0, ghostAt("x", ghost)).y,
								},
							},
							"xGhost",
						),
					);
			}
		}
		if (yOptions.visible !== false) {
			if (y.axis.kind === "band")
				keep(
					"yAxis",
					bandAxis,
					bandProps(y.axis.band, yOptions, {
						weight: bandWeight(y.fitted, stage),
						coords,
						along: "y",
						at: yAxisAt,
						across: swapOrigin?.x2 ? origin.x : undefined,
						far: layout.yFar,
						opacity: y.swap.fade,
					}),
				);
			else
				keep(
					"yAxis",
					numberLine,
					lineProps(
						yLineOptions,
						{
							opacity: faded(yLineOptions.opacity, y.swap.fade),
							range: axisRange(y.given, y.range),
							length: layout.plotHeight,
							center: { x: origin.x, y: layout.center.y },
							rotation: Math.PI / 2,
						},
						"yAxis",
					),
				);
			const ghost = y.swap.ghost;
			if (ghost) {
				if (ghost.kind === "band")
					keep(
						"yGhost",
						bandAxis,
						bandProps(ghost.band, yOptions, {
							coords: ghostY,
							along: "y",
							at: ghostAt("y", ghost),
							far: axisFacesFar(yOptions.position ?? "edge"),
							opacity: 1 - y.swap.fade,
						}),
					);
				else
					keep(
						"yGhost",
						numberLine,
						lineProps(
							yLineOptions,
							{
								opacity: faded(yLineOptions.opacity, 1 - y.swap.fade),
								range: ghost.range,
								length: layout.plotHeight,
								center: {
									x: coords.coordsToPoint(ghostAt("y", ghost), 0).x,
									y: layout.center.y,
								},
								rotation: Math.PI / 2,
							},
							"yGhost",
						),
					);
			}
		}

		/* ----------------------------------------------------------- titles */

		const labelColor = theme.palette.foreground;
		const labelSize = layout.titleSize;
		/** One anchored title in `slot`. */
		const title = (
			slot: string,
			text: string,
			options: {
				at: Point;
				direction: Point;
				gap: number;
				fontSize: number;
				color?: string;
				halo?: AxisOptions["numberHalo"];
			},
		) =>
			keep(
				slot,
				label,
				anchoredLabelProps(
					{
						text,
						at: options.at,
						direction: options.direction,
						gap: options.gap,
						fontSize: options.fontSize,
						color: options.color ?? labelColor,
						zIndex: chart.zIndex,
						progress: frameProgress,
						halo: options.halo,
					},
					fontFamily,
					previous(slot, "place"),
				),
			);
		if (chart.xLabel)
			title("xLabel", chart.xLabel, {
				at: { x: coords.coordsToPoint(x.range[1], 0).x, y: titlesAt.y },
				direction: RIGHT,
				// Past a right axis's numbers, which share the corner.
				gap: AXIS_LABEL_GAP + layout.rightAxisRoom,
				fontSize: labelSize,
				halo: haloOf(xOptions),
			});
		if (chart.yLabel)
			title("yLabel", chart.yLabel, {
				at: { x: titlesAt.x, y: coords.coordsToPoint(0, y.range[1]).y },
				direction: UP,
				// Above a top axis's numbers, which share the corner.
				gap: AXIS_LABEL_GAP + layout.topAxisRoom,
				fontSize: labelSize,
				halo: haloOf(yOptions),
			});
		if (y2.has && y2.options.visible !== false)
			keep(
				"y2Axis",
				numberLine,
				lineProps(
					y2LineOptions,
					{
						range: axisRange(y2.given, y2.range),
						length: layout.plotHeight,
						center: { x: area.maxX, y: layout.center.y },
						rotation: Math.PI / 2,
					},
					"y2Axis",
				),
			);
		if (y2.has && chart.y2Label)
			title("y2Label", chart.y2Label, {
				at: { x: area.maxX, y: area.maxY },
				direction: UP,
				gap: AXIS_LABEL_GAP + layout.topAxisRoom,
				fontSize: labelSize,
				halo: haloOf(y2.options),
			});
		if (x2.has && x2.options.visible !== false)
			keep(
				"x2Axis",
				numberLine,
				lineProps(
					x2LineOptions,
					{
						range: axisRange(x2.given, x2.range),
						length: layout.plotWidth,
						center: { x: layout.center.x, y: area.maxY },
					},
					"x2Axis",
				),
			);
		if (x2.has && x2.options.visible !== false && chart.x2Label)
			title("x2Label", chart.x2Label, {
				at: { x: area.maxX, y: area.maxY },
				direction: RIGHT,
				// Past a right axis's numbers, which share the corner.
				gap: AXIS_LABEL_GAP + layout.rightAxisRoom,
				fontSize: labelSize,
				halo: haloOf(x2.options),
			});
		/** How far above the plotting area the y axes' titles reach, if there are any. */
		const yLabelClearance =
			chart.yLabel || (y2.has && chart.y2Label)
				? labelSize + AXIS_LABEL_GAP
				: 0;
		/** Room the subtitle (or the title, without one) leaves under itself. */
		const titleClearance =
			layout.topAxisRoom +
			yLabelClearance +
			(keys.guidesPosition === "top" ? keysRoom(layout.keysNow) : 0);
		const subtitleSize = chart.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE;
		if (chart.title)
			title("title", chart.title, {
				at: { x: layout.center.x, y: area.maxY },
				direction: UP,
				// Clear the y axis's own title, a top legend, and the subtitle.
				gap:
					TITLE_GAP +
					titleClearance +
					(chart.subtitle ? subtitleSize + SUBTITLE_GAP : 0),
				fontSize: chart.titleFontSize ?? TITLE_FONT_SIZE,
			});
		if (chart.subtitle)
			title("subtitle", chart.subtitle, {
				at: { x: layout.center.x, y: area.maxY },
				direction: UP,
				gap: TITLE_GAP + titleClearance,
				fontSize: subtitleSize,
				color: theme.palette.muted,
			});

		/* ------------------------------------------------------------- keys */

		/** The legend's top-left corner: past a right axis's numbers, or above a top axis's and the y axis's title. */
		let legendAt: Point;
		if (keys.guidesPosition === "top") {
			legendAt = {
				x: area.minX,
				y:
					area.maxY +
					layout.topAxisRoom +
					yLabelClearance +
					keysRoom(layout.keysNow),
			};
		} else {
			// An x axis along the top ends in its title at the legend's corner:
			// start the column under it.
			const drop =
				(layout.xFar && chart.xLabel) || (x2.has && chart.x2Label)
					? halfLine(labelSize) + AXIS_LABEL_GAP
					: 0;
			legendAt = {
				x: area.maxX + layout.rightAxisRoom + LEGEND_GAP,
				y: area.maxY - drop,
			};
		}
		/** The size key's top-left corner: under the colour legend, or where the legend would start. */
		const sizeAt = (): Point => {
			const top = keys.sizePosition === "top";
			const legendBox = top ? layout.legendRow : layout.legendColumn;
			const size = top ? layout.sizeRow : layout.sizeColumn;
			// The gap between the keys goes with either when its end lists nothing.
			const both = (legendBox?.presence ?? 0) * (size?.presence ?? 1);
			if (
				legendBox &&
				keys.sizePosition === "right" &&
				layout.keysColumn?.beside
			)
				return {
					x: legendAt.x + legendBox.width + LEGEND_GAP * both,
					y: legendAt.y,
				};
			return {
				x: legendAt.x,
				y: legendAt.y - (legendBox ? legendBox.height + KEYS_GAP * both : 0),
			};
		};
		const bar = keys.ramp;
		if (bar) {
			/** The colour bar's bottom-left corner: right of the plot, after a legend there. */
			const keysNow = layout.keysNow;
			const legendWidth =
				keys.guidesPosition === "right"
					? (keysNow?.width ?? 0) + LEGEND_GAP * (keysNow?.presence ?? 1)
					: 0;
			keep("colorbar", colorbar, {
				domain: bar.domain,
				scale: bar.scale,
				ramp: bar.colormap,
				at: stablePoint(previous("colorbar", "at"), {
					x: area.maxX + layout.rightAxisRoom + LEGEND_GAP + legendWidth,
					y: area.minY,
				}),
				length: layout.plotHeight,
				thickness: COLORBAR_THICKNESS,
				label: chart.colorbarLabel,
				progress: legendProgress,
				zIndex: chart.zIndex,
				visible: chart.visible,
			});
		}
		const position = keys.legendPosition;
		if (position)
			keep("legend", legend, {
				entries: keys.legendEntries,
				at: stablePoint(previous("legend", "at"), legendAt),
				direction: position === "top" ? "row" : "column",
				maxWidth: position === "top" ? layout.plotWidth : undefined,
				title: chart.legendTitle,
				fontSize: chart.legendFontSize,
				progress: legendProgress,
				transition: keys.legendTransition,
				zIndex: chart.zIndex,
				visible: chart.visible,
			});
		if (keys.sizeKeys.length > 0)
			keep("sizeKeys", sizeKeyStack, {
				keys: keys.sizeKeys,
				offsets: layout.sizeOffsets,
				at: stablePoint(previous("sizeKeys", "at"), sizeAt()),
				title: keys.sizeOptions.title,
				values: keys.sizeOptions.values,
				format: keys.sizeOptions.format,
				direction: keys.sizePosition === "top" ? "row" : "column",
				maxWidth: keys.sizePosition === "top" ? layout.plotWidth : undefined,
				fontSize: chart.legendFontSize,
				progress: legendProgress,
				stages: keys.sizeStages,
				zIndex: chart.zIndex,
				visible: chart.visible,
			});

		// Guides no longer drawn leave with the returned children.
		for (const slot of [...slots.keys()])
			if (!used.has(slot)) slots.delete(slot);
		return nodes;
	};
}
