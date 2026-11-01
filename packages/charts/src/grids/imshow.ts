/**
 * `imshow`: a 2D array as one image node. The colours go through a 256-step
 * lookup table of the ramp (`raster.ts`), so a million cells are a million
 * table reads and one bitmap the camera moves for free.
 *
 * The reading-order fade stays: while a staggered reveal runs, each pixel's
 * alpha is its cell's share of the fade (the stagger drops to 0 above 2,000
 * cells, so this only rewrites small images per frame). Under a non-linear
 * axis, where an image would put cells in the wrong places, or with a cell
 * `stroke`, the cells are drawn as one instances node of `rect`s instead.
 */

import type {
	ColorRampSpec,
	CompositeContext,
	ImageGeometry,
	ImageNode,
	ImageProps,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	defineImage,
	Invalidate,
	imageProps,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { Range } from "@sophistry/core/geometry";
import type { RampScaleProps } from "../color-norm.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { ImshowCell, ImshowResult } from "../math/imshow.js";
import { imshowCells } from "../math/imshow.js";
import { gridNcols } from "../math/shared/gridCells.js";
import { affineFrame, rampTable, rasterize } from "../raster.js";
import { gridStagger } from "../stagger.js";
import { keyedMemo } from "../util.js";
import type { CellItem, CellRects } from "./cell-rects.js";
import { createCellRects } from "./cell-rects.js";
import { placeGridCells, revealCells } from "./pcolormesh.js";
import { createRampCells } from "./ramp-cells.js";

/** How far, in scene units, an unstroked cell reaches past its edges to close the seams. */
const SEAM_BLEED = 0.004;

/**
 * Props of {@link imshow}.
 *
 * @category Charts
 */
export interface ImshowProps extends RampScaleProps {
	/** Rows × columns of values; ragged rows are tolerated. */
	values: readonly (readonly number[])[];
	/** `[min, max]` in data units the columns span. Defaults to `[0, ncols]`. */
	xRange?: Range;
	/** `[min, max]` in data units the rows span. Defaults to `[0, nrows]`. */
	yRange?: Range;
	/**
	 * Which edge row 0 sits on: `"upper"` (top) or `"lower"` (bottom).
	 * @default "upper"
	 */
	rowOrigin?: "upper" | "lower";
	/**
	 * Colour ramp sampled by each cell's value between `rampMin` and `rampMax`: CSS stops, a
	 * colormap name (`"viridis"`), or `(t) => colour`. Defaults to the theme's ramp (background to
	 * first series colour).
	 */
	ramp?: ColorRampSpec;
	/** Value at the bottom of the ramp. Defaults to the finite minimum of `values`. */
	rampMin?: number;
	/** Value at the top of the ramp. Defaults to the finite maximum of `values`. */
	rampMax?: number;
	/**
	 * Fraction of the reveal spent staggering the cells in reading order, 0..0.95. Defaults to 0.5
	 * (0 above 2000 cells).
	 */
	stagger?: number;
	/** Interpolate between pixels when magnified. @default false */
	smoothing?: boolean;
	/** Cell outline; given, the cells are drawn as rectangles rather than an image. */
	stroke?: string;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1: cells fade in in reading order, top row first. @default 1 */
	progress?: number;
	/** Paint order. Defaults to `UNDER_AXES_Z_INDEX` (above the grid, under the axes). */
	zIndex?: number;
	/** Set to false to hide the image. */
	visible?: boolean;
}

/** The image node `imshow` draws through: its geometry handed over whole. */
interface ImshowImageProps extends ImageProps {
	geometry?: ImageGeometry;
}

const EMPTY_PIXELS = { width: 0, height: 0, data: new Uint8ClampedArray(0) };

/** Internal: not exported, so not a public definition. */
const imshowImage = defineImage<ImshowImageProps>({
	name: "ImshowImage",
	props: { ...imageProps, geometry: { invalidates: Invalidate.GEOMETRY } },
	image: (props) =>
		props.geometry ?? {
			pixels: EMPTY_PIXELS,
			origin: { x: 0, y: 0 },
			xAxis: { x: 0, y: 0 },
			yAxis: { x: 0, y: 0 },
		},
});

/** What an imshow keeps between updates. */
interface ImshowState {
	layer: ChartLayer;
	domain: (deps: readonly unknown[], make: () => number[]) => number[];
	cells: (deps: readonly unknown[], make: () => ImshowResult) => ImshowResult;
	ramp: ReturnType<typeof createRampCells<ImshowCell>>;
	frame: (
		deps: readonly unknown[],
		make: () => Omit<ImageGeometry, "pixels"> | null,
	) => Omit<ImageGeometry, "pixels"> | null;
	pixels: (
		deps: readonly unknown[],
		make: () => ImageGeometry["pixels"],
	) => ImageGeometry["pixels"];
	faded: (
		deps: readonly unknown[],
		make: () => ImageGeometry["pixels"],
	) => ImageGeometry["pixels"];
	geometry: (
		deps: readonly unknown[],
		make: () => ImageGeometry,
	) => ImageGeometry;
	placed: (deps: readonly unknown[], make: () => CellItem[]) => CellItem[];
	image: ImageNode<ImshowImageProps> | null;
	rects: CellRects | null;
}

const states = new WeakMap<object, ImshowState>();

const cellValue = (cell: ImshowCell) => cell.value;
const readingAt = (cell: ImshowCell) => ({
	x: cell.x0 + cell.x1,
	y: cell.y0 + cell.y1,
});

/** `[xMin, xMax, yMin, yMax]`, as `imshowCells` resolves it. */
function extentOf(
	props: Readonly<ImshowProps>,
): [number, number, number, number] {
	const ncols = gridNcols(props.values);
	const nrows = props.values.length;
	return props.xRange || props.yRange
		? [
				props.xRange?.[0] ?? 0,
				props.xRange?.[1] ?? props.values[0]?.length ?? 0,
				props.yRange?.[0] ?? 0,
				props.yRange?.[1] ?? nrows,
			]
		: [0, ncols, 0, nrows];
}

function draw(ctx: CompositeContext<ImshowProps>): SceneNode[] {
	const state = states.get(ctx.node) as ImshowState;
	const props = ctx.props;
	const coords = state.layer.coords();
	if (!coords) throw new Error("Imshow must be placed inside a chart or axes.");
	const ncols = gridNcols(props.values);
	const nrows = props.values.length;
	const count = ncols * nrows;
	const extent = extentOf(props);
	const [x0, x1, y0, y1] = extent;

	/** The grid as one image: where it lands, or null when it must be cells. */
	const frame = state.frame(
		[coords, ...extent, props.rowOrigin, count, props.stroke],
		() => {
			if (count === 0) return null;
			if (props.stroke !== undefined && props.stroke !== "none") return null;
			return props.rowOrigin === "lower"
				? affineFrame(coords, x0, y0, x1, y1)
				: affineFrame(coords, x0, y1, x1, y0);
		},
	);
	const imaged = frame !== null;
	// Cells are only needed to draw them, or for the reading order of a
	// staggered image (never above 2,000 cells unless a stagger is asked for).
	const needsCells = !imaged || gridStagger(props.stagger, count) > 0;
	const image = state.cells(
		[props.values, ...extent, props.rowOrigin, needsCells],
		() =>
			needsCells
				? imshowCells(props.values, { extent, origin: props.rowOrigin })
				: { cells: [], min: 0, max: 1, nrows, ncols },
	);
	// Every value, as the cells hold them: read from the values, so the norm
	// does not depend on whether there are cells.
	const domain = state.domain([props.values], () => props.values.flat());
	const grid = state.ramp({
		layer: state.layer,
		coords,
		theme: ctx.theme,
		ramp: props.ramp,
		cells: image.cells,
		value: cellValue,
		at: readingAt,
		norm: {
			rampScale: props.rampScale,
			rampMidpoint: props.rampMidpoint,
			rampMin: props.rampMin,
			rampMax: props.rampMax,
		},
		domain,
		// The cells tile the extent exactly, so its corners are their extent.
		extent:
			count === 0
				? { x: { values: [] }, y: { values: [] } }
				: { x: { values: [x0, x1] }, y: { values: [y0, y1] } },
		stagger: props.stagger,
		progress: props.progress,
	});
	const zIndex = props.zIndex ?? UNDER_AXES_Z_INDEX;

	if (frame) {
		// The rects, if any, are dropped from the children (and disposed).
		state.rects = null;
		// The colours: rebuilt when the values, norm or ramp change, not when the view does.
		const pixels = state.pixels(
			[props.values, grid.norm, grid.colormap],
			() => ({
				width: ncols,
				height: nrows,
				data: rasterize(
					props.values,
					ncols,
					grid.unitOf,
					rampTable(grid.colorAt),
				),
			}),
		);
		const progress = grid.progress ?? 1;
		const fading = grid.staggered && progress < 1;
		const shown = fading
			? state.faded([pixels, progress, grid.cells], () => {
					const data = new Uint8ClampedArray(pixels.data);
					for (let i = 0; i < data.length; i += 4) data[i + 3] = 0;
					grid.cells.forEach((cell, i) => {
						const at = 4 * (cell.row * ncols + cell.column) + 3;
						data[at] = Math.round(
							(pixels.data[at] as number) * (grid.revealOf(i) ?? 1),
						);
					});
					return { width: ncols, height: nrows, data };
				})
			: pixels;
		const geometry = state.geometry([frame, shown], () => ({
			...frame,
			pixels: shown,
		}));
		const imageProps = {
			geometry,
			opacity: props.opacity,
			progress: fading ? 1 : progress,
			smoothing: props.smoothing,
			zIndex,
			visible: props.visible,
		};
		if (state.image) state.image.update(imageProps);
		else state.image = imshowImage.create(imageProps);
		return [state.image];
	}

	state.image = null;
	state.rects ??= createCellRects();
	// Unstroked, each cell overlaps its neighbours by a hairline: butted
	// antialiased edges let the background show through as seams.
	const bleed =
		props.stroke === undefined && (props.opacity ?? 1) >= 1 ? SEAM_BLEED : 0;
	const placed = state.placed(
		[grid.cells, coords, grid.colormap, grid.norm, bleed],
		() => placeGridCells(grid, coords, bleed),
	);
	state.rects.update(revealCells(placed, grid, props.opacity), {
		stroke: props.stroke ?? "none",
		strokeWidth: props.strokeWidth,
		zIndex,
		visible: props.visible,
	});
	return [state.rects.node];
}

/**
 * A 2D array as an image: equal-sized cells over `xRange` × `yRange`, each finite value
 * coloured on a ramp. Use {@link pcolormesh} for uneven cell coordinates. Paints under the
 * axes by default (`zIndex` `UNDER_AXES_Z_INDEX`). Inside a `chart` or `axes`. Drawn as one
 * image node (cells as rectangles under a non-linear axis or with a `stroke`). See
 * {@link imshowCells}.
 *
 * @example
 * ```ts
 * import { chart, imshow } from "@sophistry/charts";
 *
 * chart.create({
 * 	width: 6,
 * 	height: 4,
 * 	colorbar: true,
 * 	children: [imshow.create({ values: [[0, 1, 2], [3, 4, 5]], ramp: "viridis" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const imshow = defineComposite<ImshowProps>({
	name: "Imshow",
	props: {
		values: { default: [], invalidates: Invalidate.UPDATE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		rowOrigin: { invalidates: Invalidate.UPDATE },
		ramp: { invalidates: Invalidate.UPDATE },
		rampMin: { invalidates: Invalidate.UPDATE },
		rampMax: { invalidates: Invalidate.UPDATE },
		rampScale: { invalidates: Invalidate.UPDATE },
		rampMidpoint: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		smoothing: { invalidates: Invalidate.UPDATE },
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
			domain: keyedMemo<number[]>(),
			cells: keyedMemo<ImshowResult>(),
			ramp: createRampCells<ImshowCell>(),
			frame: keyedMemo(),
			pixels: keyedMemo(),
			faded: keyedMemo(),
			geometry: keyedMemo(),
			placed: keyedMemo<CellItem[]>(),
			image: null,
			rects: null,
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
