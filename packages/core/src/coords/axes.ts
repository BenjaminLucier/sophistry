/**
 * `axes`: two number lines and the coordinate system they imply (Manim's
 * `Axes`). The layout is shared with `numberPlane` and `complexPlane`, which
 * draw the same axes over a grid.
 */

import type { Point, Range, RangeTransition } from "../geometry/index.js";
import { currentRange } from "../geometry/index.js";
import type { Readable } from "../reactive/index.js";
import type { CompositeContext } from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import { measuresText } from "../scene/fonts.js";
import type { TextNode, TextNodeProps } from "../scene/text.js";
import { text } from "../scene/text.js";
import type { PropsDescriptor, SceneNode } from "../scene/types.js";
import { LEFT, ORIGIN, RIGHT, UP } from "../spec/layout.js";
import {
	axisTicksAt,
	contains,
	originBlocks,
	originFade,
	originWeight as originWeightOf,
	resolveOrigin,
	weightedTicks,
	yieldOrigin,
} from "./axis-composition.js";
import { anchoredLabelProps } from "./axis-labels.js";
import type {
	AxisPosition,
	CoordinateSystem,
	XAxisPosition,
	YAxisPosition,
} from "./coords.js";
import {
	axisFacesFar,
	axisPositionValue,
	createCartesianCoords,
	createPhases,
	publishCoords,
} from "./coords.js";
import { stablePoint } from "./grid-lines.js";
import type { NumberLineProps } from "./number-line.js";
import { numberLine } from "./number-line.js";

/**
 * Everything a {@link numberLine} takes except the geometry `axes` decides for it.
 *
 * Used for the `axis`, `xAxis` and `yAxis` props of {@link axes}: tick spacing,
 * number formatting, `scale`, label placement and stroke styling all go here.
 *
 * @category Coordinate systems & graphs
 */
export type AxisOptions = Omit<
	NumberLineProps,
	"range" | "length" | "center" | "rotation" | "children"
>;

/**
 * The keys of {@link AxisOptions} other than `progress`, read off the number
 * line's descriptor: every one is written on each update (undefined when
 * unset), so removing an option from `xAxis` reaches the line.
 */
const AXIS_OPTION_KEYS = (
	Object.keys(numberLine.descriptor) as (keyof NumberLineProps)[]
).filter(
	(key) =>
		key !== "range" &&
		key !== "length" &&
		key !== "center" &&
		key !== "rotation" &&
		key !== "children" &&
		key !== "progress",
) as (keyof AxisOptions)[];

const DEFAULT_AXIS_LABEL_FONT_SIZE = 0.34;
const AXIS_LABEL_GAP = 0.22;
/** Line, ticks, numbers — `numberLine`'s phases, reused for the end labels. */
const PHASES = 3;

/**
 * Props for {@link axes} (and, by extension, {@link numberPlane} and {@link complexPlane}).
 *
 * @category Coordinate systems & graphs
 */
export interface AxesProps {
	/**
	 * Data range of the x axis as `[min, max, step?]`. The optional step sets
	 * the major tick spacing.
	 *
	 * Or `{ from, to, t }` to animate the domain from one track, as on
	 * `chart` and `numberLine`: the coordinate system (so every graph
	 * inside), the axis and a `numberPlane`'s grid all map through the range
	 * blended at `t`, and ticks, numbers and grid lines cross-fade by value.
	 * A pure function of `t`, so it scrubs.
	 */
	xRange: Range | RangeTransition;
	/** Data range of the y axis as `[min, max, step?]`, or a `{ from, to, t }` transition; see `xRange`. */
	yRange: Range | RangeTransition;
	/** Scene-unit width of the plotting area (not a data quantity). */
	width: number;
	/** Scene-unit height of the plotting area (not a data quantity). */
	height: number;
	/**
	 * Centre of the plotting area in scene units — *not* the data origin. Defaults to the scene
	 * origin.
	 */
	center?: Point;
	/**
	 * Styling and tick options shared by both axes, plus `position`: where
	 * each axis line is drawn across the other axis — `"zero"` (the default:
	 * at the data origin, pinned to the nearest edge when it is out of range),
	 * `"edge"` (the bottom and the left), or a data value.
	 */
	axis?: AxisOptions & { position?: AxisPosition };
	/**
	 * Overrides for the x axis, merged over `axis`. `position` also takes
	 * `"bottom"` or `"top"` (numbers above the line).
	 */
	xAxis?: AxisOptions & { position?: XAxisPosition };
	/**
	 * Overrides for the y axis, merged over `axis`. The y axis puts its
	 * numbers on the left by default. `position` also takes `"left"` or
	 * `"right"` (numbers to the right).
	 */
	yAxis?: AxisOptions & { position?: YAxisPosition };
	/** Draw arrow tips at the far ends of both axes. Unset, each axis uses its own default (no tip). */
	tip?: boolean;
	/** Placed just past the far (positive) end of the x axis, wherever it is drawn. */
	xLabel?: string;
	/** Placed just past the far (top) end of the y axis. */
	yLabel?: string;
	/**
	 * Font size of `xLabel`/`yLabel`.
	 * @default 0.34
	 */
	axisLabelFontSize?: number;
	/**
	 * Reveal amount, 0..1, spent line, then ticks, then numbers.
	 * @default 1
	 */
	progress?: number;
	/** Paint order; higher draws later. */
	zIndex?: number;
	/** Set to false to hide the axes and their labels. */
	visible?: boolean;
	/** Placed inside the coordinate context, so they can plot in data space. */
	children?: readonly SceneNode[];
}

/**
 * Descriptor entries for every {@link AxesProps} key: everything reruns the
 * layout except `progress`, which the lines and labels bind to.
 *
 * @internal Shared by the planes.
 */
export const axesProps: PropsDescriptor<AxesProps> = {
	xRange: { invalidates: Invalidate.UPDATE },
	yRange: { invalidates: Invalidate.UPDATE },
	width: { invalidates: Invalidate.UPDATE },
	height: { invalidates: Invalidate.UPDATE },
	center: { invalidates: Invalidate.UPDATE },
	axis: { invalidates: Invalidate.UPDATE },
	xAxis: { invalidates: Invalidate.UPDATE },
	yAxis: { invalidates: Invalidate.UPDATE },
	tip: { invalidates: Invalidate.UPDATE },
	xLabel: { invalidates: Invalidate.UPDATE },
	yLabel: { invalidates: Invalidate.UPDATE },
	axisLabelFontSize: {
		default: DEFAULT_AXIS_LABEL_FONT_SIZE,
		invalidates: Invalidate.UPDATE,
	},
	progress: { default: 1, invalidates: Invalidate.NONE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
	children: { kind: "children", invalidates: Invalidate.NONE },
};

/** What an axes layout keeps between updates. */
export interface AxesState {
	phase: (index: number) => Readable<number>;
	coordsFor: (
		xMin: number,
		xMax: number,
		xStep: number | undefined,
		yMin: number,
		yMax: number,
		yStep: number | undefined,
		width: number,
		height: number,
		centerX: number,
		centerY: number,
		xScale: AxisOptions["scale"],
		yScale: AxisOptions["scale"],
		xBase: number | undefined,
		yBase: number | undefined,
	) => CoordinateSystem;
	xLine: SceneNode<NumberLineProps> | null;
	yLine: SceneNode<NumberLineProps> | null;
	xLabel: TextNode<TextNodeProps> | null;
	yLabel: TextNode<TextNodeProps> | null;
}

/** The cartesian system of one set of axes values. Immutable. */
function cartesian(
	xMin: number,
	xMax: number,
	xStep: number | undefined,
	yMin: number,
	yMax: number,
	yStep: number | undefined,
	width: number,
	height: number,
	centerX: number,
	centerY: number,
	xScale: AxisOptions["scale"],
	yScale: AxisOptions["scale"],
	xBase: number | undefined,
	yBase: number | undefined,
): CoordinateSystem {
	return createCartesianCoords({
		xRange: xStep === undefined ? [xMin, xMax] : [xMin, xMax, xStep],
		yRange: yStep === undefined ? [yMin, yMax] : [yMin, yMax, yStep],
		width,
		height,
		center: { x: centerX, y: centerY },
		// The axis components and `coordsToPoint` must share one `Scale`, or a log axis
		// would label its decades in one place and plot its graph in another.
		xScale,
		yScale,
		xBase,
		yBase,
	});
}

/**
 * The state an axes layout needs. Call once, in `setup`.
 *
 * @internal Shared by the planes.
 */
export function createAxesState<P extends { progress?: number }>(
	ctx: CompositeContext<P>,
): AxesState {
	return {
		phase: createPhases(ctx.prop("progress"), PHASES),
		coordsFor: ctx.memo(cartesian),
		xLine: null,
		yLine: null,
		xLabel: null,
		yLabel: null,
	};
}

/**
 * The coordinate system `props` imply: the ranges shown now (as given, or a
 * transition's blend) over the plotting area.
 *
 * @internal Shared by the planes.
 */
export function axesCoords(
	state: AxesState,
	props: Readonly<AxesProps>,
): CoordinateSystem {
	const xScale = props.xAxis?.scale ?? props.axis?.scale;
	const yScale = props.yAxis?.scale ?? props.axis?.scale;
	const xBase = props.xAxis?.base ?? props.axis?.base;
	const yBase = props.yAxis?.base ?? props.axis?.base;
	const xRange = currentRange(props.xRange, xScale, xBase);
	const yRange = currentRange(props.yRange, yScale, yBase);
	const center = props.center ?? ORIGIN;
	return state.coordsFor(
		xRange[0],
		xRange[1],
		xRange[2],
		yRange[0],
		yRange[1],
		yRange[2],
		props.width,
		props.height,
		center.x,
		center.y,
		xScale,
		yScale,
		xBase,
		yBase,
	);
}

/**
 * Every axis option, set or not, so an option removed from `xAxis` is unset
 * on the line.
 *
 * @internal Shared by the planes.
 */
export function fullOptions(options: AxisOptions): AxisOptions {
	const full: Record<string, unknown> = {};
	for (const key of AXIS_OPTION_KEYS) full[key] = options[key];
	return full as AxisOptions;
}

/**
 * Builds (or brings up to date) the axes' nodes for `props`: the x and y
 * number lines, then the end labels. Does not publish the system or place
 * the caller's children; the composite does.
 *
 * @internal Shared by the planes.
 * @returns The nodes, in paint order, and the coordinate system.
 */
export function axesLayout<P extends object>(
	ctx: CompositeContext<P>,
	state: AxesState,
	props: Readonly<AxesProps>,
): { nodes: SceneNode[]; coords: CoordinateSystem } {
	const theme = ctx.theme;
	const fontFamily = theme.defaults.fontFamily;
	const coords = axesCoords(state, props);
	const xRange = coords.xRange();
	const yRange = coords.yRange();
	const xScale = props.xAxis?.scale ?? props.axis?.scale;
	const xBase = props.xAxis?.base ?? props.axis?.base;
	const center = props.center ?? ORIGIN;

	const xPosition = props.xAxis?.position ?? props.axis?.position;
	const yPosition = props.yAxis?.position ?? props.axis?.position;
	/**
	 * Where each axis line is drawn, in data units: the y value the x axis
	 * runs along and the x value the y axis stands at. The data origin pinned
	 * into the plotting area unless a `position` says otherwise; `crossing()`
	 * (the baseline graphs and annotations measure from) stays at the origin.
	 */
	const xAxisAt = axisPositionValue(xPosition, yRange);
	const yAxisAt = axisPositionValue(yPosition, xRange);
	/** Where the axes are drawn, in scene units. Everything positional below hangs off this one point. */
	const crossing = coords.coordsToPoint(yAxisAt, xAxisAt);

	const { position: _sharedPosition, ...sharedRest } = props.axis ?? {};
	const shared: AxisOptions = {
		tip: props.tip,
		zIndex: props.zIndex,
		visible: props.visible,
		...sharedRest,
	};

	const { position: _xPosition, ...xRest } = props.xAxis ?? {};
	const xMerged: AxisOptions = { ...shared, ...xRest };
	// A top axis writes its numbers above the line, away from the plot.
	const xOptions: AxisOptions =
		axisFacesFar(xPosition) && xMerged.numberDirection === undefined
			? { ...xMerged, numberDirection: UP }
			: xMerged;

	/**
	 * How strongly the x axis writes a "0" where the y axis's "0" would be,
	 * 0..1: both lines through the origin, and x's 0 tick at its weight — 1
	 * on a plain range, fading in or out while a transition carries 0 onto
	 * or off the x axis.
	 */
	const crossesAtOrigin =
		xAxisAt === 0 &&
		yAxisAt === 0 &&
		contains(xRange, 0) &&
		contains(yRange, 0);
	const originWeight = originWeightOf(
		xOptions,
		() => crossesAtOrigin,
		props.xRange,
		(given) =>
			weightedTicks(
				(at) =>
					axisTicksAt(
						{
							scale: xScale,
							base: xBase,
							timeZone: xOptions.timeZone,
							step: xOptions.step,
						},
						at,
					).majors,
				given,
				xRange,
			),
	);

	/**
	 * The y axis differs in two defaults: its numbers sit to the left, and it
	 * drops the origin's label when the x axis is already showing one. Two "0"s
	 * meeting at a right angle is the single most common way axes look untidy;
	 * while a transition fades x's "0", y's fades the other way.
	 */
	const { position: _yPosition, ...yRest } = props.yAxis ?? {};
	const yMerged: AxisOptions = { ...shared, ...yRest };
	const yDirection =
		yMerged.numberDirection ?? (axisFacesFar(yPosition) ? RIGHT : LEFT);
	/** Neither "0" is written where the other axis's line runs through it. */
	const origin = resolveOrigin(
		crossesAtOrigin,
		originWeight,
		originBlocks(xRange, yRange, xOptions.numberDirection, yDirection),
	);
	const yOptions: AxisOptions = {
		numberDirection: axisFacesFar(yPosition) ? RIGHT : LEFT,
		...yieldOrigin(yMerged, originFade(origin.yYield)),
	};

	const xLineProps = {
		...fullOptions(
			origin.xYield > 0
				? yieldOrigin(xOptions, originFade(origin.xYield))
				: xOptions,
		),
		range: props.xRange,
		length: props.width,
		center: stablePoint(state.xLine?.get("center"), {
			x: center.x,
			y: crossing.y,
		}),
		progress: ctx.prop("progress" as keyof P) as Readable<number | undefined>,
	};
	const yLineProps = {
		...fullOptions(yOptions),
		range: props.yRange,
		length: props.height,
		center: stablePoint(state.yLine?.get("center"), {
			x: crossing.x,
			y: center.y,
		}),
		rotation: Math.PI / 2,
		progress: ctx.prop("progress" as keyof P) as Readable<number | undefined>,
	};
	if (state.xLine) state.xLine.update(xLineProps);
	else state.xLine = numberLine.create(xLineProps);
	if (state.yLine) state.yLine.update(yLineProps);
	else state.yLine = numberLine.create(yLineProps);

	const labelColor = theme.palette.foreground;
	const labelSize = props.axisLabelFontSize ?? DEFAULT_AXIS_LABEL_FONT_SIZE;
	const nodes: SceneNode[] = [state.xLine, state.yLine];

	/** One end label: kept while its text is set, disposed when it is cleared. */
	const endLabel = (
		current: TextNode<TextNodeProps> | null,
		content: string | undefined,
		at: Point,
		direction: Point,
		halo: AxisOptions["numberHalo"],
	): TextNode<TextNodeProps> | null => {
		if (!content) {
			current?.dispose();
			return null;
		}
		measuresText(ctx);
		const options = anchoredLabelProps(
			{
				text: content,
				at,
				direction,
				gap: AXIS_LABEL_GAP,
				fontSize: labelSize,
				color: labelColor,
				zIndex: props.zIndex,
				halo,
			},
			fontFamily,
			current?.get("place"),
		);
		const next = { ...options, progress: state.phase(2) };
		if (current) {
			current.update(next);
			return current;
		}
		return text.create(next);
	};
	state.xLabel = endLabel(
		state.xLabel,
		props.xLabel,
		coords.coordsToPoint(xRange[1], xAxisAt),
		RIGHT,
		xOptions.numberHalo,
	);
	state.yLabel = endLabel(
		state.yLabel,
		props.yLabel,
		coords.coordsToPoint(yAxisAt, yRange[1]),
		UP,
		yOptions.numberHalo,
	);
	if (state.xLabel) nodes.push(state.xLabel);
	if (state.yLabel) nodes.push(state.yLabel);
	return { nodes, coords };
}

/** Per-node axes state. */
const states = new WeakMap<object, AxesState>();

function layout(ctx: CompositeContext<AxesProps>): SceneNode[] {
	let state = states.get(ctx.node);
	if (!state) {
		state = createAxesState(ctx);
		states.set(ctx.node, state);
	}
	const { nodes, coords } = axesLayout(ctx, state, ctx.props);
	publishCoords(ctx, coords);
	return [...nodes, ...ctx.children];
}

/**
 * Two number lines and the coordinate system they imply (Manim's `Axes`).
 * `width`/`height` are the plotting area and `center` its middle; data space is
 * `xRange` by `yRange`. The axes cross at the data origin, or the nearest edge
 * when it is out of range; an axis's `position` moves its line without moving
 * that origin. Children plot in data space (they read `coordsContext`); use
 * `coordsOf(node)` from outside. Every prop can be written or bound; a change
 * that moves the mapping publishes a new coordinate system, and everything
 * plotted inside follows.
 *
 * @example
 * ```ts
 * import { axes, coordsOf, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const plot = scene.add(
 * 	axes.create({ xRange: [-5, 5, 1], yRange: [-3, 3, 1], width: 10, height: 6, xLabel: "x" }),
 * );
 * coordsOf(plot)?.coordsToPoint(1, 2); // { x: 1, y: 2 }
 * ```
 *
 * @see {@link https://sophistry.dev/guides/coordinate-systems/}
 * @see {@link numberPlane}
 * @category Coordinate systems & graphs
 */
export const axes = defineComposite<AxesProps>({
	name: "Axes",
	props: axesProps,
	setup: layout,
	update: (_changed, ctx) => layout(ctx),
});
