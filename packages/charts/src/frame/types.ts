/**
 * The public types of `chart`: its props, a layer's report, and the frame
 * layers read through `chartContext`.
 */

import type {
	AxisOptions,
	AxisPosition,
	CoordinateSystem,
	SceneNode,
	XAxisPosition,
	YAxisPosition,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type {
	BandKey,
	BandScale,
	Bounds,
	Point,
	RangeTransition,
	Scale,
	ScaleSpec,
} from "@sophistry/core/geometry";
import type { Colormap } from "@sophistry/core/themes";
import type { PositionValue } from "../data/channels.js";
import type { JoinStages, JoinStaging } from "../math/join.js";
import type { OrdinalColorScale } from "../math/ordinal.js";
import type { SymbolName } from "../math/symbol.js";
import type { LayersReveal } from "../props.js";
import type { TooltipAnchor, TooltipFormat, TooltipState } from "../tooltip.js";

/**
 * How a series' marks look in a legend entry.
 *
 * @category Charts
 */
export interface LegendMark {
	/** A short stroke: the series is drawn as a line. */
	line?: boolean;
	/** A marker of this shape (on the stroke, if there is one). */
	symbol?: SymbolName;
	/** A filled square: the series is drawn as areas or bars. Wins over `line` and `symbol`. */
	fill?: boolean;
}

/**
 * A square-root size scale in scene units: what a size key draws.
 *
 * @category Charts
 */
export interface SizeScale {
	/** The value that reaches `range[1]`. */
	maxValue: number;
	/**
	 * The radii of a value of 0 and of `maxValue`.
	 * @default [0, 0.35]
	 */
	range?: readonly [number, number];
}

/**
 * A fixed axis range for `chart`: a {@link Range} whose ends may also
 * be `Date`s or Temporal values, for a time axis. `step` stays a number in
 * the axis's units; a `{ from, to, t }` transition takes numbers only.
 *
 * @see https://sophistry.dev/guides/charts/#dates-and-time-zones
 * @category Charts
 */
export type ChartRange = [
	min: PositionValue,
	max: PositionValue,
	step?: number,
];

/**
 * Per-axis options for `chart`: everything an `axes` axis takes,
 * plus how the frame fits and places it.
 *
 * @see https://sophistry.dev/guides/charts/#scales
 * @category Charts
 */
export interface ChartAxisOptions extends Omit<AxisOptions, "scale"> {
	/**
	 * How values map along the axis: a continuous scale (`"linear"`, `"log"`,
	 * `"sqrt"`, `"symlog"`, `"time"`, `"utc"`, or a custom `Scale`) or `"band"`
	 * for categories. Omitted, it is `"band"` when a layer reports categories,
	 * `"utc"` when a layer's channel gives dates, else `"linear"`.
	 */
	scale?: ScaleSpec | "band";
	/** Band axes: the categories, in order. Omitted, the layers' categories in first-seen order. */
	categories?: readonly BandKey[];
	/** Band axes: a category's label; `""` draws none. Defaults to `String(key)`. */
	categoryLabel?: (key: BandKey, index: number) => string;
	/** Band axes: fraction of each slot left empty between bands, 0..1. @default 0.4 */
	padding?: number;
	/** Continuous axes: keep zero in range. Omitted, kept when any layer asks (bars, areas and histograms do). */
	zero?: boolean;
	/**
	 * Continuous axes: round a fitted range out to tick values. `false` keeps
	 * the data's ends; `"tight"` rounds an end out only when the next tick is
	 * within a quarter step of the data.
	 * @default true
	 */
	nice?: boolean | "tight";
	/**
	 * Continuous axes: pad a fitted range by this fraction of the data's span on
	 * each side before rounding. A side held at zero by `zero` stays there.
	 * @default 0
	 */
	margin?: number;
	/**
	 * Flip the axis: a continuous axis runs from its range's end to its start, a
	 * band axis lays its categories out the other way.
	 * @default false
	 */
	reverse?: boolean;
	/**
	 * Continuous axes: pin out-of-range values to the range's ends instead of
	 * drawing them past the frame.
	 * @default false
	 */
	clamp?: boolean;
	/**
	 * Band axes: each category's slot index (may be fractional), overriding its
	 * place in `categories`; 0 is leftmost, or the top of a y axis. For sort and
	 * rank animations, e.g. from a `raceTimeline` entry's `position`.
	 * Returning undefined keeps the category's own slot.
	 */
	slot?: (key: BandKey) => number | undefined;
	/** Draw this axis. The scale still applies when false. @default true */
	visible?: boolean;
	/** Band axes: draw the axis line the bands stand on. @default true */
	line?: boolean;
	/**
	 * Where the axis line crosses the other axis: `"zero"` at the data origin
	 * (pinned to the nearest edge when out of range), `"edge"` at the plot's low
	 * edge, or a value of the other axis. Bars and areas still grow from zero. Defaults to `"zero"`
	 * for a continuous axis, `"edge"` for a band axis.
	 */
	position?: AxisPosition;
	/**
	 * Continuous axes: a rule across the plot at zero, for when the other axis is
	 * drawn elsewhere. Omitted, on when a layer measures from zero along this
	 * axis, zero is in range, and the other axis has moved off it.
	 */
	zeroLine?: boolean;
}

/**
 * {@link ChartAxisOptions} for `<Chart xAxis>`: `position` also takes
 * `"bottom"` and `"top"`.
 *
 * @category Charts
 */
export interface ChartXAxisOptions extends Omit<ChartAxisOptions, "position"> {
	/** As {@link ChartAxisOptions.position}; `"bottom"` is `"edge"`, `"top"` puts the numbers above the line. */
	position?: XAxisPosition;
}

/**
 * {@link ChartAxisOptions} for `<Chart yAxis>`: `position` also takes
 * `"left"` and `"right"`.
 *
 * @category Charts
 */
export interface ChartYAxisOptions extends Omit<ChartAxisOptions, "position"> {
	/** As {@link ChartAxisOptions.position}; `"left"` is `"edge"`, `"right"` puts the numbers right of the line. */
	position?: YAxisPosition;
}

/**
 * Options for a secondary axis (`<Chart y2Axis>`, `x2Axis`): a continuous
 * axis's {@link ChartAxisOptions}, plus tick alignment with the primary axis.
 *
 * @see https://sophistry.dev/guides/charts/#scales
 * @category Charts
 */
export interface ChartSecondaryAxisOptions
	extends Omit<ChartAxisOptions, "position" | "categories" | "slot"> {
	/**
	 * Put this axis's ticks where the primary axis's are, so one grid reads for
	 * both. The range is widened to a nice step covering the data; linear,
	 * fitted axes only (a given range wins).
	 * @default false
	 */
	alignTicks?: boolean;
}

/**
 * The categorical colour scale of a `chart`: how the categories layers
 * report through `series` map to colours and legend names.
 *
 * @see https://sophistry.dev/guides/charts/#color
 * @category Charts
 */
export interface ChartColorOptions {
	/**
	 * The categories, in order; pin it so colours stay put when data is filtered.
	 * Unlisted categories follow in first-seen order.
	 */
	domain?: readonly BandKey[];
	/**
	 * The colours, cycled over the domain: `okabeIto`, `tableau10`,
	 * `observable10`, or your own. Defaults to the theme's series colours.
	 */
	range?: readonly ColorInput[];
	/** A category's name in the legend. Defaults to `String(key)`. */
	label?: (key: BandKey, index: number) => string;
}

/**
 * Props for `chart`.
 *
 * @see https://sophistry.dev/guides/charts/#the-chart-frame
 * @category Charts
 */
export interface ChartProps {
	/** Width of the chart; under `autosize="fit"` guides on the right fit inside it. */
	width: number;
	/** Height of the plotting area (of everything, under `autosize="contain"`). */
	height: number;
	/**
	 * Centre of the chart: of the area `width × height` covers (see `autosize`). Defaults to the
	 * origin.
	 */
	center?: Point;
	/**
	 * Which guides `width` and `height` make room for: `"fit"` fits the guides
	 * on the right (legend, colour bar, right-hand axis) inside `width`;
	 * `"contain"` fits every guide on every side inside `width × height`;
	 * `"pad"` makes the plotting area exactly `width × height` with all guides
	 * outside.
	 * @default "fit"
	 */
	autosize?: "fit" | "pad" | "contain";
	/**
	 * Fixed x range `[min, max, step?]`, or `{ from, to, t }` to animate the
	 * domain (ticks and grid cross-fade; pair it with `clip`). Omitted, fitted to
	 * the layers' data. Ignored by a band axis.
	 */
	xRange?: ChartRange | RangeTransition;
	/** Fixed y range, or a `{ from, to, t }` transition; see `xRange`. */
	yRange?: ChartRange | RangeTransition;
	/** Options for both axes. */
	axis?: ChartAxisOptions;
	/** Overrides for the x axis, merged over `axis`. */
	xAxis?: ChartXAxisOptions;
	/** Overrides for the y axis, merged over `axis`. */
	yAxis?: ChartYAxisOptions;
	/**
	 * Fixed range of the secondary y axis, which layers inside a
	 * `secondaryY` map through; or a `{ from, to, t }` transition.
	 * Omitted, fitted to those layers.
	 */
	y2Range?: ChartRange | RangeTransition;
	/** Options for the secondary y axis, merged over `axis`. It always stands on the right; continuous scales only. */
	y2Axis?: ChartSecondaryAxisOptions;
	/** Title above the top of the secondary y axis. */
	y2Label?: string;
	/**
	 * Fixed range of the secondary x axis, which layers inside a
	 * `secondaryX` map through; or a `{ from, to, t }` transition.
	 * Omitted, fitted to those layers.
	 */
	x2Range?: ChartRange | RangeTransition;
	/** Options for the secondary x axis, merged over `axis`. It always runs along the top; continuous scales only. */
	x2Axis?: ChartSecondaryAxisOptions;
	/** Title past the right end of the secondary x axis. */
	x2Label?: string;
	/** Draw arrowheads at the far ends of continuous axes. @default false */
	tip?: boolean;
	/** Title past the far end of the x axis. */
	xLabel?: string;
	/** Title past the top of the y axis. */
	yLabel?: string;
	/** Font size of `xLabel` and `yLabel`. @default 0.34 */
	axisLabelFontSize?: number;
	/** Grid lines at the major ticks of both axes, one, or none. Band axes get none. @default false */
	grid?: boolean | "x" | "y";
	/** Grid line colour. Defaults to the theme's grid colour. */
	gridColor?: string;
	/** Title centred above the plotting area. */
	title?: string;
	/** Font size of `title`. @default 0.42 */
	titleFontSize?: number;
	/** A quieter second line under the title. */
	subtitle?: string;
	/** Font size of `subtitle`. @default 0.3 */
	subtitleFontSize?: number;
	/** The categorical colour scale every layer's `series` maps through. */
	color?: ChartColorOptions;
	/**
	 * A legend of the layers' series: `"right"` in a column beside the plot,
	 * `"top"` in a row above it, `false` never. Omitted, drawn on the right
	 * whenever a layer reports a series.
	 */
	legend?: boolean | "right" | "top";
	/** A title above the legend's entries. */
	legendTitle?: string;
	/** Font size of the legend. @default 0.28 */
	legendFontSize?: number;
	/**
	 * A size key for layers that size marks by value (`Scatter`'s `size`),
	 * drawn with the legend. Omitted, drawn whenever a layer reports a size
	 * scale; `false` never. Layers on different size scales get one key each.
	 */
	sizeLegend?: boolean | ChartSizeLegendOptions;
	/** How layers share non-positional scales; by default sized layers share one size scale, so bubbles compare across layers. */
	scales?: ChartScales;
	/**
	 * A colour bar for the first layer that colours by value (`Imshow`,
	 * `Pcolormesh`, `Cells`, `Hist2D`, `HexBin`, `ContourF`), beside the plot.
	 * @default false
	 */
	colorbar?: boolean;
	/** A title above the colour bar. */
	colorbarLabel?: string;
	/**
	 * Reveal, 0..1: the frame draws in the first half, the layers in the second,
	 * and legend entries fade in over the last tenth.
	 * @default 1
	 */
	progress?: number;
	/**
	 * How the layers reveal: `"layers"` each in its own way (lines sweep, bars
	 * grow); `"x"` one front sweeping left to right with every layer drawn whole
	 * behind it.
	 * @default "layers"
	 */
	reveal?: LayersReveal;
	/**
	 * Paint the layers only inside the plotting area (axes and titles are never
	 * clipped). Turn on when a range is fixed short of the data, or animates.
	 * @default false
	 */
	clip?: boolean;
	/**
	 * Tooltips for every layer: `true` gives each layer its default tooltip,
	 * `false` turns all off, an object sets options. A layer's own `tooltip`
	 * wins. Omitted, only layers given a `tooltip` show one.
	 */
	tooltip?: boolean | ChartTooltipOptions;
	/** Paint order of the frame; higher draws later. */
	zIndex?: number;
	/** Set to false to hide the frame; layers keep their own `visible`. */
	visible?: boolean;
	/** The layers, placed in the plot's coordinate context. */
	children?: readonly SceneNode[];
}

/**
 * Options for a `chart`'s tooltips (`tooltip`).
 *
 * @see https://sophistry.dev/guides/charts/#tooltips
 * @category Charts
 */
export interface ChartTooltipOptions {
	/**
	 * `"item"`: hovering a mark shows its datum. `"x"`: one shared tooltip for
	 * every line and point at the x nearest the pointer, with a crosshair.
	 * @default "item"
	 */
	mode?: "item" | "x";
	/**
	 * Where a hover tooltip stands: `"pointer"` above the pointer, or `"datum"`
	 * above the mark. Tap and keyboard tooltips always stand above the mark.
	 * @default "pointer"
	 */
	anchor?: TooltipAnchor;
	/** Formatters keyed by channel (`x`, `y`, `series`, `size`, `value`, …), replacing the axis's or legend's format. A layer's own `format` wins. */
	format?: TooltipFormat;
}

/**
 * Options for a `chart`'s size key (`sizeLegend`).
 *
 * @category Charts
 */
export interface ChartSizeLegendOptions {
	/**
	 * A title above the circles; `""` for none. With several keys, titles the first. Defaults to
	 * the layer's `size` channel name, when it is a key.
	 */
	title?: string;
	/**
	 * The values to draw circles for, in every key. Defaults to up to three round values of each
	 * key's scale.
	 */
	values?: readonly number[];
	/** How a value is written. Defaults to the axes' formatting. */
	format?: (value: number) => string;
}

/**
 * How a `chart`'s layers share its non-positional scales (`scales`).
 *
 * @category Charts
 */
export interface ChartScales {
	/**
	 * Sized layers (`Scatter`'s `size`): one scale for all, or each its own.
	 * A layer's own `sizeMaxValue` always wins.
	 * @default "shared"
	 */
	size?: "shared" | "independent";
}

/**
 * What `chartHandle(node)` hands back.
 *
 * @category Charts
 */
export interface ChartHandle {
	/** The plot's coordinate system. A band x axis centres category `i` at `i + 0.5`; a band y axis counts from the top. */
	coords: CoordinateSystem;
	/** The x axis's band scale, when x is categorical. */
	xBand: BandScale | undefined;
	/** The y axis's band scale, when y is categorical. */
	yBand: BandScale | undefined;
	/** A category's colour from the chart's colour scale, as a CSS string. */
	color(key: BandKey): string;
	/** The colour scale's categories in order, as the legend lists them. */
	colorDomain(): readonly BandKey[];
}

/**
 * What one layer contributes to the frame's colour scale and legend.
 *
 * @category Charts
 */
export interface ColorExtent {
	/** The categories the layer colours by, in order. */
	categories: readonly BandKey[];
	/** How the layer's marks look in the legend. Defaults to a filled square. */
	mark?: LegendMark;
	/** During a keyed transition: the categories at each end, so the legend can fade entries in and out. Omitted, all at both ends. */
	ends?: { from: readonly BandKey[]; to: readonly BandKey[] };
	/**
	 * The order the legend lists these categories in, where it should differ from `categories`
	 * (which also orders the colours): a stack lists its top band first, so the legend reads
	 * down as the bands do. Omitted, `categories`' order.
	 */
	legendOrder?: readonly BandKey[];
	/**
	 * During a keyed transition: `legendOrder` at each end, so the legend's entries slide from
	 * one order to the other. Omitted, `legendOrder` at both.
	 */
	legendOrders?: { from: readonly BandKey[]; to: readonly BandKey[] };
}

/**
 * What a layer that sizes its marks by value contributes to the frame's
 * size key: its square-root size scale, in scene units.
 *
 * @category Charts
 */
export interface SizeExtent extends SizeScale {
	/** The radii of a value of 0 and of `maxValue`. */
	range: readonly [number, number];
	/** The channel's name: the key's default title. */
	label?: string;
	/** During a keyed transition: the far end's `maxValue`, when each end is scaled on its own. */
	to?: number;
	/** The layer pins its scale (`sizeMaxValue`), so a shared size scale does not replace it. */
	pinned?: boolean;
}

/**
 * The shared size scale of a chart's sized layers (or a `<Facet>`'s panels):
 * the greatest maximum any of them reports, at each end of a transition.
 *
 * @category Charts
 */
export interface SharedSizeDomain {
	/** The shared maximum at `blend` 0 (or always, without a transition). */
	from: number;
	/** The shared maximum at `blend` 1. */
	to: number;
}

/**
 * What a layer that colours by value contributes to the frame's colour bar.
 *
 * @category Charts
 */
export interface RampExtent {
	/** The values the colormap spans, `[low, high]`. */
	domain: readonly [number, number];
	/** The colormap: 0..1 (low to high) to a CSS colour. */
	colormap: Colormap;
	/**
	 * The layer's colour norm over `domain` (log, diverging), so the bar's ticks
	 * match the layer. Defaults to linear.
	 */
	scale?: Scale;
}

/**
 * A layer's keyed data transition in progress, as reported to its
 * `chart`: the far end's extents and whether marks enter or exit.
 *
 * @category Charts
 */
export interface LayerTransition {
	/**
	 * The layer's blend, 0..1. The frame stages its domains on the first
	 * transitioning layer's blend, so drive a chart's layers from one track.
	 */
	t: number;
	/** How the blend is spent. @default "staged" */
	staging?: JoinStaging;
	/** The `to` data's extent on x. Omitted, the layer's `x` extent. */
	x?: AxisExtent;
	/** The `to` data's extent on y. Omitted, the layer's `y` extent. */
	y?: AxisExtent;
	/** The `to` data's extent on the secondary y axis (inside a `secondaryY`). */
	y2?: AxisExtent;
	/** The `to` data's extent on the secondary x axis (inside a `secondaryX`). */
	x2?: AxisExtent;
	/** Some mark enters (its key is only in `to`). */
	enters?: boolean;
	/** Some mark exits (its key is only in `data`). */
	exits?: boolean;
}

/**
 * What one layer contributes to fitting one axis.
 *
 * @category Charts
 */
export interface AxisExtent {
	/** Values the axis must show; only the extremes matter and non-finite ones are ignored. */
	values?: readonly number[];
	/** Categories the axis must show, in order. Any makes an unspecified axis a band axis. */
	categories?: readonly BandKey[];
	/** The layer's marks measure from zero (bars, areas), so zero must be in view. */
	zero?: boolean;
	/** Band axes: the gap between bands this layer suits (cells want none). The axis's own `padding` wins, then the first layer's. */
	padding?: number;
}

/**
 * A layer's report to its `chart`: an {@link AxisExtent} per axis.
 *
 * @category Charts
 */
export interface ChartLayerExtent {
	x?: AxisExtent;
	y?: AxisExtent;
	/** The secondary y axis's extent; a `secondaryY` moves the layer's `y` here. */
	y2?: AxisExtent;
	/** The secondary x axis's extent; a `secondaryX` moves the layer's `x` here. */
	x2?: AxisExtent;
	/**
	 * Room the layer draws in outside the plotting area, per side (e.g. a
	 * clustered heatmap's dendrograms). The frame keeps other guides clear of it
	 * and gives its position through ``frame.marginBox(side)``.
	 */
	margin?: ChartMargin;
	/** The categories the layer colours through the frame's colour scale (its `series`). */
	color?: ColorExtent;
	/** The colormap and value range the layer colours by, for the colour bar. */
	ramp?: RampExtent;
	/** The layer's size scale, for the size key. */
	size?: SizeExtent;
	/** The layer fills the plotting area under the axes (an image, a mesh), so axis numbers get a halo (`numberHalo`). */
	covers?: boolean;
	/** A keyed data transition: `x`/`y` above are the `blend` 0 end, this carries the far end. Fitted axes blend between the two. */
	transition?: LayerTransition;
}

/**
 * One end of a keyed transition whose fitted axis changes kind (band ↔
 * continuous): the plot with that axis as it is at this end.
 *
 * @category Extending
 */
export interface ChartEnd {
	/** The plot's coordinates at this end: what this end's data maps through. */
	coords: CoordinateSystem;
	/** The x axis's band scale at this end, when x is categorical there. */
	xBand: BandScale | undefined;
	/** The y axis's band scale at this end, when y is categorical there. */
	yBand: BandScale | undefined;
	/** Where the axes stand at this end, as {@link ChartFrame.axesAt}. */
	axesAt: { x: number; y: number };
}

/**
 * The plot at both ends of a transition whose fitted axis changes kind
 * (band ↔ continuous). A mark draws each end's datum through that end's plot
 * and blends the two in scene units during the update stage.
 *
 * @category Extending
 */
export interface ChartEnds {
	/** The x axis changes kind (its ends are `from` and `to`). */
	x: boolean;
	/** The y axis changes kind. */
	y: boolean;
	/** The plot at the `blend` 0 end. */
	from: ChartEnd;
	/** The plot at the `blend` 1 end. */
	to: ChartEnd;
}

/**
 * What a layer reads from its chart: one immutable snapshot of the frame,
 * provided through `chartContext` and replaced (a new object) whenever any
 * field changes, so reading it with `ctx.context(chartContext)` reruns
 * exactly the layers' `update`. Never keep one across updates.
 *
 * @category Extending
 */
export interface ChartFrame {
	coords: CoordinateSystem;
	xBand: BandScale | undefined;
	yBand: BandScale | undefined;
	/** The layers' reveal, 0..1: 0 until the frame has drawn (straight to 1 under `reveal="x"`). */
	dataProgress: number;
	/** The frame's own reveal, 0..1, for marks that belong with the axes, like category names. */
	frameProgress: number;
	/**
	 * Where the axes are drawn, in data units: `x` is where the y axis stands,
	 * `y` where the x axis runs. Differs from `coords.crossing()` (the baseline
	 * marks measure from) when an axis's `position` moved it.
	 */
	axesAt: { x: number; y: number };
	/** The categorical colour scale over every layer's series. */
	colorScale: OrdinalColorScale;
	/**
	 * The shared maximum a sized layer scales to unless it pins its own
	 * (`sizeMaxValue`). Undefined under `scales={{ size: "independent" }}` or
	 * with no sized layer. Read it for drawing, never in the layer's report.
	 */
	sizeDomain: SharedSizeDomain | undefined;
	/** The stages of the running keyed transition (see {@link LayerTransition}), or undefined. */
	join: JoinStages | undefined;
	/** The plot at each end while a transition changes a fitted axis's kind (see {@link ChartEnds}); undefined otherwise. */
	ends: ChartEnds | undefined;
	/** The chart's tooltip state, for marks with a `tooltip` prop (also provided as `tooltipContext`). */
	tooltip: TooltipState;
	/**
	 * How the chart writes a channel's value, for tooltips: `"x"`/`"y"` as their
	 * axis does, `"series"` as the legend does, `"size"` as the size key does.
	 * Inside a `secondaryY` or `secondaryX`, the secondary axis's.
	 */
	format(channel: ChartFormatChannel): (value: number | BandKey) => string;
	/** The scene-unit band a side's reserved margin occupies (see {@link ChartLayerExtent.margin}); empty when none is reserved. */
	marginBox(side: ChartSide): Bounds;
}

/**
 * Where a chart's layers send their reports: provided once by the chart
 * through `chartLayersContext` (stable for the chart's life; `secondaryX` /
 * `secondaryY` provide a wrapper that moves reports onto their axes).
 *
 * @category Extending
 */
export interface ChartLayers {
	/**
	 * Sets `owner`'s report (`null` withdraws it, on dispose). The chart
	 * refits only when the report changed by value; only the extremes of
	 * each `values` array count. The same report object as last time is
	 * skipped without being read, so don't change a report (or its `values`)
	 * in place: make a new one.
	 */
	report(owner: object, extent: ChartLayerExtent | null): void;
}

/**
 * The channels {@link ChartFrame.format} writes values of.
 *
 * @category Extending
 */
export type ChartFormatChannel = "x" | "y" | "series" | "size";

/**
 * A side of the plotting area.
 *
 * @category Charts
 */
export type ChartSide = "top" | "right" | "bottom" | "left";

/**
 * Room reserved beside the plotting area, per side, in scene units.
 *
 * @category Charts
 */
export type ChartMargin = Partial<Record<ChartSide, number>>;
