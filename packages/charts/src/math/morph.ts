/**
 * Data-space morphing: a line, an area or a step function at blend `t`
 * between two versions of itself, interpolated in data units so every frame
 * is a valid chart of its kind under whatever scale is current.
 */

import type { Point } from "@sophistry/core/geometry";

/** Whether `xs` never decreases (a function of x, drawn left to right). */
function ascending(run: readonly Point[]): boolean {
	for (let i = 1; i < run.length; i++) {
		if (!(run[i].x >= run[i - 1].x)) return false;
	}
	return true;
}

/** The line's y at `x` by linear interpolation, held at its end values outside its extent. `run` must ascend in x. */
function yAt(run: readonly Point[], x: number): number {
	const n = run.length;
	if (x <= run[0].x) return run[0].y;
	if (x >= run[n - 1].x) return run[n - 1].y;
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (run[mid].x <= x) lo = mid;
		else hi = mid;
	}
	const a = run[lo];
	const b = run[hi];
	const span = b.x - a.x;
	return span > 0 ? a.y + ((b.y - a.y) * (x - a.x)) / span : b.y;
}

/** Positions along `run` as fractions of its length, x and y each scaled by `sx`, `sy`. */
function arcFractions(run: readonly Point[], sx: number, sy: number): number[] {
	const out = [0];
	let total = 0;
	for (let i = 1; i < run.length; i++) {
		total += Math.hypot(
			(run[i].x - run[i - 1].x) / sx,
			(run[i].y - run[i - 1].y) / sy,
		);
		out.push(total);
	}
	return total > 0
		? out.map((d) => d / total)
		: out.map((_, i) => (run.length > 1 ? i / (run.length - 1) : 0));
}

/** The point a fraction `u` of the way along `run` (fractions from {@link arcFractions}). */
function pointAt(
	run: readonly Point[],
	at: readonly number[],
	u: number,
): Point {
	let i = 1;
	while (i < at.length - 1 && at[i] < u) i++;
	const a = run[i - 1] ?? run[0];
	const b = run[i] ?? a;
	const span = (at[i] ?? 1) - (at[i - 1] ?? 0);
	const f = span > 0 ? (u - (at[i - 1] ?? 0)) / span : 0;
	return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/**
 * Morphs one polyline into another in data units. Two functions of x are
 * resampled onto the union of their xs and blended per x, so points move
 * vertically and the x extent grows or retreats at the ends; other shapes
 * are resampled by arc length and blended point by point. `t = 0` returns
 * `from`, `t = 1` returns `to`.
 *
 * @param t - Blend, clamped to 0..1.
 * @category Math & helpers
 */
export function morphPolyline(
	from: readonly Point[],
	to: readonly Point[],
	t: number,
): Point[] {
	const u = t > 0 ? (t < 1 ? t : 1) : 0;
	if (u === 0 || to.length === 0) return [...from];
	if (u === 1 || from.length === 0) return [...to];

	if (ascending(from) && ascending(to)) {
		const lo = from[0].x + (to[0].x - from[0].x) * u;
		const hi =
			from[from.length - 1].x +
			(to[to.length - 1].x - from[from.length - 1].x) * u;
		const grid = new Set<number>([lo, hi]);
		for (const p of from) if (p.x > lo && p.x < hi) grid.add(p.x);
		for (const p of to) if (p.x > lo && p.x < hi) grid.add(p.x);
		return [...grid]
			.sort((a, b) => a - b)
			.map((x) => ({
				x,
				y: yAt(from, x) + (yAt(to, x) - yAt(from, x)) * u,
			}));
	}

	const all = [...from, ...to];
	const span = (pick: (p: Point) => number) => {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const p of all) {
			min = Math.min(min, pick(p));
			max = Math.max(max, pick(p));
		}
		return max - min || 1;
	};
	const sx = span((p) => p.x);
	const sy = span((p) => p.y);
	const fa = arcFractions(from, sx, sy);
	const ta = arcFractions(to, sx, sy);
	const count = Math.max(from.length, to.length, 2);
	const out: Point[] = [];
	for (let i = 0; i < count; i++) {
		const f = i / (count - 1);
		const a = pointAt(from, fa, f);
		const b = pointAt(to, ta, f);
		out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
	}
	return out;
}

/**
 * Morphs a line of several runs (split at data gaps) into another: run by
 * run when the counts match, else as one line (gaps open or close only at
 * the ends of the blend). See {@link morphPolyline}.
 *
 * @param t - Blend, clamped to 0..1.
 * @category Math & helpers
 */
export function morphRuns(
	from: readonly (readonly Point[])[],
	to: readonly (readonly Point[])[],
	t: number,
): Point[][] {
	const u = t > 0 ? (t < 1 ? t : 1) : 0;
	if (u === 0) return from.map((run) => [...run]);
	if (u === 1) return to.map((run) => [...run]);
	if (from.length === to.length)
		return from.map((run, i) => morphPolyline(run, to[i], u));
	const line = morphPolyline(from.flat(), to.flat(), u);
	return line.length > 0 ? [line] : [];
}

/**
 * One x of an area: its two bounds there, `y1` and `y2` in either order.
 *
 * @category Math & helpers
 */
export interface AreaPoint {
	x: number;
	y1: number;
	y2: number;
}

/** Whether an area's xs never decrease (a function of x, drawn left to right). */
function ascendingArea(run: readonly AreaPoint[]): boolean {
	for (let i = 1; i < run.length; i++) {
		if (!(run[i].x >= run[i - 1].x)) return false;
	}
	return true;
}

/** The area's bounds at `x` by linear interpolation, held at its end bounds outside its extent. `run` must ascend in x and be non-empty. */
function boundsAt(run: readonly AreaPoint[], x: number): [number, number] {
	const n = run.length;
	if (x <= run[0].x) return [run[0].y1, run[0].y2];
	if (x >= run[n - 1].x) return [run[n - 1].y1, run[n - 1].y2];
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (run[mid].x <= x) lo = mid;
		else hi = mid;
	}
	const a = run[lo];
	const b = run[hi];
	const span = b.x - a.x;
	if (!(span > 0)) return [b.y1, b.y2];
	const f = (x - a.x) / span;
	return [a.y1 + (b.y1 - a.y1) * f, a.y2 + (b.y2 - a.y2) * f];
}

/** The area `f` of the way along its points (by index), both bounds and x interpolated. */
function areaAtFraction(run: readonly AreaPoint[], f: number): AreaPoint {
	const at = f * (run.length - 1);
	const i = Math.min(Math.floor(at), run.length - 1);
	const a = run[i];
	const b = run[Math.min(i + 1, run.length - 1)];
	const k = at - i;
	return {
		x: a.x + (b.x - a.x) * k,
		y1: a.y1 + (b.y1 - a.y1) * k,
		y2: a.y2 + (b.y2 - a.y2) * k,
	};
}

/**
 * Morphs one area (a band, a stacked layer, a density fill) into another in
 * data units, both bounds together. Two functions of x are resampled onto
 * the union of their xs and blended per x, as {@link morphPolyline}, so
 * adjacent stack layers keep sharing an edge; other shapes are blended
 * point by point. `t = 0` returns `from`, `t = 1` returns `to`.
 *
 * @param t - Blend, clamped to 0..1.
 * @category Math & helpers
 */
export function morphArea(
	from: readonly AreaPoint[],
	to: readonly AreaPoint[],
	t: number,
): AreaPoint[] {
	const u = t > 0 ? (t < 1 ? t : 1) : 0;
	if (u === 0 || to.length === 0) return from.map((p) => ({ ...p }));
	if (u === 1 || from.length === 0) return to.map((p) => ({ ...p }));

	if (ascendingArea(from) && ascendingArea(to)) {
		const lo = from[0].x + (to[0].x - from[0].x) * u;
		const hi =
			from[from.length - 1].x +
			(to[to.length - 1].x - from[from.length - 1].x) * u;
		const grid = new Set<number>([lo, hi]);
		for (const p of from) if (p.x > lo && p.x < hi) grid.add(p.x);
		for (const p of to) if (p.x > lo && p.x < hi) grid.add(p.x);
		return [...grid]
			.sort((a, b) => a - b)
			.map((x) => {
				const [a1, a2] = boundsAt(from, x);
				const [b1, b2] = boundsAt(to, x);
				return { x, y1: a1 + (b1 - a1) * u, y2: a2 + (b2 - a2) * u };
			});
	}

	const count = Math.max(from.length, to.length, 2);
	const out: AreaPoint[] = [];
	for (let i = 0; i < count; i++) {
		const f = i / (count - 1);
		const a = areaAtFraction(from, f);
		const b = areaAtFraction(to, f);
		out.push({
			x: a.x + (b.x - a.x) * u,
			y1: a.y1 + (b.y1 - a.y1) * u,
			y2: a.y2 + (b.y2 - a.y2) * u,
		});
	}
	return out;
}

/**
 * Morphs an area of several runs (split at data gaps) into another: run by
 * run when the counts match, else as one area. See {@link morphArea}.
 *
 * @param t - Blend, clamped to 0..1.
 * @category Math & helpers
 */
export function morphAreaRuns(
	from: readonly (readonly AreaPoint[])[],
	to: readonly (readonly AreaPoint[])[],
	t: number,
): AreaPoint[][] {
	const u = t > 0 ? (t < 1 ? t : 1) : 0;
	if (u === 0) return from.map((run) => run.map((p) => ({ ...p })));
	if (u === 1) return to.map((run) => run.map((p) => ({ ...p })));
	if (from.length === to.length)
		return from.map((run, i) => morphArea(run, to[i], u));
	const area = morphArea(from.flat(), to.flat(), u);
	return area.length > 0 ? [area] : [];
}

/**
 * A step function: `values[i]` held across `[edges[i], edges[i + 1]]`, so
 * one more edge than values.
 *
 * @category Math & helpers
 */
export interface StepFunction {
	/** Step boundaries, ascending, in data units. */
	edges: readonly number[];
	/** One height per interval, in data units. */
	values: readonly number[];
}

/** Whether a step function's edges never decrease. */
function ascendingEdges(edges: readonly number[]): boolean {
	for (let i = 1; i < edges.length; i++) {
		if (!(edges[i] >= edges[i - 1])) return false;
	}
	return true;
}

/** The step's height at `x`, held at the first and last value outside the edges. Needs at least one value. */
function stepAt(step: StepFunction, x: number): number {
	const { edges, values } = step;
	const n = values.length;
	if (!(x >= edges[0])) return values[0];
	if (x >= edges[n]) return values[n - 1];
	let lo = 0;
	let hi = n;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (edges[mid] <= x) lo = mid;
		else hi = mid;
	}
	return values[lo];
}

/**
 * Morphs one step function into another in data units, so every frame is
 * still stairs. Both are resampled onto the union of their edges and each
 * height blended; outer edges blend between the extents. Non-ascending
 * edges cut from `from` to `to` at `t = 0.5`.
 *
 * @param t - Blend, clamped to 0..1.
 * @returns The step function at `t`, with `edges.length === values.length + 1`.
 * @category Math & helpers
 */
export function morphSteps(
	from: StepFunction,
	to: StepFunction,
	t: number,
): { edges: number[]; values: number[] } {
	const u = t > 0 ? (t < 1 ? t : 1) : 0;
	const copy = (step: StepFunction) => ({
		edges: [...step.edges],
		values: [...step.values],
	});
	const empty = (step: StepFunction) =>
		step.values.length === 0 || step.edges.length !== step.values.length + 1;
	if (u === 0 || empty(to)) return copy(from);
	if (u === 1 || empty(from)) return copy(to);
	if (!ascendingEdges(from.edges) || !ascendingEdges(to.edges))
		return copy(u < 0.5 ? from : to);

	const fa = from.edges;
	const ta = to.edges;
	const lo = fa[0] + (ta[0] - fa[0]) * u;
	const hi = fa[fa.length - 1] + (ta[ta.length - 1] - fa[fa.length - 1]) * u;
	const grid = new Set<number>([lo, hi]);
	for (const x of fa) if (x > lo && x < hi) grid.add(x);
	for (const x of ta) if (x > lo && x < hi) grid.add(x);
	const edges = [...grid].sort((a, b) => a - b);
	const values: number[] = [];
	for (let i = 0; i + 1 < edges.length; i++) {
		const mid = (edges[i] + edges[i + 1]) / 2;
		const a = stepAt(from, mid);
		values.push(a + (stepAt(to, mid) - a) * u);
	}
	return { edges, values };
}
