/**
 * Shared props and helpers of the unstructured-grid charts (`tripcolor`,
 * `triContour`, `triContourF`), and the level ranks the grid contours share
 * with them. Only the props type is public.
 */

import { clamp01 } from "@sophistry/core/internal";
import type { Channel, DateSink } from "../data/channels";
import { numberValues } from "../data/channels";
import type { TriangleIndices } from "../math/tricontour";
import { staggered } from "../stagger";

/**
 * Props every tri-chart shares: one datum per point with its position and
 * value, and optionally the triangles joining the points.
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export interface TriChartBaseProps<T> {
	/** The sample points: one datum each. */
	data: readonly T[];
	/** The point's x, in data units: a key of `T` or `(d, i) => number`. */
	x: Channel<T, number>;
	/** The point's y, in data units: a key of `T` or `(d, i) => number`. */
	y: Channel<T, number>;
	/** The value sampled at the point. A triangle touching a non-finite value is left out. */
	value: Channel<T, number>;
	/**
	 * The mesh, as index triples into `data` (either winding); give your own to
	 * leave holes or follow a non-convex outline. An index past `data` throws.
	 * Omitted, the points are Delaunay-triangulated.
	 */
	triangles?: readonly TriangleIndices[];
	/** Reveal, 0..1; each chart documents its own animation. @default 1 */
	progress?: number;
	/** Fraction of the reveal spent staggering, 0..0.95. @default 0.5 */
	stagger?: number;
}

/** Default `stagger` of the tri-charts. */
const TRI_STAGGER = 0.5;

/** A tri-chart's points as plain arrays. */
export interface TriPoints {
	xs: number[];
	ys: number[];
	zs: number[];
}

/**
 * The points as plain arrays.
 *
 * @internal
 */
export function triPoints<T>(
	props: Pick<TriChartBaseProps<T>, "data" | "x" | "y" | "value">,
	dates: DateSink | null,
): TriPoints {
	return {
		xs: numberValues(props.data, props.x, undefined, "x", dates),
		ys: numberValues(props.data, props.y, undefined, "y", dates),
		zs: numberValues(props.data, props.value, undefined, "value", dates),
	};
}

/**
 * The finite `[min, max]` of `values`, or `[0, 1]` when there is none.
 *
 * @internal
 */
export function valueExtent(values: readonly number[]): [number, number] {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const value of values) {
		if (!Number.isFinite(value)) continue;
		if (value < min) min = value;
		if (value > max) max = value;
	}
	return min <= max ? [min, max] : [0, 1];
}

/** Each level's place in ascending order (contours reveal lowest first), by level value. @internal */
export function levelRanks(levels: readonly number[]): Map<number, number> {
	const sorted = [...new Set(levels)].sort((a, b) => a - b);
	return new Map(sorted.map((level, rank) => [level, rank]));
}

/**
 * One item's share of a staggered reveal, or the whole `progress` when
 * there is only one item.
 *
 * @internal
 */
export function triReveal(
	progress: number | undefined,
	rank: number,
	count: number,
	stagger: number | undefined,
): number {
	return staggered(clamp01(progress ?? 1), rank, count, stagger ?? TRI_STAGGER);
}
