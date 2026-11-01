/** Line plots from discrete data, split into continuous runs at non-finite pairs (a gap, not a spike). */

import type { Point } from "@sophistry/core/geometry";
import { pairCount } from "./shared/pairs.js";

/**
 * Parallel `x`/`y` arrays split into runs, breaking at non-finite pairs.
 *
 * @returns Runs of consecutive finite points; single-point runs are dropped.
 * @category Math & helpers
 */
export function dataRuns(
	xs: readonly number[],
	ys: readonly number[],
): Point[][] {
	const n = pairCount(xs, ys);
	const runs: Point[][] = [];
	let run: Point[] = [];
	const flush = () => {
		if (run.length > 1) runs.push(run);
		run = [];
	};
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		if (Number.isFinite(x) && Number.isFinite(y)) run.push({ x, y });
		else flush();
	}
	flush();
	return runs;
}

/**
 * Whether a run's x never decreases: the precondition for
 * {@link decimateRun}, which bisects on x.
 *
 * @internal
 */
export function isNonDecreasingX(run: readonly Point[]): boolean {
	for (let i = 1; i < run.length; i++)
		if (run[i].x < run[i - 1].x) return false;
	return true;
}

/** The first index in `run` (ascending x) whose x is `>= x`, or `> x` with `after`. */
function bisectX(run: readonly Point[], x: number, after: boolean): number {
	let lo = 0;
	let hi = run.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (after ? run[mid].x <= x : run[mid].x < x) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * How many points per column a run must exceed, inside the window, before
 * {@link decimateRun} thins it: below this the line is drawn as given.
 */
export const DECIMATION_MIN_PER_COLUMN = 4;

/**
 * Min/max-per-column ("M4") decimation of a long line: inside `edges`' window,
 * each column keeps only its first, last, lowest and highest points, in
 * order. A line through them covers, column by column, exactly the span the
 * full line does and enters and leaves each column at the same points, so
 * with a column per device pixel it rasterises to the same pixels (Jugel et
 * al., "M4", VLDB 2014) at no more than four points per column, however many
 * the data holds.
 *
 * Outside the window the run is kept as it is — or, with `dropOutside` (the
 * window is clipped, so nothing past it shows), cut to the one point each
 * side that carries the line to the window's edge.
 *
 * @param run - Points with non-decreasing x (see {@link isNonDecreasingX}).
 * @param edges - Column boundaries in data x, ascending; column `k` is
 * `[edges[k], edges[k + 1])`, the last one closed.
 * @param dropOutside - Whether points beyond the window can be dropped.
 * @returns The kept points (the run's own objects), or `run` itself when the
 * window holds no more than {@link DECIMATION_MIN_PER_COLUMN} points per
 * column.
 * @internal
 */
export function decimateRun(
	run: readonly Point[],
	edges: readonly number[],
	dropOutside = false,
): readonly Point[] {
	const columns = edges.length - 1;
	if (columns < 1) return run;
	const lo = bisectX(run, edges[0], false);
	const hi = bisectX(run, edges[columns], true);
	if (hi - lo <= DECIMATION_MIN_PER_COLUMN * columns) return run;

	const out: Point[] = [];
	if (dropOutside) {
		if (lo > 0) out.push(run[lo - 1]);
	} else {
		for (let i = 0; i < lo; i++) out.push(run[i]);
	}
	let column = 0;
	let first = lo;
	let lowest = lo;
	let highest = lo;
	/** Emits the column ending before `end`: its four points, in order, once each. */
	const flush = (end: number) => {
		const kept = [first, lowest, highest, end - 1].sort((a, b) => a - b);
		for (let k = 0; k < kept.length; k++)
			if (k === 0 || kept[k] !== kept[k - 1]) out.push(run[kept[k]]);
	};
	for (let i = lo; i < hi; i++) {
		const { x, y } = run[i];
		if (column < columns - 1 && x >= edges[column + 1]) {
			flush(i);
			while (column < columns - 1 && x >= edges[column + 1]) column++;
			first = lowest = highest = i;
			continue;
		}
		if (y < run[lowest].y) lowest = i;
		if (y > run[highest].y) highest = i;
	}
	flush(hi);
	if (dropOutside) {
		if (hi < run.length) out.push(run[hi]);
	} else {
		for (let i = hi; i < run.length; i++) out.push(run[i]);
	}
	return out;
}

/**
 * Whether two lines' runs hold the same points: lengths, then coordinates,
 * stopping at the first difference. The equality for point arrays that can
 * be long, where `deepEqual`'s `Object.keys` per array would allocate a key
 * per point on every comparison, even one that fails at once.
 *
 * @internal
 */
export function sameRuns(
	a: readonly (readonly Point[])[],
	b: readonly (readonly Point[])[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let r = 0; r < a.length; r++) {
		const p = a[r];
		const q = b[r];
		if (p === q) continue;
		if (p.length !== q.length) return false;
		for (let i = 0; i < p.length; i++)
			if (!Object.is(p[i].x, q[i].x) || !Object.is(p[i].y, q[i].y))
				return false;
	}
	return true;
}
