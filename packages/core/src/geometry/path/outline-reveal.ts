/**
 * Arc-length tables of a batched item's outline, cached on the identity of
 * the geometry array, and the reveal rule over them.
 *
 * A partly revealed item of an instances or path-batch node is drawn
 * (`render/paint-items.ts`) and picked (`interact/pick-items.ts`) from the
 * same tables, so the two can never disagree about how much of it is on
 * screen — the guarantee `revealedPolylines` gives a single shape. The cache
 * lives here, below both, because `interact/` may not import `render/`.
 */

import type { ArcTable, CurveArcTable } from "./arclength";
import {
	measure,
	measureCurve,
	revealedPolylines,
	sliceCurveAtT,
} from "./arclength";
import type { CurvePath, Polyline } from "./types";

/** One outline's arc-length tables, in its own units, and their summed length. */
export interface OutlineReveal<T> {
	tables: T[];
	total: number;
}

/**
 * Arc-length tables per outline, keyed on the identity of the geometry array
 * they measure (`curvePaths` when the outline is traced from curves, else
 * `polylines`), as `RevealCache` is for a shape: items sharing an outline
 * share one table, and a layer whose outlines did not change re-measures
 * nothing. Built only when an item is drawn partly revealed.
 */
const polylineReveals = new WeakMap<
	readonly Polyline[],
	OutlineReveal<ArcTable>
>();
const curveReveals = new WeakMap<
	readonly CurvePath[],
	OutlineReveal<CurveArcTable>
>();

/**
 * How many outline tables have been measured, for tests of the cache above.
 *
 * @internal
 */
export const revealMeasures = { count: 0 };

export function polylineRevealOf(
	polylines: readonly Polyline[],
): OutlineReveal<ArcTable> {
	let entry = polylineReveals.get(polylines);
	if (!entry) {
		const tables = polylines.map(measure);
		let total = 0;
		for (const table of tables) total += table.total;
		entry = { tables, total };
		polylineReveals.set(polylines, entry);
		revealMeasures.count += 1;
	}
	return entry;
}

export function curveRevealOf(
	curves: readonly CurvePath[],
): OutlineReveal<CurveArcTable> {
	let entry = curveReveals.get(curves);
	if (!entry) {
		const tables = curves.map(measureCurve);
		let total = 0;
		for (const table of tables) total += table.total;
		entry = { tables, total };
		curveReveals.set(curves, entry);
		revealMeasures.count += 1;
	}
	return entry;
}

/**
 * The budget-in-order reveal rule for curve tables: `revealedPolylines` for
 * `CurveArcTable`s. It lives with the renderer because only the renderer
 * needs it (shapes in `canvas-renderer.ts`, marks here).
 *
 * @internal
 */
export function revealedCurves(
	tables: CurveArcTable[],
	total: number,
	progress: number,
): CurvePath[] {
	if (progress <= 0 || total <= 0) return [];
	let budget = total * progress;
	const drawn: CurvePath[] = [];
	for (const table of tables) {
		if (budget <= 0) break;
		if (budget >= table.total) {
			drawn.push(table.curve);
			budget -= table.total;
			continue;
		}
		const piece = sliceCurveAtT(
			table,
			table.total === 0 ? 1 : budget / table.total,
		);
		if (piece.segments.length > 0) drawn.push(piece);
		budget = 0;
	}
	return drawn;
}

/**
 * The part of an item's outline that is drawn at `progress`, as polylines:
 * what `hitSpec` tests for a shape at that progress (one arc-length budget
 * across the subpaths, spent in order, over the flattened outline), read
 * from the same cached tables the renderer draws from. At 1 the outline
 * itself; at 0 nothing.
 *
 * @param polylines - The outline's flattened subpaths, in its own units.
 * @param progress - The reveal, 0..1.
 *
 * @internal
 */
export function revealedOutline(
	polylines: readonly Polyline[],
	progress: number,
): Polyline[] {
	if (progress >= 1) return polylines as Polyline[];
	if (progress <= 0) return [];
	const { tables, total } = polylineRevealOf(polylines);
	return revealedPolylines(tables, total, progress);
}
