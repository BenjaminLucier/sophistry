/**
 * A chart's layer registry: where layers report their extents.
 *
 * Reports are kept per layer (by an owner object) in first-report order.
 * A report is normalised as it arrives: each axis's `values` shrink to their
 * finite extremes (only those count for fitting), so comparing a report
 * with the last one costs a few numbers however large the data. A report
 * equal by value to the layer's last one changes nothing; any other change
 * asks the chart to update (`onChange`, which only marks).
 */

import { deepEqual } from "../util";
import type { AxisExtent, ChartLayerExtent, ChartLayers } from "./types";

/** An axis extent with its `values` reduced to their finite extremes. */
function normaliseAxis(axis: AxisExtent | undefined): AxisExtent | undefined {
	if (!axis?.values) return axis;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const value of axis.values) {
		if (!Number.isFinite(value)) continue;
		if (value < min) min = value;
		if (value > max) max = value;
	}
	const values = min <= max ? (min === max ? [min] : [min, max]) : [];
	return { ...axis, values };
}

/** A report with every axis's values reduced to their extremes. */
export function normaliseReport(extent: ChartLayerExtent): ChartLayerExtent {
	const out: ChartLayerExtent = { ...extent };
	for (const key of ["x", "y", "x2", "y2"] as const) {
		if (extent[key]) out[key] = normaliseAxis(extent[key]);
	}
	if (extent.transition) {
		const transition = { ...extent.transition };
		for (const key of ["x", "y", "x2", "y2"] as const) {
			if (transition[key]) transition[key] = normaliseAxis(transition[key]);
		}
		out.transition = transition;
	}
	return out;
}

/**
 * A chart's registry: {@link ChartLayers} plus the current reports.
 *
 * @internal
 */
export interface LayerRegistry extends ChartLayers {
	/** Every layer's report, in first-report order; the same array while none changed. */
	reports(): readonly ChartLayerExtent[];
	/** How many layers have reported. */
	readonly count: number;
}

/**
 * Makes a registry. `onChange` runs (synchronously, possibly inside a
 * commit) whenever the reports change; it must only mark.
 *
 * @internal
 */
export function createLayerRegistry(onChange: () => void): LayerRegistry {
	const byOwner = new Map<object, ChartLayerExtent>();
	/** Each owner's last report as given: the same object again is skipped unread. */
	const given = new Map<object, ChartLayerExtent>();
	let list: readonly ChartLayerExtent[] | null = [];
	return {
		report(owner, extent) {
			if (extent === null) {
				given.delete(owner);
				if (!byOwner.delete(owner)) return;
			} else {
				if (given.get(owner) === extent) return;
				given.set(owner, extent);
				const next = normaliseReport(extent);
				const before = byOwner.get(owner);
				if (before && deepEqual(before, next)) return;
				byOwner.set(owner, next);
			}
			list = null;
			onChange();
		},
		reports() {
			list ??= [...byOwner.values()];
			return list;
		},
		get count() {
			return byOwner.size;
		},
	};
}
