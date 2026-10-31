/** Stacked areas: parallel series stacked on a shared baseline, each band the region between consecutive running totals. */

import type { Point } from "@sophistry/core/geometry";
import { finiteOrZero } from "@sophistry/core/internal";
import { fillBetweenRings } from "./fillBetween";
import type { StackOffset, StackOrder } from "./stack";
import { stackColumns } from "./stack";

/** @category Math */
export interface StackedBand {
	/** The running total *below* this series, per `x` — the band's lower edge. */
	bottom: number[];
	/** `bottom + series`, per `x` — the band's upper edge. */
	top: number[];
	/** `top`/`bottom` mapped through `fillBetweenRings`, in data coordinates. */
	rings: Point[][];
}

/** @category Math */
export interface StackPlotOptions {
	/** The running total the first series stacks atop, under the `"zero"` offset. @default 0 */
	baseline?: number;
	/** Where each x's stack is placed; see {@link StackOffset}. @default "zero" */
	offset?: StackOffset;
	/**
	 * Which series sits at the bottom; see {@link StackOrder}. Bands are still
	 * returned in the order given.
	 * @default "appearance"
	 */
	order?: StackOrder;
}

/**
 * Stacks `series` (each parallel to `xs`) on `baseline`; band `i`'s `rings`
 * shade the slice that series adds. Other offsets then rescale or shift each
 * x's stack; `"wiggle"` treats `xs` as evenly spaced.
 *
 * @param series - One array per band; missing or non-finite entries count as 0, negatives subtract.
 * @returns One {@link StackedBand} per series, in the order given.
 * @category Math & helpers
 */
export function stackedBands(
	xs: readonly number[],
	series: readonly (readonly number[])[],
	options: StackPlotOptions = {},
): StackedBand[] {
	const columns = xs.map((_, i) =>
		series.map((values, s) => ({ series: s, value: finiteOrZero(values[i]) })),
	);
	const { spans } = stackColumns(columns, series.length, {
		offset: options.offset,
		order: options.order,
		baseline: options.baseline,
		diverging: false,
	});
	return series.map((_, s) => {
		const bottom = spans.map((column) => column[s][0]);
		const top = spans.map((column) => column[s][1]);
		return { bottom, top, rings: fillBetweenRings(xs, top, bottom) };
	});
}
