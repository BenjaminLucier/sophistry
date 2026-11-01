/**
 * `numberPlane`: `axes` on a background grid (Manim's `NumberPlane`). The
 * layout is shared with `complexPlane`.
 */

import type { ColorInput } from "../color/index.js";
import type { CompositeContext } from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import type { PropsDescriptor, SceneNode } from "../scene/types.js";
import type { AxesProps, AxesState } from "./axes.js";
import { axesLayout, axesProps, createAxesState } from "./axes.js";
import type { CoordinateSystem } from "./coords.js";
import { publishCoords } from "./coords.js";
import type { WeightedGridLines } from "./grid-lines.js";
import {
	createGridLines,
	DEFAULT_GRID_OPACITY,
	DEFAULT_GRID_STROKE_WIDTH,
	DEFAULT_GRID_Z_INDEX,
	DEFAULT_MINOR_GRID_OPACITY,
	gridLineNodes,
} from "./grid-lines.js";

/**
 * Props for {@link numberPlane}: everything {@link AxesProps} takes, plus grid styling.
 *
 * @category Coordinate systems & graphs
 */
export interface NumberPlaneProps extends AxesProps {
	/**
	 * Draw the background grid.
	 * @default true
	 */
	grid?: boolean;
	/**
	 * Grid lines drawn *between* consecutive major ones, per cell.
	 * @default 0
	 */
	minorGridLineCount?: number;
	/** Grid line colour. Defaults to the theme's grid colour. */
	gridColor?: ColorInput;
	/**
	 * Grid line width.
	 * @default 0.02
	 */
	gridStrokeWidth?: number;
	/**
	 * Opacity of major grid lines, 0..1.
	 * @default 0.45
	 */
	gridOpacity?: number;
	/**
	 * Opacity of minor grid lines, 0..1.
	 * @default 0.22
	 */
	minorGridOpacity?: number;
	/**
	 * Paint order for the grid. Behind everything else by default.
	 * @default -1
	 */
	gridZIndex?: number;
}

/**
 * Descriptor entries for every {@link NumberPlaneProps} key.
 *
 * @internal Shared with `complexPlane`.
 */
export const numberPlaneProps: PropsDescriptor<NumberPlaneProps> = {
	...axesProps,
	grid: { default: true, invalidates: Invalidate.UPDATE },
	minorGridLineCount: { default: 0, invalidates: Invalidate.UPDATE },
	gridColor: { invalidates: Invalidate.UPDATE },
	gridStrokeWidth: {
		default: DEFAULT_GRID_STROKE_WIDTH,
		invalidates: Invalidate.UPDATE,
	},
	gridOpacity: {
		default: DEFAULT_GRID_OPACITY,
		invalidates: Invalidate.UPDATE,
	},
	minorGridOpacity: {
		default: DEFAULT_MINOR_GRID_OPACITY,
		invalidates: Invalidate.UPDATE,
	},
	gridZIndex: { default: DEFAULT_GRID_Z_INDEX, invalidates: Invalidate.UPDATE },
};

/** What a number plane keeps between updates. */
export interface NumberPlaneState {
	axes: AxesState;
	vertical: ReturnType<typeof createGridLines>;
	horizontal: ReturnType<typeof createGridLines>;
}

/**
 * The state a plane layout needs. Call once, in `setup`.
 *
 * @internal Shared with `complexPlane`.
 */
export function createNumberPlaneState<P extends { progress?: number }>(
	ctx: CompositeContext<P>,
): NumberPlaneState {
	return {
		axes: createAxesState(ctx),
		vertical: createGridLines(),
		horizontal: createGridLines(),
	};
}

/** No lines: what a plane without a grid hands its lists, so they empty. */
const NO_LINES: WeightedGridLines = { majors: [], minors: [] };

/**
 * Builds (or brings up to date) the plane's nodes: the minor then major grid
 * lines, then the axes (numbers off unless `axis` turns them on). Does not
 * publish the system or place the caller's children.
 *
 * @internal Shared with `complexPlane`.
 * @returns The nodes, in paint order, and the coordinate system.
 */
export function numberPlaneLayout<P extends object>(
	ctx: CompositeContext<P>,
	state: NumberPlaneState,
	props: Readonly<NumberPlaneProps>,
): { nodes: SceneNode[]; coords: CoordinateSystem } {
	const theme = ctx.theme;
	const axesResult = axesLayout(ctx, state.axes, {
		...props,
		axis: { numbers: false, ...props.axis },
	});
	// The grid shares its coordinate arithmetic with the axes it wraps,
	// rather than re-deriving it.
	const coords = axesResult.coords;
	const grid = props.grid !== false;

	/** The grid sits on the axes' ticks: the same scale, step and rule (`axisTicks`). */
	const gridOptions = {
		minorCount: props.minorGridLineCount ?? 0,
		thin: true,
	};
	const vertical = grid
		? state.vertical(
				props.xRange,
				coords.xRange(),
				{
					scale: props.xAxis?.scale ?? props.axis?.scale,
					base: props.xAxis?.base ?? props.axis?.base,
					timeZone: props.xAxis?.timeZone ?? props.axis?.timeZone,
					step: props.xAxis?.step ?? props.axis?.step,
				},
				gridOptions,
			)
		: NO_LINES;
	const horizontal = grid
		? state.horizontal(
				props.yRange,
				coords.yRange(),
				{
					scale: props.yAxis?.scale ?? props.axis?.scale,
					base: props.yAxis?.base ?? props.axis?.base,
					timeZone: props.yAxis?.timeZone ?? props.axis?.timeZone,
					step: props.yAxis?.step ?? props.axis?.step,
				},
				gridOptions,
			)
		: NO_LINES;

	/**
	 * The grid rides the axes' first phase, so it is complete by the time the
	 * ticks and numbers arrive. It is scenery: watching a hundred grid lines
	 * draw themselves one third of the way through a reveal is not a feature.
	 */
	const line = {
		area: coords.area(),
		stroke: props.gridColor ?? theme.palette.grid,
		strokeWidth: props.gridStrokeWidth ?? DEFAULT_GRID_STROKE_WIDTH,
		zIndex: props.gridZIndex ?? DEFAULT_GRID_Z_INDEX,
		visible: props.visible,
		progress: state.axes.phase(0),
	};
	const major = props.gridOpacity ?? DEFAULT_GRID_OPACITY;
	const minor = props.minorGridOpacity ?? DEFAULT_MINOR_GRID_OPACITY;
	const placeX = (value: number) => coords.coordsToPoint(value).x;
	const placeY = (value: number) => coords.coordsToPoint(0, value).y;

	const nodes = [
		...gridLineNodes(ctx, "minorX", {
			...line,
			axis: "x",
			place: placeX,
			ticks: vertical.minors,
			opacity: minor,
		}),
		...gridLineNodes(ctx, "minorY", {
			...line,
			axis: "y",
			place: placeY,
			ticks: horizontal.minors,
			opacity: minor,
		}),
		...gridLineNodes(ctx, "majorX", {
			...line,
			axis: "x",
			place: placeX,
			ticks: vertical.majors,
			opacity: major,
		}),
		...gridLineNodes(ctx, "majorY", {
			...line,
			axis: "y",
			place: placeY,
			ticks: horizontal.majors,
			opacity: major,
		}),
		...axesResult.nodes,
	];
	return { nodes, coords };
}

/** Per-node plane state. */
const states = new WeakMap<object, NumberPlaneState>();

function layout(ctx: CompositeContext<NumberPlaneProps>): SceneNode[] {
	let state = states.get(ctx.node);
	if (!state) {
		state = createNumberPlaneState(ctx);
		states.set(ctx.node, state);
	}
	const { nodes, coords } = numberPlaneLayout(ctx, state, ctx.props);
	publishCoords(ctx, coords);
	return [...nodes, ...ctx.children];
}

/**
 * `axes` on a background grid — Manim's `NumberPlane`.
 *
 * The grid sits on the ticks, so it can never disagree with the numbers, and it
 * shares its coordinate arithmetic with the axes it wraps rather than
 * re-deriving it. Numbers are off by default here: a plane is usually scenery,
 * and a labelled grid competes with whatever is drawn on it. Pass
 * `axis: { numbers: true }` to turn them back on.
 *
 * Takes the same props as {@link axes} and provides the same coordinate context
 * to its children. Grid spacing follows the same step as the ticks: `axis.step` /
 * `xAxis.step` / `yAxis.step` if given, else the step in `xRange`/`yRange`, else
 * an automatic one. Grid lines are capped at 120 per
 * axis; a finer step is thinned rather than drawn in full.
 *
 * @example
 * ```ts
 * import { createScene, numberPlane } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(
 * 	numberPlane.create({ xRange: [-8, 8, 1], yRange: [-4.5, 4.5, 1], width: 16, height: 9 }),
 * );
 * ```
 *
 * @see {@link complexPlane} for real and imaginary axes.
 * @see {@link polarPlane} for rings and spokes.
 * @category Coordinate systems & graphs
 */
export const numberPlane = defineComposite<NumberPlaneProps>({
	name: "NumberPlane",
	props: numberPlaneProps,
	setup: layout,
	update: (_changed, ctx) => layout(ctx),
});
