/**
 * The `curve` option on the line and area marks: `linePlot`, `fillBetween`,
 * `stackPlot`. A curved mark paints native cubic segments through its points
 * in scene units; `"linear"` (the default) is the straight drawing unchanged;
 * a reveal along x cuts the curve rather than straightening it; a keyed
 * transition re-curves the blended points on every frame; a gap splits the
 * curve; adjacent stacked bands share their curved edge exactly.
 *
 * Items of a path batch are stored about their own box centre, so
 * "exactly equal" comparisons read "equal to 1e-9".
 */

import type { SceneNode } from "@sophistry/core";
import { group } from "@sophistry/core";
import type { CurveKind, CurvePath, Point } from "@sophistry/core/geometry";
import {
	curvePath,
	curvePathToPolyline,
	reverseCurvePath,
} from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart";
import { chart, chartHandle } from "../chart";
import { mount } from "../test-harness";
import { fillBetween } from "./fill-between";
import { linePlot } from "./line-plot";
import { stackPlot } from "./stack-plot";
import type { CurveItem } from "./test-items";
import { closeCurves, itemsAt } from "./test-items";

/** The paint order the mark under test is drawn at, so axes are left out. */
const Z = 7;

let handle!: ChartHandle;

/** An 8 × 4 chart with fixed ranges and no axes drawn, around `layer`; its painted items. */
function draw(layer: SceneNode, props: Partial<ChartProps> = {}): CurveItem[] {
	const plot = chart.create({
		width: 8,
		height: 4,
		axis: { visible: false },
		xRange: [0, 6],
		yRange: [0, 10],
		legend: false,
		...props,
		children: [layer],
	});
	const scene = mount(plot);
	handle = chartHandle(plot) as ChartHandle;
	return itemsAt(scene.marks(), Z).filter((item) => item.opacity > 0);
}

const curvesOf = (item: CurveItem): CurvePath[] => item.curvePaths ?? [];
const knots = (path: CurvePath): Point[] => [
	path.start,
	...path.segments.map((s) => s.to),
];
const scene = (points: readonly Point[]) =>
	points.map((p) => handle.coords.coordsToPoint(p.x, p.y));
/** Whether a segment is a straight line's collinear-thirds encoding. */
const straight = (from: Point, s: CurvePath["segments"][number]) =>
	Math.abs(s.c1.x - (from.x + (s.to.x - from.x) / 3)) < 1e-9 &&
	Math.abs(s.c1.y - (from.y + (s.to.y - from.y) / 3)) < 1e-9 &&
	Math.abs(s.c2.y - (from.y + (2 * (s.to.y - from.y)) / 3)) < 1e-9;
const closePoints = (a: readonly Point[], b: readonly Point[]) =>
	a.length === b.length &&
	a.every(
		(p, i) =>
			Math.abs(p.x - (b[i] as Point).x) < 1e-9 &&
			Math.abs(p.y - (b[i] as Point).y) < 1e-9,
	);

const ys = [1, 6, 6.5, 2, 3, 8, 7];
const points = ys.map((y, x) => ({ x, y }));

describe("linePlot curve", () => {
	const line = (props: Record<string, unknown>) =>
		draw(linePlot.create({ data: ys, zIndex: Z, ...props }));

	it('"linear" is the default drawing, unchanged: straight polylines through the points', () => {
		const plain = line({});
		const linear = line({ curve: "linear" });
		expect(linear.map((s) => s.polylines)).toEqual(
			plain.map((s) => s.polylines),
		);
		// No cubics to build or flatten: the points are drawn as they are.
		expect(plain[0]?.curvePaths).toBeNull();
		expect(plain[0]?.polylines).toHaveLength(1);
		expect(closePoints(plain[0]?.polylines[0] ?? [], scene(points))).toBe(true);
	});

	it("decimates a long line sorted on x to the plot's columns, not one that isn't", () => {
		const count = 100_000;
		const wave = Array.from(
			{ length: count },
			(_, i) => Math.sin(i / 300) * 4 + 5 + ((i * 7919) % 13) / 13,
		);
		wave[54_321] = 9.99;
		const mountWave = (x: (d: number, i: number) => number) =>
			draw(linePlot.create({ data: wave, x, y: (d: number) => d, zIndex: Z }), {
				xRange: [0, count - 1],
			});
		const [sorted] = mountWave((_, i) => i);
		const run = sorted?.polylines[0] ?? [];
		// At most four points per column (4096 across the plot), however long the data.
		expect(run.length).toBeLessThanOrEqual(4 * 4096);
		expect(run.length).toBeGreaterThan(2 * 4096);
		const top = handle.coords.coordsToPoint(54_321, 9.99);
		expect(run.some((p) => Math.abs(p.y - top.y) < 1e-9)).toBe(true);
		expect(Math.max(...run.map((p) => p.y))).toBeCloseTo(top.y, 9);
		// Swap two neighbours' x: no longer sorted, so drawn whole.
		const [unsorted] = mountWave((_, i) => (i === 10 ? 11 : i === 11 ? 10 : i));
		expect(unsorted?.polylines[0]).toHaveLength(count);
	});

	it("thins a long line over the enclosing clip, and again when the clip changes", () => {
		const count = 100_000;
		const wave = Array.from(
			{ length: count },
			(_, i) => Math.sin(i / 300) * 4 + 5 + ((i * 7919) % 13) / 13,
		);
		const area = (() => {
			draw(linePlot.create({ data: [1, 2], zIndex: Z }));
			return handle.coords.area();
		})();
		const half = {
			minX: area.minX,
			maxX: (area.minX + area.maxX) / 2,
			minY: area.minY,
			maxY: area.maxY,
		};
		const clipper = group.create({
			clip: half,
			children: [
				linePlot.create({
					data: wave,
					x: (_: number, i: number) => i,
					y: (d: number) => d,
					zIndex: Z,
				}),
			],
		});
		const plot = chart.create({
			width: 8,
			height: 4,
			axis: { visible: false },
			xRange: [0, count - 1],
			yRange: [0, 10],
			legend: false,
			children: [clipper],
		});
		const view = mount(plot);
		const runLength = () =>
			itemsAt(view.marks(), Z).find((item) => item.opacity > 0)?.polylines[0]
				?.length ?? 0;
		// Half the plot shows: half the columns, and the points outside go.
		const clipped = runLength();
		expect(clipped).toBeLessThanOrEqual(4 * 2048 + 2);
		expect(clipped).toBeGreaterThan(2 * 2048);
		// The clip grows to the whole plot: the line is thinned again over all of it.
		clipper.set("clip", { ...half, maxX: area.maxX });
		view.commit();
		expect(runLength()).toBeGreaterThan(clipped);
	});

	it.each(["monotone", "natural", "catmull-rom"] as CurveKind[])(
		"%s paints native cubics through every point",
		(curve) => {
			const [shape] = line({ curve });
			const [path] = curvesOf(shape as CurveItem);
			expect(
				closeCurves(path as CurvePath, curvePath(scene(points), curve)),
			).toBe(true);
			expect(closePoints(knots(path as CurvePath), scene(points))).toBe(true);
			expect(
				path?.segments.some((s, i) => !straight(knots(path)[i] as Point, s)),
			).toBe(true);
		},
	);

	it("monotone stays within each pair of points' y", () => {
		const [shape] = line({ curve: "monotone" });
		const [path] = curvesOf(shape as CurveItem);
		const at = scene(points);
		const flat = curvePathToPolyline(path as CurvePath);
		for (const p of flat) {
			const i = Math.min(
				at.findIndex((q) => q.x >= p.x - 1e-9),
				at.length - 1,
			);
			const a = at[Math.max(i - 1, 0)] as Point;
			const b = at[i] as Point;
			expect(p.y).toBeGreaterThanOrEqual(Math.min(a.y, b.y) - 1e-9);
			expect(p.y).toBeLessThanOrEqual(Math.max(a.y, b.y) + 1e-9);
		}
	});

	it("step-after holds each value to the next x", () => {
		const [shape] = line({ curve: "step-after" });
		const [path] = curvesOf(shape as CurveItem);
		expect(knots(path as CurvePath)).toHaveLength(2 * ys.length - 1);
		const corner = handle.coords.pointToCoords(
			knots(path as CurvePath)[1] as Point,
		);
		expect(corner.x).toBeCloseTo(1);
		expect(corner.y).toBeCloseTo(ys[0] as number);
	});

	it("curves each defined run on its own across a gap", () => {
		const gappy = [1, 6, 6.5, Number.NaN, 3, 8, 7];
		const [shape] = line({ data: gappy, curve: "natural" });
		const runs = curvesOf(shape as CurveItem);
		expect(runs).toHaveLength(2);
		expect(
			closeCurves(
				runs[0] as CurvePath,
				curvePath(scene(points.slice(0, 3)), "natural"),
			),
		).toBe(true);
		expect(
			closeCurves(
				runs[1] as CurvePath,
				curvePath(scene(points.slice(4)), "natural"),
			),
		).toBe(true);
	});

	it("a reveal mid-way cuts the curve instead of straightening it", () => {
		const [whole] = curvesOf(line({ curve: "natural" })[0] as CurveItem);
		const [shape] = line({ curve: "natural", progress: 0.5 });
		const [cut] = curvesOf(shape as CurveItem);
		const front = handle.coords.coordsToPoint(3, 0).x;
		const end = (cut as CurvePath).segments[
			(cut as CurvePath).segments.length - 1
		]?.to as Point;
		expect(end.x).toBeCloseTo(front, 9);
		// The kept segments are the whole curve's.
		expect(
			closeCurves(
				{
					...(cut as CurvePath),
					segments: (cut as CurvePath).segments.slice(0, 3),
				},
				{
					...(whole as CurvePath),
					segments: (whole as CurvePath).segments.slice(0, 3),
				},
			),
		).toBe(true);
		// The front lands on the curve: x = 3 is a knot here, so on the data.
		expect(handle.coords.pointToCoords(end).y).toBeCloseTo(ys[3] as number, 6);
		const [partial] = curvesOf(
			line({ curve: "natural", progress: 0.42 })[0] as CurveItem,
		);
		const segments = (partial as CurvePath).segments;
		const last = segments[segments.length - 1] as CurvePath["segments"][number];
		expect(straight(knots(partial as CurvePath).at(-2) as Point, last)).toBe(
			false,
		);
	});

	it("a keyed transition re-curves the blended points", () => {
		const to = [2, 2, 5, 9, 4, 4, 1];
		const at = (blend: number) =>
			curvesOf(
				line({
					to,
					blend,
					staging: "together",
					curve: "monotone",
				})[0] as CurveItem,
			)[0] as CurvePath;
		expect(closeCurves(at(0), curvePath(scene(points), "monotone"))).toBe(true);
		expect(
			closeCurves(
				at(1),
				curvePath(scene(to.map((y, x) => ({ x, y }))), "monotone"),
			),
		).toBe(true);
		const blended = ys.map((y, x) => ({ x, y: (y + (to[x] as number)) / 2 }));
		expect(closeCurves(at(0.5), curvePath(scene(blended), "monotone"))).toBe(
			true,
		);
	});
});

describe("fillBetween curve", () => {
	const rows = ys.map((y, x) => ({ x, hi: y + 1, lo: y - 1 }));
	const band = (props: Record<string, unknown>) =>
		draw(
			fillBetween.create({
				data: rows,
				x: "x",
				y1: "hi",
				y2: "lo",
				zIndex: Z,
				...props,
			}),
		);

	it('"linear" keeps the straight ring', () => {
		const [plain] = band({});
		const [linear] = band({ curve: "linear" });
		expect(linear?.polylines).toEqual(plain?.polylines);
		expect(linear?.curvePaths).toEqual(plain?.curvePaths);
	});

	it("curves both boundaries forward, joined into one closed area", () => {
		const [shape] = band({ curve: "monotone" });
		const [area] = curvesOf(shape as CurveItem) as [CurvePath];
		expect(area.closed).toBe(true);
		const upper = scene(rows.map((r) => ({ x: r.x, y: r.hi })));
		const lower = scene(rows.map((r) => ({ x: r.x, y: r.lo })));
		const n = rows.length - 1;
		const top = curvePath(upper, "monotone");
		expect(
			closeCurves(
				{ ...top, segments: area.segments.slice(0, n), start: area.start },
				top,
			),
		).toBe(true);
		const bottom = reverseCurvePath(curvePath(lower, "monotone"));
		expect(
			closeCurves(
				{
					...bottom,
					start: bottom.start,
					segments: area.segments.slice(n + 1),
				},
				bottom,
			),
		).toBe(true);
	});

	it("reveals behind the clip front with the curve whole", () => {
		const [whole] = band({ curve: "natural" });
		const [half] = band({ curve: "natural", progress: 0.5 });
		expect(half?.curvePaths).toEqual(whole?.curvePaths);
	});

	it("a keyed transition is the plain curved area at both ends", () => {
		const to = rows.map((r) => ({ ...r, hi: r.hi + 1 }));
		const curves = (props: Record<string, unknown>) =>
			curvesOf(band({ curve: "catmull-rom", ...props })[0] as CurveItem);
		const same = (a: CurvePath[], b: CurvePath[]) =>
			a.length === b.length &&
			a.every((path, i) => closeCurves(path, b[i] as CurvePath));
		expect(same(curves({ to, blend: 0 }), curves({}))).toBe(true);
		expect(same(curves({ to, blend: 1 }), curves({ data: to }))).toBe(true);
	});
});

describe("fillBetween curve: an entering region", () => {
	it("sweeps in cut at its front, curved edges kept", () => {
		const rows = ys.map((y, x) => ({ x, hi: y + 1, lo: y - 1, s: "p" }));
		const to = [...rows, ...rows.map((r) => ({ ...r, hi: r.hi + 2, s: "q" }))];
		const areas = (blend: number) =>
			draw(
				fillBetween.create({
					data: rows,
					to,
					blend,
					staging: "together",
					x: "x",
					y1: "hi",
					y2: "lo",
					series: "s",
					curve: "natural",
					zIndex: Z,
				}),
			)
				.flatMap(curvesOf)
				.filter((a) => a.segments.length > 0);
		const whole = areas(1);
		const half = areas(0.5);
		expect(whole).toHaveLength(2);
		expect(half).toHaveLength(2);
		const right = (a: CurvePath) =>
			Math.max(...curvePathToPolyline(a).map((p) => p.x));
		const widths = half.map(right).sort((a, b) => a - b);
		expect(widths[0]).toBeLessThan(handle.coords.coordsToPoint(6, 0).x - 0.1);
		expect(widths[1]).toBeCloseTo(handle.coords.coordsToPoint(6, 0).x, 6);
		const cut = half.find((a) => right(a) === widths[0]) as CurvePath;
		expect(cut.closed).toBe(true);
		expect(
			cut.segments.some((s, i) => !straight(knots(cut)[i] as Point, s)),
		).toBe(true);
	});
});

describe("stackPlot curve", () => {
	const rows = ys.map((y, x) => ({ x, a: y / 2, b: 1 + (x % 3), c: 1 }));
	const stack = (props: Record<string, unknown>) =>
		draw(
			stackPlot.create({
				data: rows,
				x: "x",
				y: ["a", "b", "c"],
				zIndex: Z,
				...props,
			}),
			{ yRange: [0, 12] },
		);

	/** A band's top edge (first n segments) and its bottom edge traced forward (last n, reversed). */
	const edges = (area: CurvePath, n: number) => ({
		top: {
			start: area.start,
			segments: area.segments.slice(0, n),
			closed: false,
		},
		bottom: reverseCurvePath({
			start: (area.segments[n] as CurvePath["segments"][number]).to,
			segments: area.segments.slice(n + 1),
			closed: false,
		}),
	});

	it.each(["monotone", "step", "natural"] as CurveKind[])(
		"%s: each band's top is exactly the next band's bottom",
		(curve) => {
			const bands = stack({ curve });
			expect(bands).toHaveLength(3);
			const areas = bands.map((b) => curvesOf(b)[0] as CurvePath);
			const half = (a: CurvePath) => (a.segments.length - 1) / 2;
			const all = areas.map((a) => edges(a, half(a)));
			let shared = 0;
			for (const lower of all)
				for (const upper of all)
					if (lower !== upper && closeCurves(lower.top, upper.bottom, 1e-9))
						shared++;
			expect(shared).toBe(2);
		},
	);

	it('"linear" keeps the straight rings', () => {
		const plain = stack({});
		const linear = stack({ curve: "linear" });
		expect(linear.map((s) => s.polylines)).toEqual(
			plain.map((s) => s.polylines),
		);
	});

	it("grows with the curve intact", () => {
		const [band] = stack({ curve: "monotone", progress: 0.5 });
		const [area] = curvesOf(band as CurveItem) as [CurvePath];
		expect(area.closed).toBe(true);
		expect(area.segments.length).toBe(2 * (rows.length - 1) + 1);
	});

	it("a keyed transition is the plain curved stack at both ends", () => {
		const to = rows.map((r) => ({ ...r, a: r.a + 1 }));
		const curves = (props: Record<string, unknown>) =>
			stack({ curve: "monotone", ...props }).map(
				(s) => curvesOf(s)[0] as CurvePath,
			);
		const same = (a: CurvePath[], b: CurvePath[]) =>
			a.length === b.length &&
			a.every((path) => b.some((other) => closeCurves(path, other)));
		expect(same(curves({ to, blend: 0 }), curves({}))).toBe(true);
		expect(same(curves({ to, blend: 1 }), curves({ data: to }))).toBe(true);
	});
});
