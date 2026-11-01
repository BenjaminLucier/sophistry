/**
 * The chart frame: an `axes` that fits itself to the data drawn inside it.
 *
 * Layers (`bars`, `scatter`, ...) report their data extent through
 * {@link chartLayer}; the frame fits every axis to the union, lays categories
 * out on band axes, and shares one colour scale and legend across all
 * layers. `progress` draws the frame first, then the data, then the legend.
 *
 * How it runs (one commit, no microtask): `setup` provides the stable
 * contexts (where reports go, the tooltip, the date sink, the secondary
 * axes' lift) and places the layers. Each layer's first update reports its
 * extent, which asks the chart to update again (`ctx.invalidate`) in the
 * same commit; the chart fits its axes, publishes a new {@link ChartFrame}
 * and coordinate system, and the layers that read them update once more. A
 * report equal by value to the last one changes nothing, so the loop
 * settles. Every step of the fit (`frame/*`) keeps its last result while
 * its inputs are unchanged, so a frame of a keyed transition redoes only
 * what the blend moves, and a `ChartFrame` keeps its identity while nothing
 * in it changed.
 */

import type {
	CompositeContext,
	ContextKey,
	CoordinateSystem,
	SceneNode,
} from "@sophistry/core";
import {
	createContextKey,
	defineComposite,
	frameContext,
	group,
	Invalidate,
	pointerContext,
	publishCoords,
} from "@sophistry/core";
import type {
	BandKey,
	BandScale,
	Bounds,
	Range,
	RangeTransition,
} from "@sophistry/core/geometry";
import { clamp01, contains } from "@sophistry/core/internal";
import { chartContext, chartLayersContext } from "./context.js";
import type { DateAxis, DateSink } from "./data/channels.js";
import { dateSinkContext } from "./data/channels.js";
import { createChartCoords } from "./frame/coords.js";
import type { AxisFitInput, MergedAxisOptions } from "./frame/fit.js";
import { axisSpan, createAxisFit, createAxisSwap } from "./frame/fit.js";
import { createChartFormats } from "./frame/format.js";
import { createChartGuides } from "./frame/guides.js";
import { createChartKeys } from "./frame/keys.js";
import { createChartLayout, marginBand } from "./frame/layout.js";
import { createLayerRegistry } from "./frame/registry.js";
import {
	createSteadyReports,
	datesOn,
	firstBlend,
	givenOptions,
	numericRange,
	optionsTimeZone,
	sameShape,
	sameStages,
	transitionShapeOf,
} from "./frame/reports.js";
import type { SecondaryFlags } from "./frame/secondary.js";
import { secondaryFit } from "./frame/secondary.js";
import { tooltipOverlay } from "./frame/tooltip-overlay.js";
import type {
	ChartFormatChannel,
	ChartFrame,
	ChartHandle,
	ChartLayerExtent,
	ChartLayers,
	ChartProps,
	ChartRange,
	ChartSide,
} from "./frame/types.js";
import type { JoinStages, StageWindow } from "./math/join.js";
import { joinStages, stageProgress } from "./math/join.js";
import type { OrdinalColorScale } from "./math/ordinal.js";
import type { ChartPanel } from "./multiview/chart-group.js";
import { chartPanel } from "./multiview/chart-group.js";
import type { TooltipConfig, TooltipState } from "./tooltip.js";
import { createTooltipState, tooltipContext } from "./tooltip.js";
import { keyedMemo, shallowEqual, stableValue } from "./util.js";

export type * from "./frame/types.js";

/** Where the frame's share of `progress` ends and the data's begins. */
const FRAME_END = 0.5;
/** Where the data's share ends when a legend follows it (the legend takes the rest). */
const DATA_END_WITH_LEGEND = 0.9;

/** The reason a layer report reruns the chart's update. */
const REPORTS: ContextKey<unknown> = createContextKey("chartReports");
/** The reason a channel's first date reruns the chart's update. */
const DATES: ContextKey<unknown> = createContextKey("chartDates");

/**
 * How `secondaryX` and `secondaryY` find their chart's secondary contexts.
 *
 * @internal
 */
export interface SecondaryLift {
	/** The frame (and its coordinates) of `parent` with `axis` mapped through its secondary scale. */
	lift(parent: ChartFrame, axis: "x" | "y"): ChartFrame;
	/** Which secondary axes a frame of this chart maps through. */
	flagsOf(frame: ChartFrame): SecondaryFlags;
}

/**
 * The enclosing chart's secondary lift, or null outside a chart.
 *
 * @internal
 */
export const secondaryLiftContext: ContextKey<SecondaryLift | null> =
	createContextKey<SecondaryLift | null>("chartSecondary", null);

/** The three secondary contexts' flags. */
const VARIANTS: readonly SecondaryFlags[] = [
	{ x2: false, y2: true },
	{ x2: true, y2: false },
	{ x2: true, y2: true },
];
const PRIMARY: SecondaryFlags = { x2: false, y2: false };
const variantName = (flags: SecondaryFlags) =>
	`${flags.x2 ? "x2" : ""}${flags.y2 ? "y2" : ""}` || "primary";

/** What a chart keeps between updates. */
interface ChartState {
	registry: ReturnType<typeof createLayerRegistry>;
	panel: ChartPanel;
	steady: ReturnType<typeof createSteadyReports>;
	tooltip: TooltipState;
	tooltipConfig: TooltipConfig | false | undefined;
	dates: Set<DateAxis>;
	/** The clip of `clip` (outer) and of the `reveal="x"` sweep (inner), around the layers. */
	clipGroup: SceneNode;
	sweepGroup: SceneNode;
	overlay: SceneNode;
	options: {
		x: ReturnType<typeof keyedMemo<MergedAxisOptions>>;
		y: ReturnType<typeof keyedMemo<MergedAxisOptions>>;
	};
	given: Record<
		DateAxis,
		ReturnType<typeof keyedMemo<Range | RangeTransition | undefined>>
	>;
	shape: ReturnType<typeof stableValue<ReturnType<typeof transitionShapeOf>>>;
	join: ReturnType<typeof stableValue<JoinStages | undefined>>;
	xFit: ReturnType<typeof createAxisFit>;
	yFit: ReturnType<typeof createAxisFit>;
	x2Fit: ReturnType<typeof secondaryFit>;
	y2Fit: ReturnType<typeof secondaryFit>;
	xSwap: ReturnType<typeof createAxisSwap>;
	ySwap: ReturnType<typeof createAxisSwap>;
	bands: ReturnType<typeof stableValue<{ x: boolean; y: boolean }>>;
	zeros: ReturnType<typeof stableValue<ChartZeros>>;
	keys: ReturnType<typeof createChartKeys>;
	layout: ReturnType<typeof createChartLayout>;
	coords: ReturnType<typeof createChartCoords>;
	formats: ReturnType<typeof createChartFormats>;
	formatMemo: Map<string, ReturnType<typeof keyedMemo<ChartFrame["format"]>>>;
	marginMemo: ReturnType<typeof keyedMemo<ChartFrame["marginBox"]>>;
	guides: ReturnType<typeof createChartGuides>;
	frames: Map<string, (next: ChartFrame) => ChartFrame>;
	/** The frames of the current update, by variant, for the secondary lift. */
	current: Map<string, ChartFrame>;
	flags: WeakMap<ChartFrame, SecondaryFlags>;
	sweep: ReturnType<typeof stableValue<Bounds | undefined>>;
	handle: ChartHandle | null;
}

/** Per axis: whether its range is continuous and spans 0, and whether any layer measures from 0 along it. */
interface ChartZeros {
	xSpans: boolean;
	ySpans: boolean;
	xFrom: boolean;
	yFrom: boolean;
}

const states = new WeakMap<object, ChartState>();

/** Merged options, with a time scale inferred where dates were read and no scale named. */
function timed<O extends { scale?: MergedAxisOptions["scale"] }>(
	options: O,
	seen: boolean,
): O {
	return options.scale === undefined && seen
		? { ...options, scale: "utc" }
		: options;
}

function build(ctx: CompositeContext<ChartProps>): SceneNode[] {
	const state = states.get(ctx.node) as ChartState;
	const props = ctx.props;
	const theme = ctx.theme;

	/* ---------------------------------------------------------- reports */

	const live = state.registry.reports();
	const reports = state.steady(live);
	const ownBlend = firstBlend(live);
	/*
	 * Inside a group (`chartLink`, `facet`, `pairPlot`, `jointPlot`) this
	 * chart is a panel: an axis it shares is fitted to every sharing panel's
	 * reports, and the colour scale and staging are the group's.
	 */
	const scope = state.panel.begin(reports, ownBlend);
	const grouped = scope !== null;
	const blend = grouped ? state.panel.blend() : ownBlend;
	const xReports = state.panel.fitReports("x", reports);
	const yReports = state.panel.fitReports("y", reports);
	const allReports = state.panel.allReports(reports);

	/** Which axes some layer's positional channel has read `Date`s on. */
	const xDates = datesOn(state.dates, live, "x");
	const yDates = datesOn(state.dates, live, "y");
	const x2Dates = datesOn(state.dates, live, "x2");
	const y2Dates = datesOn(state.dates, live, "y2");
	const xOptions = state.options.x([props.axis, props.xAxis, xDates], () =>
		timed({ ...props.axis, ...props.xAxis } as MergedAxisOptions, xDates),
	);
	const yOptions = state.options.y([props.axis, props.yAxis, yDates], () =>
		timed({ ...props.axis, ...props.yAxis } as MergedAxisOptions, yDates),
	);
	const rangeGiven = (
		range: ChartRange | RangeTransition | undefined,
		axis: DateAxis,
	) => {
		const zone = optionsTimeZone(givenOptions(props, axis));
		return state.given[axis]([range, zone], () => numericRange(range, zone));
	};
	const xGiven =
		rangeGiven(props.xRange, "x") ??
		(scope?.keys.x !== undefined ? state.panel.range("x") : undefined);
	const yGiven =
		rangeGiven(props.yRange, "y") ??
		(scope?.keys.y !== undefined ? state.panel.range("y") : undefined);
	const x2Given = rangeGiven(props.x2Range, "x2");
	const y2Given = rangeGiven(props.y2Range, "y2");

	/* -------------------------------------------------------------- fit */

	const shape = state.shape(transitionShapeOf(allReports));
	const transitioning = shape !== undefined;
	const xInput: AxisFitInput = {
		options: xOptions,
		given: xGiven,
		reports: xReports,
		transitioning,
	};
	const yInput: AxisFitInput = {
		options: yOptions,
		given: yGiven,
		reports: yReports,
		transitioning,
	};
	const x2State = state.x2Fit.state({
		props,
		given: x2Given,
		dates: x2Dates,
		primaryOptions: xOptions,
		primaryGiven: xGiven,
		primaryFitted: state.xFit.ends(xInput),
		reports,
		fitReports: xReports,
		transitioning,
	});
	const y2State = state.y2Fit.state({
		props,
		given: y2Given,
		dates: y2Dates,
		primaryOptions: yOptions,
		primaryGiven: yGiven,
		primaryFitted: state.yFit.ends(yInput),
		reports,
		fitReports: yReports,
		transitioning,
	});
	/** The transition's stages, shared with every layer through the frame. */
	const join = state.join(
		shape
			? (() => {
					const changes = [
						state.xFit.change(xInput),
						state.yFit.change(yInput),
						state.x2Fit.change(x2State.input),
						state.y2Fit.change(y2State.input),
					];
					return joinStages({
						enters: shape.enters,
						exits: shape.exits,
						expand: changes.includes("expand"),
						contract: changes.includes("contract"),
						staging: shape.staging,
					});
				})()
			: undefined,
	);
	/** How far a stage of the transition has got. */
	const stage = (pick: (stages: JoinStages) => StageWindow): number =>
		shape && join ? stageProgress(blend ?? 0, pick(join), join.eased) : 0;
	const x = state.xFit.place(xInput, stage);
	const y = state.yFit.place(yInput, stage);
	const x2 = state.x2Fit.place(x2State.input, stage, x.given);
	const y2 = state.y2Fit.place(y2State.input, stage, y.given);
	const xBand: BandScale | undefined =
		x.axis.kind === "band" ? x.axis.band : undefined;
	const yBand: BandScale | undefined =
		y.axis.kind === "band" ? y.axis.band : undefined;
	const xSwap = state.xSwap(x.fitted);
	const ySwap = state.ySwap(y.fitted);
	const xEnds = state.xFit.ends(xInput);
	const yEnds = state.yFit.ends(yInput);
	/** Whether each axis is a band (category) axis. */
	const axisBands = state.bands({
		x: x.axis.kind === "band",
		y: y.axis.kind === "band",
	});
	const axisZeros = state.zeros({
		xSpans: x.axis.kind === "continuous" && contains(x.axis.range, 0),
		ySpans: y.axis.kind === "continuous" && contains(y.axis.range, 0),
		xFrom: xReports.some((report) => report.x?.zero),
		yFrom: yReports.some((report) => report.y?.zero),
	});

	/* ------------------------------------------------- keys and layout */

	const keys = state.keys({
		props,
		theme,
		reports,
		transitioning,
		stage,
		groupColorScale: state.panel.colorScale(),
		groupSizeDomain: state.panel.sizeDomain(),
		grouped,
	});
	const layout = state.layout({
		props,
		theme,
		grouped,
		reports,
		stage,
		x: { ...x, options: xOptions },
		y: { ...y, options: yOptions },
		x2: { ...x2, options: x2State.options, has: x2State.has },
		y2: { ...y2, options: y2State.options, has: y2State.has },
		axisBands,
		keys,
	});
	const chartCoords = state.coords({
		xOptions,
		yOptions,
		x,
		y,
		x2: { ...x2, options: x2State.options },
		y2: { ...y2, options: y2State.options },
		xEnds,
		yEnds,
		xGhost: xSwap.ghost,
		yGhost: ySwap.ghost,
		axisBands,
		xPosition: layout.xPosition,
		yPosition: layout.yPosition,
		plotWidth: layout.plotWidth,
		plotHeight: layout.plotHeight,
		center: layout.center,
		stage,
	});
	const { coords, area } = chartCoords;

	/* --------------------------------------------------------- progress */

	/**
	 * `progress` in phases: the frame, then the data, then the legend and
	 * colour bar (when there are any), after the marks they explain.
	 */
	const overall = props.progress ?? 1;
	const guided = keys.guidesPosition !== undefined || keys.ramp !== undefined;
	const dataEnd = guided ? DATA_END_WITH_LEGEND : 1;
	const frameProgress = clamp01(overall / FRAME_END);
	const dataPhase = clamp01((overall - FRAME_END) / (dataEnd - FRAME_END));
	const legendProgress =
		dataEnd >= 1 ? 1 : clamp01((overall - dataEnd) / (1 - dataEnd));
	const swept = props.reveal === "x";
	const dataProgress = swept ? (dataPhase > 0 ? 1 : 0) : dataPhase;

	state.tooltipConfig =
		props.tooltip === undefined || props.tooltip === false
			? props.tooltip
			: props.tooltip === true
				? { all: true }
				: { all: true, ...props.tooltip };

	/* ------------------------------------------------------------ frames */

	const formatThrough = state.formats({
		x: { options: xOptions, axis: x.axis },
		y: { options: yOptions, axis: y.axis },
		x2: { options: x2State.options, axis: x2.axis },
		y2: { options: y2State.options, axis: y2.axis },
		color: props.color,
		colorScale: keys.colorScale,
		sizeOptions: keys.sizeOptions,
	});
	/** A context's formatter, kept while everything it writes through is. */
	const formatOf = (flags: SecondaryFlags): ChartFrame["format"] => {
		const name = variantName(flags);
		let memo = state.formatMemo.get(name);
		if (!memo) {
			memo = keyedMemo();
			state.formatMemo.set(name, memo);
		}
		return memo(
			[
				xOptions,
				x.axis,
				yOptions,
				y.axis,
				x2State.options,
				x2.axis,
				y2State.options,
				y2.axis,
				props.color,
				keys.colorScale,
				keys.sizeOptions,
			],
			() => {
				const format = formatThrough(flags);
				return (channel: ChartFormatChannel) => format(channel);
			},
		);
	};
	const marginBox = state.marginMemo(
		[
			area,
			layout.margin,
			layout.topNumbersRoom,
			layout.bottomNumbersRoom,
			layout.rightNumbersRoom,
			layout.y2NumbersRoom,
			layout.leftNumbersRoom,
		],
		() =>
			(side: ChartSide): Bounds => {
				const numbers =
					side === "top"
						? layout.topNumbersRoom
						: side === "bottom"
							? layout.bottomNumbersRoom
							: side === "right"
								? layout.rightNumbersRoom + layout.y2NumbersRoom
								: layout.leftNumbersRoom;
				return marginBand(area, side, layout.margin[side], numbers);
			},
	);
	const frameOf = (flags: SecondaryFlags, system: CoordinateSystem) => {
		const name = variantName(flags);
		let stable = state.frames.get(name);
		if (!stable) {
			stable = stableValue<ChartFrame>(sameFrame);
			state.frames.set(name, stable);
		}
		const frame = stable({
			coords: system,
			xBand: flags.x2 ? undefined : xBand,
			yBand: flags.y2 ? undefined : yBand,
			dataProgress,
			frameProgress,
			axesAt: chartCoords.axesAt,
			colorScale: keys.colorScale,
			sizeDomain: keys.sizeDomain,
			join,
			ends: chartCoords.endsThrough(flags),
			tooltip: state.tooltip,
			format: formatOf(flags),
			marginBox,
		});
		state.flags.set(frame, flags);
		state.current.set(name, frame);
		return frame;
	};
	const frame = frameOf(PRIMARY, coords);
	const systems = [
		chartCoords.coords2,
		chartCoords.coords3,
		chartCoords.coords4,
	];
	VARIANTS.forEach((flags, i) => {
		frameOf(flags, systems[i] as CoordinateSystem);
	});
	publishCoords(ctx, coords);
	ctx.provide(chartContext, frame);
	state.handle = {
		coords,
		xBand,
		yBand,
		color: (key: BandKey) => keys.colorScale(key),
		colorDomain: () => keys.colorScale.domain,
	};

	/* ------------------------------------------------------------ layers */

	/**
	 * The `reveal="x"` front: an edge sweeping across the plot at a constant
	 * rate. Gone once the data phase ends.
	 */
	let sweep: Bounds | undefined;
	if (swept && dataPhase < 1) {
		const width = area.maxX - area.minX;
		const height = area.maxY - area.minY;
		sweep = {
			minX: area.minX - width,
			maxX: area.minX + width * dataPhase,
			minY: area.minY - height,
			maxY: area.maxY + height,
		};
	}
	state.clipGroup.update({ clip: props.clip ? area : undefined } as never);
	state.sweepGroup.update({ clip: state.sweep(sweep) } as never);
	(
		state.sweepGroup as unknown as {
			setChildren(children: readonly SceneNode[]): void;
		}
	).setChildren(ctx.children);

	const guides = state.guides(ctx, {
		props,
		theme,
		reports,
		x: { ...x, options: xOptions, ends: xEnds, swap: xSwap },
		y: { ...y, options: yOptions, ends: yEnds, swap: ySwap },
		x2: {
			has: x2State.has,
			options: x2State.options,
			given: x2.given,
			range: x2.range,
		},
		y2: {
			has: y2State.has,
			options: y2State.options,
			given: y2.given,
			range: y2.range,
		},
		axisZeros,
		axisBands,
		stage,
		layout,
		keys,
		coords: chartCoords,
		frameProgress,
		legendProgress,
	});
	state.overlay.update({ area } as never);

	state.panel.end({
		room: {
			left: layout.leftRoom,
			right: layout.rightRoom,
			top: layout.topRoom,
			bottom: layout.bottomRoom,
		},
		span: { x: axisSpan(x.axis), y: axisSpan(y.axis) },
		stages: join,
		ready: true,
	});
	return [...guides, state.clipGroup, state.overlay];
}

/**
 * A plotting frame that fits its axes to the layers inside it: an `axes`
 * with ranges worked out for you, categorical axes, grid, title, legend and
 * colour bar. Anything given explicitly (`xRange`, `yRange`,
 * `xAxis.categories`) wins over fitting. Children see the coordinate system
 * as in `axes`, so core's graphs plot in data space inside it.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { chart, okabeIto, scatter } from "@sophistry/charts";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * const temps = [
 * 	{ month: 1, city: "Oslo", c: -4 },
 * 	{ month: 7, city: "Oslo", c: 17 },
 * 	{ month: 1, city: "Rome", c: 8 },
 * 	{ month: 7, city: "Rome", c: 25 },
 * ];
 * scene.add(
 * 	chart.create({
 * 		width: 8,
 * 		height: 4,
 * 		color: { range: okabeIto },
 * 		legendTitle: "City",
 * 		children: [scatter.create({ data: temps, x: "month", y: "c", series: "city" })],
 * 	}),
 * );
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#the-chart-frame
 * @category Charts
 */
export const chart = defineComposite<ChartProps>({
	name: "Chart",
	props: {
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		autosize: { invalidates: Invalidate.UPDATE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		axis: { invalidates: Invalidate.UPDATE },
		xAxis: { invalidates: Invalidate.UPDATE },
		yAxis: { invalidates: Invalidate.UPDATE },
		y2Range: { invalidates: Invalidate.UPDATE },
		y2Axis: { invalidates: Invalidate.UPDATE },
		y2Label: { invalidates: Invalidate.UPDATE },
		x2Range: { invalidates: Invalidate.UPDATE },
		x2Axis: { invalidates: Invalidate.UPDATE },
		x2Label: { invalidates: Invalidate.UPDATE },
		tip: { invalidates: Invalidate.UPDATE },
		xLabel: { invalidates: Invalidate.UPDATE },
		yLabel: { invalidates: Invalidate.UPDATE },
		axisLabelFontSize: { invalidates: Invalidate.UPDATE },
		grid: { invalidates: Invalidate.UPDATE },
		gridColor: { invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		titleFontSize: { invalidates: Invalidate.UPDATE },
		subtitle: { invalidates: Invalidate.UPDATE },
		subtitleFontSize: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		legend: { invalidates: Invalidate.UPDATE },
		legendTitle: { invalidates: Invalidate.UPDATE },
		legendFontSize: { invalidates: Invalidate.UPDATE },
		sizeLegend: { invalidates: Invalidate.UPDATE },
		scales: { invalidates: Invalidate.UPDATE },
		colorbar: { invalidates: Invalidate.UPDATE },
		colorbarLabel: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		clip: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.NONE },
	},
	setup: (ctx) => {
		const sweepGroup = group.create({});
		const clipGroup = group.create({});
		clipGroup.add(sweepGroup);
		const state: ChartState = {
			registry: createLayerRegistry(() => ctx.invalidate(REPORTS)),
			panel: chartPanel(ctx),
			steady: createSteadyReports(),
			tooltip: undefined as unknown as TooltipState,
			tooltipConfig: undefined,
			dates: new Set(),
			clipGroup,
			sweepGroup,
			overlay: undefined as unknown as SceneNode,
			options: { x: keyedMemo(), y: keyedMemo() },
			given: {
				x: keyedMemo(),
				y: keyedMemo(),
				x2: keyedMemo(),
				y2: keyedMemo(),
			},
			shape: stableValue(sameShape),
			join: stableValue(sameStages),
			xFit: createAxisFit({
				pick: (r) => r.x,
				pickTo: (t) => t.x,
				vertical: false,
			}),
			yFit: createAxisFit({
				pick: (r) => r.y,
				pickTo: (t) => t.y,
				vertical: true,
			}),
			x2Fit: secondaryFit("x"),
			y2Fit: secondaryFit("y"),
			xSwap: createAxisSwap(),
			ySwap: createAxisSwap(),
			bands: stableValue<{ x: boolean; y: boolean }>(shallowEqual),
			zeros: stableValue<ChartZeros>(shallowEqual),
			keys: createChartKeys(),
			layout: createChartLayout(),
			coords: createChartCoords(),
			formats: createChartFormats(),
			formatMemo: new Map(),
			marginMemo: keyedMemo(),
			guides: createChartGuides(),
			frames: new Map(),
			current: new Map(),
			flags: new WeakMap(),
			sweep: stableValue<Bounds | undefined>(
				(a, b) => a === b || (!!a && !!b && shallowEqual(a, b)),
			),
			handle: null,
		};
		state.tooltip = createTooltipState(() => state.tooltipConfig);
		state.overlay = tooltipOverlay.create({
			state: state.tooltip,
			active: state.tooltip.active,
			pointsVersion: state.tooltip.pointsVersion,
			...(ctx.context(pointerContext)
				? { pointer: ctx.context(pointerContext) }
				: {}),
			view: ctx.context(frameContext),
		} as never);
		states.set(ctx.node, state);
		const sink: DateSink = {
			note(axis) {
				if (state.dates.has(axis)) return;
				state.dates.add(axis);
				ctx.invalidate(DATES);
			},
			// From the props, not the merged options: those wait on the
			// reports, which are what read the channels asking.
			timeZone: (axis) => optionsTimeZone(givenOptions(ctx.props, axis)),
		};
		const lift: SecondaryLift = {
			lift(parent, axis) {
				const own = state.flags.get(parent) ?? PRIMARY;
				const flags = {
					x2: own.x2 || axis === "x",
					y2: own.y2 || axis === "y",
				};
				return state.current.get(variantName(flags)) ?? parent;
			},
			flagsOf: (frame) => state.flags.get(frame) ?? PRIMARY,
		};
		ctx.provide(chartLayersContext, state.registry as ChartLayers);
		ctx.provide(tooltipContext, state.tooltip);
		ctx.provide(dateSinkContext, sink);
		ctx.provide(secondaryLiftContext, lift);
		return build(ctx);
	},
	update: (_changed, ctx) => build(ctx),
});

/** Two frames with equal fields (functions by identity) are the same frame. */
function sameFrame(a: ChartFrame, b: ChartFrame): boolean {
	return (
		a.coords === b.coords &&
		a.xBand === b.xBand &&
		a.yBand === b.yBand &&
		a.dataProgress === b.dataProgress &&
		a.frameProgress === b.frameProgress &&
		shallowEqual(a.axesAt, b.axesAt) &&
		sameScale(a.colorScale, b.colorScale) &&
		a.sizeDomain === b.sizeDomain &&
		a.join === b.join &&
		a.ends === b.ends &&
		a.tooltip === b.tooltip &&
		a.format === b.format &&
		a.marginBox === b.marginBox
	);
}

function sameScale(a: OrdinalColorScale, b: OrdinalColorScale): boolean {
	return (
		a === b ||
		(shallowEqual(a.domain, b.domain) && shallowEqual(a.range, b.range))
	);
}

/**
 * A chart node's handle: its coordinate system,
 * band scales and colours, as of its last update. Brings the node up to date
 * first, so it works right after `create`.
 *
 * @param node - A node made by {@link chart}.
 * @returns The handle, or null for a node that is not a chart.
 * @category Charts
 */
export function chartHandle(node: SceneNode): ChartHandle | null {
	(node as { refresh?(): void }).refresh?.();
	return states.get(node)?.handle ?? null;
}

/** For tests: the chart reports in `node`'s registry. @internal */
export function chartReports(node: SceneNode): readonly ChartLayerExtent[] {
	return states.get(node)?.registry.reports() ?? [];
}
