/**
 * `contour`: iso-lines of a gridded field, drawn as one path batch (one open
 * item per connected line, stroked by its level). The reveal draws each
 * line along its length (the item's `progress`), staggered by level when
 * asked.
 */

import type {
	ColorRampSpec,
	CompositeContext,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, pathBatch } from "@sophistry/core";
import { clamp01 } from "@sophistry/core/internal";
import type { Colormap } from "@sophistry/core/themes";
import type { ColorNorm, RampScaleProps } from "../color-norm.js";
import { colorNorm, normLevels } from "../color-norm.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { ContourLine } from "../math/contour.js";
import { contourLines } from "../math/contour.js";
import { dataExtent } from "../math/shared/gridExtent.js";
import { staggered } from "../stagger.js";
import { keyedMemo } from "../util.js";
import type { PlacedLine } from "./contour-shared.js";
import {
	contourRamp,
	levelColor,
	placeLines,
	revealLines,
} from "./contour-shared.js";
import { levelRanks } from "./tri-shared.js";

const DEFAULT_LEVELS = 8;

/**
 * Props of {@link contour}.
 *
 * @category Charts
 */
export interface ContourProps extends RampScaleProps {
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
	 * Explicit iso-line values, or a count of evenly spaced levels strictly between the data's min
	 * and max (spaced along `rampScale` when set).
	 * @default 8
	 */
	levels?: readonly number[] | number;
	/**
	 * Colour ramp a level's colour is sampled from, by where it falls between the field's min and
	 * max: CSS stops, a colormap name, or `(t) => colour`. Defaults to two theme series colours.
	 */
	ramp?: ColorRampSpec;
	/**
	 * Fraction of `progress` spent staggering the levels, lowest first, 0..0.95; 0 draws every line
	 * at once.
	 * @default 0
	 */
	stagger?: number;
	/** One colour for every line, instead of the ramp. */
	stroke?: string;
	/** Line width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1: each line draws along its length. @default 1 */
	progress?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the lines. */
	visible?: boolean;
}

/** The colour norm a contour layer asks for (a log or diverging scale), or undefined (linear). */
export interface ContourColors {
	norm: ColorNorm | undefined;
	ramp: Colormap;
	extent: [number, number];
}

/** What a contour keeps between updates. */
interface ContourState {
	layer: ChartLayer;
	colors: (
		deps: readonly unknown[],
		make: () => ContourColors,
	) => ContourColors;
	lines: (deps: readonly unknown[], make: () => ContourLine[]) => ContourLine[];
	ranks: (
		deps: readonly unknown[],
		make: () => Map<number, number>,
	) => Map<number, number>;
	placed: (deps: readonly unknown[], make: () => PlacedLine[]) => PlacedLine[];
	batch: PathBatchNode<PathBatchItemsProps>;
}

const states = new WeakMap<object, ContourState>();

function draw(ctx: CompositeContext<ContourProps>): SceneNode[] {
	const state = states.get(ctx.node) as ContourState;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords)
		throw new Error("Contour must be placed inside a chart or axes.");
	state.layer.report({ x: { values: props.xs }, y: { values: props.ys } });
	const theme = ctx.theme;
	const colors = state.colors(
		[props.values, props.rampScale, props.rampMidpoint, props.ramp, theme],
		() => ({
			// A log or diverging scale, when asked for: it colours the lines and spaces a count of levels.
			norm: colorNorm(props.values.flat(), {
				rampScale: props.rampScale,
				rampMidpoint: props.rampMidpoint,
			}),
			ramp: contourRamp(props.ramp, theme),
			extent: dataExtent(props.values) ?? [0, 1],
		}),
	);
	const lines = state.lines(
		[props.xs, props.ys, props.values, props.levels, colors.norm],
		() => {
			const levels = props.levels ?? DEFAULT_LEVELS;
			return contourLines(
				props.xs,
				props.ys,
				props.values,
				colors.norm && !Array.isArray(levels)
					? normLevels(colors.norm, levels as number, "between")
					: (levels as number[]),
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
	);
	const ranks = state.ranks([lines], () =>
		levelRanks(lines.map((line) => line.level)),
	);
	const own = state.layer.progress(props.progress);
	/** A line's reveal: the layer's own, or its level's share of a staggered one. */
	const revealOf = (level: number) =>
		props.stagger
			? staggered(
					clamp01(own ?? 1),
					ranks.get(level) ?? 0,
					ranks.size,
					props.stagger,
				)
			: (own ?? 1);
	state.batch.update({
		items: revealLines(placed, revealOf),
		stroke: props.stroke ?? "none",
		strokeWidth: props.strokeWidth,
		opacity: props.opacity,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	return [state.batch];
}

/**
 * Contour lines of a gridded field: one line per connected iso-line, coloured by its level.
 * An explicit `stroke` colours every line the same. Inside a `chart` or `axes`; drawn as one
 * path batch. For filled bands use `contourF`. See {@link contourLines} for the geometry
 * alone.
 *
 * @example
 * ```ts
 * import { chart, contour } from "@sophistry/charts";
 *
 * const xs = [-2, -1, 0, 1, 2];
 * const ys = [-2, -1, 0, 1, 2];
 * const values = ys.map((y) => xs.map((x) => x * x - y * y));
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	children: [contour.create({ xs, ys, values, levels: 6, ramp: "viridis" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const contour = defineComposite<ContourProps>({
	name: "Contour",
	props: {
		xs: { default: [], invalidates: Invalidate.UPDATE },
		ys: { default: [], invalidates: Invalidate.UPDATE },
		values: { default: [], invalidates: Invalidate.UPDATE },
		levels: { invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMidpoint: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
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
			lines: keyedMemo(),
			ranks: keyedMemo(),
			placed: keyedMemo(),
			batch: pathBatch.create({ items: [] }),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
