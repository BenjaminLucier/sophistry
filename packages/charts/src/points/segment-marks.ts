/**
 * Straight lines in a batched layer, shared by the per-datum marks whose
 * data are short segments (a rug's ticks, a stem's drop lines, `tickX` /
 * `tickY`, an event raster, links). Internal.
 *
 * A layer of segments is one `instances(line, ...)` node: every
 * item is a real stroke (caps, any space), each its own outline in the
 * node's `paths` spec, with `from` / `to` / `stroke` per item.
 *
 * A segment's reveal is its item's `progress` channel: the stroke traces
 * from `from` towards `to`.
 */

import type { LineProps, SceneNode } from "@sophistry/core";
import { line } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { BatchedMark, BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";

/** One segment of a batched layer: its two ends in scene units and its colour. */
export interface SegmentItem extends BatchItem {
	/** Where it starts (the end a reveal draws from), in scene units. */
	from: Point;
	/** Where it ends. */
	to: Point;
	/** Its stroke colour. */
	stroke: string;
	/** How far it has traced from `from`, 0..1. @default 1 */
	progress?: number;
	/** Its opacity (the layer's folded in), when the layer was made with `opacity: true`. */
	opacity?: number;
}

/** The batched node of a segment layer. */
export type SegmentMark<S extends SegmentItem> = BatchedMark<
	S,
	LineProps,
	SceneNode<LineProps>,
	keyof LineProps
>;

/**
 * Makes the one `line` instances node of a segment layer (see `options`). Under a mark's
 * `transition`, an entering segment draws out of its start and a leaving
 * one draws back into it (its `progress`). Call once, in `setup`.
 */
export function createSegmentMark<S extends SegmentItem>(
	options: {
		/** Read each item's `opacity` (a fade per segment) instead of a shared one. */
		opacity?: boolean;
	} = {},
): SegmentMark<S> {
	return createBatchedMark<S, LineProps, SceneNode<LineProps>, keyof LineProps>(
		line as never,
		{
			channels: {
				from: (item) => item.from,
				to: (item) => item.to,
				stroke: (item) => item.stroke,
				progress: (item) => item.progress ?? 1,
				...(options.opacity ? { opacity: (item: S) => item.opacity ?? 1 } : {}),
			},
			enter: { progress: 0 },
			exit: { progress: 0 },
		},
	);
}
