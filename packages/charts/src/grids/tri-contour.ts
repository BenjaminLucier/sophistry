/**
 * `triContour` and `triContourF`: iso-lines and filled bands of a field
 * sampled at scattered points, each drawn as one path batch. Lines draw
 * along their length level by level, bands fade in, lowest first.
 */

import type {
	ColorRampSpec,
	CompositeContext,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	pathBatch,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { RampScaleProps } from "../color-norm";
import { colorNorm, normLevels, rampOf } from "../color-norm";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import { dateSinkContext } from "../data/channels";
import type { RampExtent } from "../frame/types";
import type { ContourLine } from "../math/contour";
import type { ContourBand } from "../math/contourf";
import { tricontourBands, tricontourLines } from "../math/tricontour";
import type { AnyDatum } from "../props";
import { keyedMemo } from "../util";
import type { ContourColors } from "./contour";
import type { PlacedBand, PlacedLine } from "./contour-shared";
import {
	bandColor,
	contourRamp,
	fadeBands,
	levelColor,
	placeBands,
	placeLines,
	revealLines,
} from "./contour-shared";
import type { TriChartBaseProps, TriPoints } from "./tri-shared";
import { levelRanks, triPoints, triReveal, valueExtent } from "./tri-shared";

const DEFAULT_LEVELS = 8;

/**
 * Props of {@link triContour}.
 *
 * @category Charts
 */
export interface TriContourProps<T = unknown>
	extends TriChartBaseProps<T>,
		RampScaleProps {
	/**
	 * Explicit iso-line values, or a count of evenly spaced levels strictly between the data's min
	 * and max (spaced along `rampScale` when set).
	 * @default 8
	 */
	levels?: readonly number[] | number;
	/**
	 * Colour ramp a level's colour is sampled from, by where it falls between the data's min and
	 * max: a colormap name, CSS stops or `(t) => colour`. Defaults to two theme series colours.
	 */
	ramp?: ColorRampSpec;
	/** One colour for every line, instead of the ramp. */
	stroke?: string;
	/** Line width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the lines. */
	visible?: boolean;
}

/**
 * Props of {@link triContourF}.
 *
 * @category Charts
 */
export interface TriContourFProps<T = unknown>
	extends TriChartBaseProps<T>,
		RampScaleProps {
	/**
	 * Explicit band boundaries, or a count of evenly spaced ones spanning the data's min and max
	 * (`N` levels make `N - 1` bands; spaced along `rampScale` when set).
	 * @default 8
	 */
	levels?: readonly number[] | number;
	/**
	 * Colour ramp a band's fill is sampled from, by its midpoint between the data's min and max.
	 * Defaults to two theme series colours.
	 */
	ramp?: ColorRampSpec;
	/** One fill for every band, instead of the ramp. */
	fill?: string;
	/** Band outline. @default "none" */
	stroke?: string;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Paint order. Defaults to `UNDER_AXES_Z_INDEX` (above the grid, under the axes). */
	zIndex?: number;
	/** Set to false to hide the bands. */
	visible?: boolean;
}

/** What both tri-contours keep between updates. */
interface TriState<G> {
	layer: ChartLayer;
	points: (deps: readonly unknown[], make: () => TriPoints) => TriPoints;
	colors: (
		deps: readonly unknown[],
		make: () => ContourColors,
	) => ContourColors;
	rampExtent: (deps: readonly unknown[], make: () => RampExtent) => RampExtent;
	shapes: (deps: readonly unknown[], make: () => G[]) => G[];
	ranks: (
		deps: readonly unknown[],
		make: () => Map<number, number>,
	) => Map<number, number>;
	placed: (deps: readonly unknown[], make: () => unknown[]) => unknown[];
	batch: PathBatchNode<PathBatchItemsProps>;
}

const states = new WeakMap<object, TriState<unknown>>();

function setupState<G>(ctx: CompositeContext<object>): TriState<G> {
	const state: TriState<G> = {
		layer: chartLayer(ctx),
		points: keyedMemo(),
		colors: keyedMemo(),
		rampExtent: keyedMemo(),
		shapes: keyedMemo(),
		ranks: keyedMemo(),
		placed: keyedMemo(),
		batch: pathBatch.create({ items: [] }),
	};
	states.set(ctx.node, state as TriState<unknown>);
	return state;
}

/** The points and their colours, shared by both tri-contours. */
function prepare<G>(
	ctx: CompositeContext<
		TriChartBaseProps<AnyDatum> & RampScaleProps & { ramp?: ColorRampSpec }
	>,
	name: string,
) {
	const state = states.get(ctx.node) as TriState<G>;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords)
		throw new Error(`${name} must be placed inside a chart or axes.`);
	const dates = ctx.context(dateSinkContext);
	const points = state.points([props.data, props.x, props.y, props.value], () =>
		triPoints(props, dates),
	);
	const theme = ctx.theme;
	const colors = state.colors(
		[points, props.rampScale, props.rampMidpoint, props.ramp, theme],
		() => ({
			// A log or diverging scale, when asked for: it colours the shapes and spaces a count of levels.
			norm: colorNorm(points.zs, {
				rampScale: props.rampScale,
				rampMidpoint: props.rampMidpoint,
			}),
			ramp: contourRamp(props.ramp, theme),
			extent: valueExtent(points.zs),
		}),
	);
	return { state, coords, points, colors };
}

function drawLines(
	ctx: CompositeContext<TriContourProps<AnyDatum>>,
): SceneNode[] {
	const props = ctx.props;
	const { state, coords, points, colors } = prepare<ContourLine>(
		ctx,
		"TriContour",
	);
	state.layer.report({ x: { values: points.xs }, y: { values: points.ys } });
	const lines = state.shapes(
		[points, props.levels, props.triangles, colors.norm],
		() => {
			const levels = props.levels ?? DEFAULT_LEVELS;
			return tricontourLines(
				points.xs,
				points.ys,
				points.zs,
				colors.norm && !Array.isArray(levels)
					? normLevels(colors.norm, levels as number, "between")
					: (levels as number[]),
				{ triangles: props.triangles },
			);
		},
	);
	const placed = state.placed([lines, coords, colors, props.stroke], () =>
		placeLines(
			lines,
			coords,
			(level) =>
				props.stroke ??
				levelColor(colors.ramp, colors.norm, colors.extent, level),
		),
	) as PlacedLine[];
	const ranks = state.ranks([lines], () =>
		levelRanks(lines.map((line) => line.level)),
	);
	const own = state.layer.progress(props.progress);
	state.batch.update({
		items: revealLines(placed, (level) =>
			triReveal(own, ranks.get(level) ?? 0, ranks.size, props.stagger),
		),
		stroke: props.stroke ?? "none",
		strokeWidth: props.strokeWidth,
		opacity: props.opacity,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	return [state.batch];
}

function drawBands(
	ctx: CompositeContext<TriContourFProps<AnyDatum>>,
): SceneNode[] {
	const props = ctx.props;
	const { state, coords, points, colors } = prepare<ContourBand>(
		ctx,
		"TriContourF",
	);
	state.layer.report({
		covers: true,
		x: { values: points.xs },
		y: { values: points.ys },
		ramp: state.rampExtent([colors], () =>
			rampOf(colors.norm, colors.extent, colors.ramp),
		),
	});
	const bands = state.shapes(
		[points, props.levels, props.triangles, colors.norm],
		() => {
			const levels = props.levels ?? DEFAULT_LEVELS;
			return tricontourBands(
				points.xs,
				points.ys,
				points.zs,
				colors.norm && !Array.isArray(levels)
					? normLevels(colors.norm, levels as number, "cover")
					: (levels as number[]),
				{ triangles: props.triangles },
			).filter((band) => band.polygons.length > 0);
		},
	);
	const placed = state.placed([bands, coords, colors, props.fill], () =>
		placeBands(
			bands,
			coords,
			(lo, hi) =>
				props.fill ??
				bandColor(colors.ramp, colors.norm, colors.extent, lo, hi),
		),
	) as PlacedBand[];
	const ranks = state.ranks([bands], () =>
		levelRanks(bands.map((band) => band.loLevel)),
	);
	const own = state.layer.progress(props.progress);
	state.batch.update({
		items: fadeBands(placed, (level) =>
			triReveal(own, ranks.get(level) ?? 0, ranks.size, props.stagger),
		),
		stroke: props.stroke ?? "none",
		strokeWidth: props.strokeWidth,
		opacity: props.opacity,
		// Bands cover the plane: under the axes and their numbers.
		zIndex: props.zIndex ?? UNDER_AXES_Z_INDEX,
		visible: props.visible,
	});
	return [state.batch];
}

const triProps = {
	data: { default: [], invalidates: Invalidate.UPDATE },
	x: { invalidates: Invalidate.UPDATE },
	y: { invalidates: Invalidate.UPDATE },
	value: { invalidates: Invalidate.UPDATE },
	triangles: { invalidates: Invalidate.UPDATE },
	progress: { default: 1, invalidates: Invalidate.UPDATE },
	stagger: { invalidates: Invalidate.UPDATE },
	levels: { invalidates: Invalidate.UPDATE },
	ramp: { invalidates: Invalidate.UPDATE },
	rampScale: { invalidates: Invalidate.UPDATE },
	rampMidpoint: { invalidates: Invalidate.UPDATE },
	stroke: { invalidates: Invalidate.UPDATE },
	strokeWidth: { invalidates: Invalidate.UPDATE },
	opacity: { invalidates: Invalidate.UPDATE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
} as const;

/**
 * Iso-lines of a field sampled at scattered points: the points are triangulated (Delaunay, or
 * your own `triangles`) and each level traced across the mesh. Revealed level by level, lowest
 * first, each line along its length. Inside a `chart` or `axes`; drawn as one path batch. For
 * gridded data use `contour`; for filled bands `triContourF`. See {@link tricontourLines} for
 * the geometry alone.
 *
 * @example
 * ```ts
 * import { chart, triContour } from "@sophistry/charts";
 *
 * const samples = Array.from({ length: 40 }, (_, i) => {
 * 	const x = Math.cos(i * 2.4) * (i / 10);
 * 	const y = Math.sin(i * 2.4) * (i / 10);
 * 	return { x, y, v: x * y };
 * });
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	children: [triContour.create({ data: samples, x: "x", y: "y", value: "v", levels: 6 })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const triContour = defineComposite<TriContourProps<AnyDatum>>({
	name: "TriContour",
	props: triProps,
	setup: (ctx) => {
		setupState<ContourLine>(ctx as never);
		return drawLines(ctx);
	},
	update: (_changed, ctx) => drawLines(ctx),
});

/**
 * Filled contours over scattered points: each triangle clipped into the bands between
 * consecutive levels, one band an item, fading in lowest first. Paints under the axes by
 * default (`zIndex` `UNDER_AXES_Z_INDEX`) and feeds a chart's `colorbar`. Drawn as one path
 * batch. See {@link tricontourBands} for the geometry alone.
 *
 * @example
 * ```ts
 * import { chart, triContourF } from "@sophistry/charts";
 *
 * const samples = Array.from({ length: 40 }, (_, i) => {
 * 	const x = Math.cos(i * 2.4) * (i / 10);
 * 	const y = Math.sin(i * 2.4) * (i / 10);
 * 	return { x, y, v: x * y };
 * });
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	colorbar: true,
 * 	children: [triContourF.create({ data: samples, x: "x", y: "y", value: "v", ramp: "viridis" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const triContourF = defineComposite<TriContourFProps<AnyDatum>>({
	name: "TriContourF",
	props: { ...triProps, fill: { invalidates: Invalidate.UPDATE } },
	setup: (ctx) => {
		setupState<ContourBand>(ctx as never);
		return drawBands(ctx);
	},
	update: (_changed, ctx) => drawBands(ctx),
});
