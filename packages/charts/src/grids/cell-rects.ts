/**
 * A gridded layer's cells as one instances node of `rect`s: `pcolormesh`,
 * `hist2d`, `cells`, and `imshow` when it can't be an image. Each cell is an
 * axis-aligned box in scene units, filled from the layer's ramp, with its
 * own opacity (`cells`' reading-order fade) and its own `progress` (the
 * reading-order reveal of `pcolormesh`, `hist2d` and `imshow`: the fill
 * comes up, a stroke traces). Internal to the charts.
 */

import type { CoordinateSystem, RectProps, SceneNode } from "@sophistry/core";
import { rect } from "@sophistry/core";
import type { Bounds, Point } from "@sophistry/core/geometry";
import type { BatchedMark, BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";

/** One cell on one frame, in scene units. */
export interface CellItem extends BatchItem {
	center: Point;
	width: number;
	height: number;
	fill: string;
	/** The cell's opacity: the layer's `opacity`, times its fade where it fades. */
	opacity: number;
	/** The cell's arc-length reveal, 0..1, as a rect's `progress`. @default 1 */
	progress?: number;
}

/** The rect instances node a cell layer draws through. */
export type CellRects<D extends CellItem = CellItem> = BatchedMark<
	D,
	RectProps,
	SceneNode<RectProps>,
	keyof RectProps
>;

/**
 * Makes the rect instances node of a cell layer. Call once, in `setup`.
 * Entering cells fade in and leaving ones fade out under a `transition`.
 */
export function createCellRects<D extends CellItem = CellItem>(): CellRects<D> {
	return createBatchedMark<D, RectProps, SceneNode<RectProps>, keyof RectProps>(
		rect as never,
		{
			channels: {
				center: (item) => item.center,
				width: (item) => item.width,
				height: (item) => item.height,
				fill: (item) => item.fill,
				opacity: (item) => item.opacity,
				progress: (item) => item.progress ?? 1,
			},
			enter: { opacity: 0 },
			exit: { opacity: 0 },
		},
	);
}

/** The scene box between two data corners, grown by `bleed` on every side. */
export function cellBox(
	coords: Pick<CoordinateSystem, "coordsToPoint">,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	bleed = 0,
): Bounds {
	const a = coords.coordsToPoint(x0, y0);
	const b = coords.coordsToPoint(x1, y1);
	return {
		minX: Math.min(a.x, b.x) - bleed,
		maxX: Math.max(a.x, b.x) + bleed,
		minY: Math.min(a.y, b.y) - bleed,
		maxY: Math.max(a.y, b.y) + bleed,
	};
}

/** A box's centre, width and height, for a {@link CellItem}. */
export function boxPlacement(box: Bounds): {
	center: Point;
	width: number;
	height: number;
} {
	return {
		center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
		width: Math.max(0, box.maxX - box.minX),
		height: Math.max(0, box.maxY - box.minY),
	};
}
