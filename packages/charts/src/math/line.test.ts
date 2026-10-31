import type { Point } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { dataRuns, decimateRun, isNonDecreasingX, sameRuns } from "./line";

describe("dataRuns", () => {
	it("returns one run for continuous data", () => {
		expect(dataRuns([0, 1, 2], [0, 1, 4])).toEqual([
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
				{ x: 2, y: 4 },
			],
		]);
	});

	it("splits at a non-finite y", () => {
		expect(dataRuns([0, 1, 2, 3], [0, Number.NaN, 2, 3])).toEqual([
			[
				{ x: 2, y: 2 },
				{ x: 3, y: 3 },
			],
		]);
	});

	it("drops a run left with a single point", () => {
		expect(dataRuns([0, 1, 2], [0, Number.NaN, Number.NaN])).toEqual([]);
	});

	it("clips to the shorter of the two arrays", () => {
		expect(dataRuns([0, 1, 2], [0, 1])).toEqual([
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
		]);
	});
});

/** Column edges `columns` wide across `[from, to]`. */
const edgesOver = (from: number, to: number, columns: number) =>
	Array.from(
		{ length: columns + 1 },
		(_, k) => from + ((to - from) * k) / columns,
	);

/** A long, noisy monotonic-in-x series with one spike up and one down. */
function series(count: number): Point[] {
	let state = 7;
	const run: Point[] = [];
	for (let i = 0; i < count; i++) {
		state = (state * 1103515245 + 12345) % 2147483648;
		run.push({ x: i, y: Math.sin(i / 5000) + state / 2147483648 });
	}
	run[123_457].y = 40;
	run[876_543].y = -40;
	return run;
}

describe("decimateRun", () => {
	const columns = 1000;

	it("thins a 1M-point series to a few points per column, keeping every extreme", () => {
		const run = series(1_000_000);
		const edges = edgesOver(0, run.length - 1, columns);
		const out = decimateRun(run, edges);
		expect(out.length).toBeLessThanOrEqual(4 * columns);
		expect(out.length).toBeGreaterThanOrEqual(2 * columns);
		expect(out[0]).toBe(run[0]);
		expect(out[out.length - 1]).toBe(run[run.length - 1]);
		expect(out).toContain(run[123_457]);
		expect(out).toContain(run[876_543]);
		// In order, and per column the same lowest and highest y as the data.
		for (let i = 1; i < out.length; i++)
			expect(out[i].x).toBeGreaterThan(out[i - 1].x);
		const span = (points: readonly Point[], k: number) => {
			let lo = Number.POSITIVE_INFINITY;
			let hi = Number.NEGATIVE_INFINITY;
			for (const p of points) {
				const last = k === columns - 1;
				if (p.x < edges[k] || (last ? p.x > edges[k + 1] : p.x >= edges[k + 1]))
					continue;
				lo = Math.min(lo, p.y);
				hi = Math.max(hi, p.y);
			}
			return [lo, hi];
		};
		for (const k of [0, 1, 123, 500, 876, columns - 1])
			expect(span(out, k)).toEqual(span(run, k));
	});

	it("keeps the points past the window, or only their nearest one when clipped", () => {
		const run = series(1_000_000);
		const edges = edgesOver(400_000, 600_000, columns);
		const kept = decimateRun(run, edges);
		expect(kept.slice(0, 400_000)).toEqual(run.slice(0, 400_000));
		expect(kept.length).toBeLessThan(run.length);
		const clipped = decimateRun(run, edges, true);
		expect(clipped[0]).toBe(run[399_999]);
		expect(clipped[clipped.length - 1]).toBe(run[600_001]);
		expect(clipped.length).toBeLessThanOrEqual(4 * columns + 2);
	});

	it("leaves a run with few points per column as it is", () => {
		const run = series(1_000_000).slice(0, 4 * columns);
		expect(decimateRun(run, edgesOver(0, run.length, columns))).toBe(run);
	});

	it("needs non-decreasing x", () => {
		const point = (x: number) => ({ x, y: 0 });
		expect(isNonDecreasingX([0, 0, 2].map(point))).toBe(true);
		expect(isNonDecreasingX([0, 2, 1].map(point))).toBe(false);
	});
});

describe("sameRuns", () => {
	it("compares runs point by point", () => {
		const a = [
			[
				{ x: 0, y: 1 },
				{ x: 1, y: 2 },
			],
		];
		expect(
			sameRuns(a, [
				[
					{ x: 0, y: 1 },
					{ x: 1, y: 2 },
				],
			]),
		).toBe(true);
		expect(
			sameRuns(a, [
				[
					{ x: 0, y: 1 },
					{ x: 1, y: 3 },
				],
			]),
		).toBe(false);
		expect(sameRuns(a, [[{ x: 0, y: 1 }]])).toBe(false);
		expect(sameRuns(a, [])).toBe(false);
	});
});
