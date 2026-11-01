/**
 * `contourF`: filled contours of a gridded field, drawn as one path batch
 * (one closed item per band, all its rings one outline). Bands come up
 * together with their `progress` (a stroke traces),
 * or fade in lowest first under `stagger`.
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
import { clamp01 } from "@sophistry/core/internal";
import type { RampScaleProps } from "../color-norm.js";
import { colorNorm, normLevels, rampOf } from "../color-norm.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { RampExtent } from "../frame/types.js";
import type { ContourBand } from "../math/contourf.js";
import { contourBands } from "../math/contourf.js";
import { dataExtent } from "../math/shared/gridExtent.js";
import { staggered } from "../stagger.js";
import { keyedMemo } from "../util.js";
import type { ContourColors } from "./contour.js";
import type { PlacedBand } from "./contour-shared.js";
import {
	bandColor,
	contourRamp,
	fadeBands,
	placeBands,
	revealBands,
} from "./contour-shared.js";
import { levelRanks } from "./tri-shared.js";

const DEFAULT_LEVELS = 8;

/**
 * Props of {@link contourF}.
 *
 * @category Charts
 */
export interface ContourFProps extends RampScaleProps {
	/** Column coordinates in data units, one per `values[row]` entry. */
	xs: readonly number[];
	/** Row coordinates in data units, one per `values` entry. */
	ys: readonly number[];
	/**
	 * `values[row][col]` is the sample at `(xs[col], ys[row])`; cells touching a non-finite sample
	 * are skipped.
	 */
	values: readonly (readonly number[])[];
	/**
	 * Explicit band boundaries, or a count of evenly spaced ones spanning the data's min and max
	 * (`N` levels make `N - 1` bands; spaced along `rampScale` when set).
	 * @default 8
	 */
	levels?: readonly number[] | number;
	/**
	 * Colour ramp a band's fill is sampled from, by its midpoint between the field's min and max:
	 * CSS stops, a colormap name, or `(t) => colour`. Defaults to two theme series colours.
	 */
	ramp?: ColorRampSpec;
	/**
	 * Fraction of `progress` spent staggering the bands, lowest first, 0..0.95; 0 draws every band
	 * at once.
	 * @default 0
	 */
	stagger?: number;
	/** One fill for every band, instead of the ramp. */
	fill?: string;
	/** Band outline. @default "none" */
	stroke?: string;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1: the bands come up together (fade in one by one under `stagger`). @default 1 */
	progress?: number;
	/** Paint order. Defaults to `UNDER_AXES_Z_INDEX` (above the grid, under the axes). */
	zIndex?: number;
	/** Set to false to hide the bands. */
	visible?: boolean;
}

/** What a contourF keeps between updates. */
interface ContourFState {
	layer: ChartLayer;
	colors: (
		deps: readonly unknown[],
		make: () => ContourColors,
	) => ContourColors;
	rampExtent: (deps: readonly unknown[], make: () => RampExtent) => RampExtent;
	bands: (deps: readonly unknown[], make: () => ContourBand[]) => ContourBand[];
	ranks: (
		deps: readonly unknown[],
		make: () => Map<number, number>,
	) => Map<number, number>;
	placed: (deps: readonly unknown[], make: () => PlacedBand[]) => PlacedBand[];
	batch: PathBatchNode<PathBatchItemsProps>;
}

const states = new WeakMap<object, ContourFState>();

function draw(ctx: CompositeContext<ContourFProps>): SceneNode[] {
	const state = states.get(ctx.node) as ContourFState;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords)
		throw new Error("ContourF must be placed inside a chart or axes.");
	const theme = ctx.theme;
	const colors = state.colors(
		[props.values, props.rampScale, props.rampMidpoint, props.ramp, theme],
		() => ({
			// A log or diverging scale, when asked for: it colours the bands and spaces a count of levels.
			norm: colorNorm(props.values.flat(), {
				rampScale: props.rampScale,
				rampMidpoint: props.rampMidpoint,
			}),
			ramp: contourRamp(props.ramp, theme),
			extent: dataExtent(props.values) ?? [0, 1],
		}),
	);
	state.layer.report({
		covers: true,
		x: { values: props.xs },
		y: { values: props.ys },
		ramp: state.rampExtent([colors], () =>
			rampOf(colors.norm, colors.extent, colors.ramp),
		),
	});
	const bands = state.bands(
		[props.xs, props.ys, props.values, props.levels, colors.norm],
		() => {
			const levels = props.levels ?? DEFAULT_LEVELS;
			return contourBands(
				props.xs,
				props.ys,
				props.values,
				colors.norm && !Array.isArray(levels)
					? normLevels(colors.norm, levels as number, "cover")
					: (levels as number[]),
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
	);
	const ranks = state.ranks([bands], () =>
		levelRanks(bands.map((band) => band.loLevel)),
	);
	const own = state.layer.progress(props.progress);
	// Unstaggered, every band has the layer's `progress`
	// (the fill comes up, a stroke traces); staggered, each band fades on
	// its own, lowest first.
	const stagger = props.stagger;
	const items = stagger
		? fadeBands(placed, (level) =>
				staggered(
					clamp01(own ?? 1),
					ranks.get(level) ?? 0,
					ranks.size,
					stagger,
				),
			)
		: revealBands(placed, () => clamp01(own ?? 1));
	state.batch.update({
		items,
		stroke: props.stroke ?? "none",
		strokeWidth: props.strokeWidth,
		opacity: props.opacity,
		// Bands cover the plane: under the axes and their numbers.
		zIndex: props.zIndex ?? UNDER_AXES_Z_INDEX,
		visible: props.visible,
	});
	return [state.batch];
}

/**
 * Filled contours of a gridded field: one band between consecutive levels, coloured by the
 * band's midpoint; samples outside the levels are left blank. Paints under the axes by default
 * (`zIndex` `UNDER_AXES_Z_INDEX`). Inside a `chart` or `axes`; drawn as one path batch. For
 * lines use `contour`. See {@link contourBands} for the geometry alone.
 *
 * @example
 * ```ts
 * import { chart, contourF } from "@sophistry/charts";
 *
 * const xs = [-2, -1, 0, 1, 2];
 * const ys = [-2, -1, 0, 1, 2];
 * const values = ys.map((y) => xs.map((x) => Math.exp(-(x * x + y * y) / 2)));
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	colorbar: true,
 * 	children: [contourF.create({ xs, ys, values, levels: 8, ramp: "viridis" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const contourF = defineComposite<ContourFProps>({
	name: "ContourF",
	props: {
		xs: { default: [], invalidates: Invalidate.UPDATE },
		ys: { default: [], invalidates: Invalidate.UPDATE },
		values: { default: [], invalidates: Invalidate.UPDATE },
		levels: { invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMidpoint: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		fill: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			colors: keyedMemo(),
			rampExtent: keyedMemo(),
			bands: keyedMemo(),
			ranks: keyedMemo(),
			placed: keyedMemo(),
			batch: pathBatch.create({ items: [] }),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
