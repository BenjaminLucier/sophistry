/**
 * A scatter with each variable's distribution along its edge, as three
 * linked `chart`s in one group: the marginals follow the scatter's fit
 * without adding their tails to it.
 */

import type { CompositeContext, ContextKey, SceneNode } from "@sophistry/core";
import { createContextKey, defineComposite, Invalidate } from "@sophistry/core";
import type {
	BandKey,
	Point,
	Range,
	RangeTransition,
} from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import { bin } from "../bars/transforms.js";
import { density } from "../curves/density.js";
import type { Channel } from "../data/channels.js";
import type {
	ChartColorOptions,
	ChartXAxisOptions,
	ChartYAxisOptions,
} from "../frame/types.js";
import { facetGrid } from "../math/facet.js";
import { rects } from "../points/rects.js";
import { scatter } from "../points/scatter.js";
import type { AnyDatum } from "../props.js";
import { shallowEqual } from "../util.js";
import type { ChartGroup, PanelKeys } from "./chart-group.js";
import { createChartGroup } from "./chart-group.js";
import type { GroupGuideOptions, GroupGuides } from "./group-guides.js";
import { createGroupGuides, PANELS_END_WITH_GUIDES } from "./group-guides.js";
import type { PanelNodes } from "./panels.js";
import { makePanel, outerRoom, watchGroup } from "./panels.js";

const DEFAULT_RATIO = 5;
const DEFAULT_SPACE = 0.15;
const HISTOGRAM_OPACITY = 0.55;

/**
 * Props for {@link jointPlot}.
 *
 * @category Charts
 */
export interface JointPlotProps<T> {
	/** One point per datum. */
	data: readonly T[];
	/** The horizontal variable. */
	x: Channel<T, number>;
	/** The vertical variable. */
	y: Channel<T, number>;
	/** Splits the points and the marginal densities by category, one colour each. */
	series?: Channel<T, BandKey>;
	/** The scatter's identity channel, as `scatter`'s `key`. */
	key?: Channel<T, BandKey>;
	/** Width of the main plot and its right marginal (a legend fits inside; see `autosize`). */
	width: number;
	/** Height of the main plot and its top marginal. */
	height: number;
	/** Centre of the figure. Defaults to the origin. */
	center?: Point;
	/**
	 * How much larger the main plot is than a marginal, along their shared axis.
	 * @default 5
	 */
	ratio?: number;
	/**
	 * Gap between the main plot and each marginal.
	 * @default 0.15
	 */
	space?: number;
	/**
	 * What the marginals draw: `"density"` (split by `series`, normalised together) or
	 * `"histogram"` (bins of the whole sample).
	 * @default "density"
	 */
	marginal?: "density" | "histogram";
	/** Histogram marginals: how many bins. Defaults to `histogramBins`' rule. */
	binCount?: number;
	/**
	 * Density marginals: normalise all series together, so each curve's area is its share of the
	 * sample.
	 * @default true
	 */
	commonNorm?: boolean;
	/** Marker radius. Defaults to `scatter`'s. */
	radius?: number;
	/** Fixed x range, shared by the scatter and the top marginal. Omitted, fitted to the points. */
	xRange?: Range | RangeTransition;
	/** Fixed y range, shared by the scatter and the right marginal. */
	yRange?: Range | RangeTransition;
	/** The main plot's x axis. */
	xAxis?: ChartXAxisOptions;
	/** The main plot's y axis. */
	yAxis?: ChartYAxisOptions;
	/** The main plot's grid. */
	grid?: boolean | "x" | "y";
	/**
	 * As `chart`'s `autosize`, over the whole figure.
	 * @default "fit"
	 */
	autosize?: "fit" | "pad" | "contain";
	color?: ChartColorOptions;
	/**
	 * One legend: on the right (`true`, `"right"`) or in a row over the figure (`"top"`).
	 * On the right by default when `series` is given.
	 */
	legend?: boolean | "right" | "top";
	legendTitle?: string;
	legendFontSize?: number;
	title?: string;
	titleFontSize?: number;
	/** The x variable's title, centred under the main plot. */
	xLabel?: string;
	/** The y variable's title, centred left of the main plot, reading upward. */
	yLabel?: string;
	axisLabelFontSize?: number;
	/**
	 * Reveal, 0..1: every frame, then the points and both marginals together, then the legend.
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	zIndex?: number;
	visible?: boolean;
	/** More layers on the main plot (a regression line, annotations). */
	children?: readonly SceneNode[];
}

/** Why the figure reruns: its group published something. */
const GROUP_LAYOUT: ContextKey<unknown> = createContextKey("jointPlotGroup");

interface JointState {
	group: ChartGroup;
	guides: GroupGuides;
	main: PanelNodes;
	top: PanelNodes;
	side: PanelNodes;
	/** What the layers were built from, to rebuild them only when it changes. */
	deps: readonly unknown[];
}

const jointStates = new WeakMap<object, JointState>();

const KEYS = {
	main: { x: "x", y: "y" } satisfies PanelKeys,
	top: { x: "x", follows: { x: true } } satisfies PanelKeys,
	side: { y: "y", follows: { y: true } } satisfies PanelKeys,
};

function layerDeps(props: JointPlotProps<AnyDatum>): readonly unknown[] {
	return [
		props.data,
		props.x,
		props.y,
		props.series,
		props.key,
		props.radius,
		props.marginal,
		props.binCount,
		props.commonNorm,
		props.children,
	];
}

/** The three panels' layers: the scatter (and `children`), and each marginal. */
function jointLayers(props: JointPlotProps<AnyDatum>) {
	const histogram = props.marginal === "histogram";
	const marginal = (axis: "x" | "y"): SceneNode => {
		const channel = axis === "x" ? props.x : props.y;
		if (histogram) {
			const bins = bin(props.data, {
				x: channel as never,
				binCount: props.binCount,
			});
			const zero = () => 0;
			return rects.create(
				(axis === "x"
					? { data: bins, x1: "x1", x2: "x2", y1: zero, y2: "y" }
					: { data: bins, x1: zero, x2: "y", y1: "x1", y2: "x2" }) as never,
			);
		}
		return density.create({
			data: props.data,
			x: channel,
			series: props.series,
			commonNorm: props.commonNorm ?? true,
			orientation: axis === "x" ? "vertical" : "horizontal",
		} as never);
	};
	const top = marginal("x");
	const side = marginal("y");
	if (histogram) {
		top.update({ fillOpacity: HISTOGRAM_OPACITY } as never);
		side.update({ fillOpacity: HISTOGRAM_OPACITY } as never);
	}
	return {
		main: [
			scatter.create({
				data: props.data,
				x: props.x,
				y: props.y,
				series: props.series,
				key: props.key,
				radius: props.radius,
			} as never),
			...(props.children ?? []),
		],
		top: [top],
		side: [side],
	};
}

function drawJointPlot(
	ctx: CompositeContext<JointPlotProps<AnyDatum>>,
	state: JointState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const group = state.group;
	group.setOptions({
		color: props.color,
		xRange: props.xRange,
		yRange: props.yRange,
		palette: theme.palette.series,
	});
	const deps = layerDeps(props);
	if (!shallowEqual(deps, state.deps)) {
		state.deps = deps;
		const layers = jointLayers(props);
		state.main.plot.set("children" as never, layers.main as never);
		state.top.plot.set("children" as never, layers.top as never);
		state.side.plot.set("children" as never, layers.side as never);
	}
	const guideOptions: GroupGuideOptions = {
		title: props.title,
		titleFontSize: props.titleFontSize,
		xLabel: props.xLabel,
		yLabel: props.yLabel,
		axisLabelFontSize: props.axisLabelFontSize,
		legend: props.legend,
		legendWidth: props.width,
		legendTitle: props.legendTitle,
		legendFontSize: props.legendFontSize,
	};
	const measured = state.guides.measure(group, guideOptions, theme);
	const panelsRoom = group.room();
	const ratio = props.ratio ?? DEFAULT_RATIO;
	const space = props.space ?? DEFAULT_SPACE;
	const grid = facetGrid({
		rows: 2,
		columns: 2,
		width: props.width,
		height: props.height,
		center: props.center,
		gapX: space,
		gapY: space,
		outer: outerRoom(props.autosize, panelsRoom, measured.room),
		widthRatios: [ratio, 1],
		heightRatios: [1, ratio],
	});
	const main = grid.cells[1]?.[0];
	const top = grid.cells[0]?.[0];
	const side = grid.cells[1]?.[1];
	if (!main || !top || !side) return [];
	const mainBox = {
		minX: main.center.x - main.width / 2,
		maxX: main.center.x + main.width / 2,
		minY: main.center.y - main.height / 2,
		maxY: main.center.y + main.height / 2,
	};

	const overall = props.progress ?? 1;
	const panelsEnd = measured.guided ? PANELS_END_WITH_GUIDES : 1;
	const panels = clamp01(overall / panelsEnd);
	const legendProgress =
		panelsEnd >= 1 ? 1 : clamp01((overall - panelsEnd) / (1 - panelsEnd));
	const common = {
		autosize: "pad",
		legend: false,
		progress: panels,
		zIndex: props.zIndex,
		visible: props.visible,
	};
	state.main.plot.update({
		...common,
		width: main.width,
		height: main.height,
		center: main.center,
		xAxis: props.xAxis,
		yAxis: props.yAxis,
		grid: props.grid,
	} as never);
	for (const [panel, cell] of [
		[state.top, top],
		[state.side, side],
	] as const)
		panel.plot.update({
			...common,
			width: cell.width,
			height: cell.height,
			center: cell.center,
			axis: { visible: false },
			clip: true,
		} as never);
	return [
		state.main.wrapper,
		state.top.wrapper,
		state.side.wrapper,
		...state.guides.draw(
			group,
			guideOptions,
			measured,
			{
				plots: grid.plots,
				labelBox: mainBox,
				panelRoom: panelsRoom,
				frameProgress: clamp01(panels / 0.5),
				legendProgress,
				zIndex: props.zIndex,
				visible: props.visible,
			},
			theme,
		),
	];
}

/**
 * A joint plot: a scatter of `x` against `y` with each variable's distribution along the
 * matching edge (`x`'s above, `y`'s on the right). The marginals share the scatter's scales,
 * and a `series` is one colour in all three panels with one legend.
 *
 * @example
 * ```ts
 * import { jointPlot } from "@sophistry/charts";
 *
 * const points = Array.from({ length: 100 }, (_, i) => ({ x: Math.sin(i), y: Math.cos(i * 1.3), g: i % 2 ? "a" : "b" }));
 * jointPlot.create({ data: points, x: "x", y: "y", series: "g", width: 7, height: 6 });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#multiple-views
 * @category Charts
 */
export const jointPlot = defineComposite<JointPlotProps<AnyDatum>>({
	name: "JointPlot",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		width: { default: 7, invalidates: Invalidate.UPDATE },
		height: { default: 6, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		ratio: { invalidates: Invalidate.UPDATE },
		space: { invalidates: Invalidate.UPDATE },
		marginal: { invalidates: Invalidate.UPDATE },
		binCount: { invalidates: Invalidate.UPDATE },
		commonNorm: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		xAxis: { invalidates: Invalidate.UPDATE },
		yAxis: { invalidates: Invalidate.UPDATE },
		grid: { invalidates: Invalidate.UPDATE },
		autosize: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		legend: { invalidates: Invalidate.UPDATE },
		legendTitle: { invalidates: Invalidate.UPDATE },
		legendFontSize: { invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		titleFontSize: { invalidates: Invalidate.UPDATE },
		xLabel: { invalidates: Invalidate.UPDATE },
		yLabel: { invalidates: Invalidate.UPDATE },
		axisLabelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const group = createChartGroup();
		const state: JointState = {
			group,
			guides: createGroupGuides(),
			main: makePanel({ group, keys: KEYS.main }, []),
			top: makePanel({ group, keys: KEYS.top }, []),
			side: makePanel({ group, keys: KEYS.side }, []),
			deps: [],
		};
		jointStates.set(ctx.node, state);
		watchGroup(ctx, group, GROUP_LAYOUT);
		ctx.onDispose(() => state.guides.dispose());
		return drawJointPlot(ctx, state);
	},
	update: (_changed, ctx) =>
		drawJointPlot(ctx, jointStates.get(ctx.node) as JointState),
});
