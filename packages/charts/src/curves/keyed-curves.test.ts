/**
 * Keyed data transitions (`to` + `blend`) on the summarising curve and area
 * marks: `stairs`, `ecdf`, `density` (incl. `orientation: "horizontal"` and
 * ridgeline rows), `regressionPlot`, `fillBetween` and `stackPlot`. Each is
 * a function of one number, so the tests set it and read the scene.
 *
 * Shared expectations: `blend = 0` draws exactly the plain `data` chart and
 * `blend = 1` exactly the plain `to` chart (fitted axes included); a matched
 * shape interpolates in data units on the update stage; a new one enters on
 * the enter stage and a leaving one goes on the exit stage.
 *
 * The last block scrubs through `node.set("blend")`
 * checking every frame stays finite.
 */

import type { SceneNode } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart";
import { chart, chartHandle } from "../chart";
import { regression } from "../math/regression";
import { gaussianKde } from "../math/violin";
import { mount } from "../test-harness";
import { density } from "./density";
import { ecdf } from "./ecdf";
import { fillBetween } from "./fill-between";
import { regressionPlot } from "./regression";
import { stackPlot } from "./stack-plot";
import { stairs } from "./stairs";
import type { CurveItem } from "./test-items";
import { drawing, itemsAt, rounded } from "./test-items";

/** The paint order the mark under test is drawn at, so axes are left out. */
const Z = 7;

/** A chart around `layer`, mounted: its handle and the mark's visible items. */
function draw(
	layer: SceneNode,
	props: Partial<ChartProps> = {},
): { handle: ChartHandle; items: CurveItem[] } {
	const plot = chart.create({
		width: 8,
		height: 4,
		legend: false,
		...props,
		children: [layer],
	});
	const scene = mount(plot);
	return {
		handle: chartHandle(plot) as ChartHandle,
		items: itemsAt(scene.marks(), Z).filter(
			(item) => item.points.length > 0 && item.opacity > 0,
		),
	};
}

/** Scene points as rounded data-unit pairs, through the chart's coordinates. */
const dataPoints = (handle: ChartHandle, item: CurveItem) =>
	item.points.map((p) => {
		const q = handle.coords.pointToCoords(p);
		return [rounded(q.x), rounded(q.y)];
	});
const strokes = (items: CurveItem[]) => items.filter((s) => !s.closed);
const fills = (items: CurveItem[]) => items.filter((s) => s.closed);

type Build<D> = (
	blend: number | undefined,
	data: D,
	to: D | undefined,
) => { layer: SceneNode; chart?: Partial<ChartProps> };

/** `blend = 0` is the plain `data` chart and `blend = 1` the plain `to` chart. */
function expectEnds<D>(build: Build<D>, data: D, to: D) {
	const at = (blend: number | undefined, a: D, b: D | undefined) => {
		const built = build(blend, a, b);
		return drawing(draw(built.layer, built.chart).items);
	};
	const start = at(0, data, to);
	expect(start.length).toBeGreaterThan(0);
	expect(start).toEqual(at(undefined, data, undefined));
	expect(at(1, data, to)).toEqual(at(undefined, to, undefined));
}

// Series data for the step marks: `q` leaves, `r` arrives, `p` changes.
// Stages: exit [0, 1/3], update [1/3, 2/3], enter [2/3, 1], each eased in
// and out, so 1/6, 1/2 and 5/6 are each stage's midpoint.
const stepsFrom = [
	{ s: "p", v: 2 },
	{ s: "p", v: 4 },
	{ s: "q", v: 1 },
	{ s: "q", v: 1 },
];
const stepsTo = [
	{ s: "p", v: 4 },
	{ s: "p", v: 0 },
	{ s: "p", v: 2 },
	{ s: "r", v: 3 },
	{ s: "r", v: 3 },
];

describe("keyed transitions on stairs", () => {
	const build =
		(fixed = false): Build<typeof stepsFrom> =>
		(blend, data, to) => ({
			layer: stairs.create({
				data,
				to,
				blend,
				value: "v",
				series: "s",
				zIndex: Z,
			}),
			chart: {
				color: { domain: ["p", "q", "r"] },
				...(fixed ? { xRange: [0, 4], yRange: [0, 5] } : {}),
			},
		});

	// needs frame: keyed transition axis fitting (the fitted axes at blend 1 are `to`'s)
	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expectEnds(build(), stepsFrom, stepsTo);
	});

	it("is exactly each end's chart under fixed ranges", () => {
		expectEnds(build(true), stepsFrom, stepsTo);
	});

	it("morphs a matched line as a step function, in data units", () => {
		const built = build(true)(0.5, stepsFrom, stepsTo);
		const { handle, items } = draw(built.layer, built.chart);
		const lines = strokes(items).map((s) => dataPoints(handle, s));
		// p: [2, 4] over 0..2 and [4, 0, 2] over 0..3, halfway: the union of
		// edges, each interval's height blended, the right end at 2.5.
		expect(lines).toContainEqual([
			[0, 3],
			[1, 3],
			[1, 2],
			[2, 2],
			[2, 3],
			[2.5, 3],
		]);
	});

	it("fades a leaving line and sweeps a new one in along x", () => {
		const exiting = build(true)(1 / 6, stepsFrom, stepsTo);
		const out = draw(exiting.layer, exiting.chart);
		const q = strokes(out.items).find((s) =>
			dataPoints(out.handle, s).every(([, y]) => y === 1),
		);
		expect(q?.opacity).toBeCloseTo(0.5);
		const entering = build(true)(5 / 6, stepsFrom, stepsTo);
		const into = draw(entering.layer, entering.chart);
		const r = strokes(into.items).find((s) =>
			dataPoints(into.handle, s).every(([, y]) => y === 3),
		);
		expect(r).toBeDefined();
		const xs = dataPoints(into.handle, r as CurveItem).map(
			([x]) => x as number,
		);
		expect(Math.min(...xs)).toBeCloseTo(0);
		expect(Math.max(...xs)).toBeCloseTo(1);
	});
});

describe("keyed transitions on ecdf", () => {
	// needs frame: keyed transition axis fitting
	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expectEnds<number[]>(
			(blend, data, to) => ({
				layer: ecdf.create({ data, to, blend, zIndex: Z }),
			}),
			[1, 2, 2, 3],
			[2, 3, 4, 6, 7],
		);
	});

	it("is exactly each end's chart under fixed ranges", () => {
		expectEnds<number[]>(
			(blend, data, to) => ({
				layer: ecdf.create({ data, to, blend, pad: 0.5, zIndex: Z }),
				chart: { xRange: [0, 8], yRange: [0, 1] },
			}),
			[1, 2, 2, 3],
			[2, 3, 4, 6, 7],
		);
	});

	it("morphs between two CDFs as a step function, in data units", () => {
		// One curve, so the update is the whole blend: 0.5 is halfway.
		const { handle, items } = draw(
			ecdf.create({
				data: [1, 2, 3],
				to: [2, 3, 4],
				blend: 0.5,
				pad: 0.5,
				zIndex: Z,
			}),
			{ xRange: [0, 5], yRange: [0, 1] },
		);
		const [line] = strokes(items).map((s) => dataPoints(handle, s)) as [
			number[][],
		];
		// The extent blends from [0.5, 3.5] to [1.5, 4.5].
		expect(line[0]).toEqual([1, 1 / 6].map(rounded));
		expect(line[line.length - 1]).toEqual([4, 5 / 6].map(rounded));
		// On [2, 3] the old CDF is 2/3 and the new 1/3.
		expect(line).toContainEqual([2, 0.5]);
		expect(line).toContainEqual([3, 0.5]);
		// Treads and risers only: every segment is horizontal or vertical.
		for (let i = 1; i < line.length; i++) {
			const [x0, y0] = line[i - 1] as number[];
			const [x1, y1] = line[i] as number[];
			expect(x1 === x0 || y1 === y0).toBe(true);
		}
	});
});

describe("keyed transitions on density", () => {
	const options = {
		domain: [-4, 4] as [number, number],
		bandwidth: 1,
		samples: 9,
	};
	const a = [-1, 0, 0, 1];
	const b = [0, 1, 2, 2];
	const build =
		(orientation?: "horizontal", fixed = false): Build<number[]> =>
		(blend, data, to) => ({
			layer: density.create({
				data,
				to,
				blend,
				...options,
				orientation,
				zIndex: Z,
			}),
			chart: fixed ? { xRange: [-4, 4], yRange: [-4, 4] } : {},
		});

	// needs frame: keyed transition axis fitting
	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expectEnds(build(), a, b);
		expectEnds(build("horizontal"), a, b);
	});

	it("is exactly each end's chart under fixed ranges", () => {
		expectEnds(build(undefined, true), a, b);
		expectEnds(build("horizontal", true), a, b);
	});

	it("blends the densities per value on a shared grid", () => {
		const kdeA = gaussianKde(a, options);
		const kdeB = gaussianKde(b, options);
		for (const orientation of [undefined, "horizontal"] as const) {
			const built = build(orientation, true)(0.5, a, b);
			const { handle, items } = draw(built.layer, built.chart);
			const [curve] = strokes(items).map((s) => dataPoints(handle, s)) as [
				number[][],
			];
			const expected = kdeA.map((p, i) => {
				const value = (p.density + (kdeB[i]?.density ?? 0)) / 2;
				return orientation ? [value, p.x] : [p.x, value];
			});
			curve.forEach(([x, y], i) => {
				expect(x).toBeCloseTo(expected[i]?.[0] as number, 5);
				expect(y).toBeCloseTo(expected[i]?.[1] as number, 5);
			});
		}
	});

	describe("ridgelines", () => {
		const rowsFrom = [
			...[1, 2, 2, 3].map((x) => ({ s: "p", x })),
			...[4, 5, 5, 6].map((x) => ({ s: "q", x })),
		];
		const rowsTo = [
			...[3, 4, 4, 5].map((x) => ({ s: "q", x })),
			...[0, 1, 1, 2].map((x) => ({ s: "r", x })),
		];
		const ridges: Build<typeof rowsFrom> = (blend, data, to) => ({
			layer: density.create({
				data,
				to,
				blend,
				x: "x",
				series: "s",
				row: true,
				zIndex: Z,
			}),
			chart: { color: { domain: ["p", "q", "r"] } },
		});

		// needs frame: keyed transition axis fitting (band categories at each end)
		it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
			expectEnds(ridges, rowsFrom, rowsTo);
		});

		// needs frame: keyed transition axis fitting (the band axis staged across the transition)
		it("fades a leaving row's ridge, slides a kept one with its row, sweeps a new one in", () => {
			const exiting = ridges(1 / 6, rowsFrom, rowsTo);
			const out = draw(exiting.layer, exiting.chart);
			const color = (key: string) => out.handle.color(key);
			const leaving = out.items.filter(
				(s) => s.stroke === color("p") && !s.closed,
			);
			expect(leaving.length).toBeGreaterThan(0);
			for (const s of leaving) expect(s.opacity).toBeCloseTo(0.5);

			// Mid-update: q's ridge stands on its row's band as the axis has it.
			const updating = ridges(0.5, rowsFrom, rowsTo);
			const mid = draw(updating.layer, updating.chart);
			const band = mid.handle.yBand;
			const start = band?.start("q") as number;
			const span = [start, start + (band?.bandwidth ?? 0)];
			const foot = Math.min(
				mid.handle.coords.coordsToPoint(0, span[0] as number).y,
				mid.handle.coords.coordsToPoint(0, span[1] as number).y,
			);
			const q = fills(mid.items).find((s) => s.fill === mid.handle.color("q"));
			expect(q).toBeDefined();
			expect(Math.min(...(q as CurveItem).points.map((p) => p.y))).toBeCloseTo(
				foot,
				5,
			);

			const entering = ridges(5 / 6, rowsFrom, rowsTo);
			const into = draw(entering.layer, entering.chart);
			const r = strokes(into.items).find(
				(s) => s.stroke === into.handle.color("r"),
			);
			const ended = ridges(1, rowsFrom, rowsTo);
			const end = draw(ended.layer, ended.chart);
			const whole = strokes(end.items).find(
				(s) => s.stroke === end.handle.color("r"),
			);
			const xs = (r as CurveItem).points.map((p: Point) => p.x);
			const full = (whole as CurveItem).points.map((p: Point) => p.x);
			const left = Math.min(...full);
			const right = Math.max(...full);
			expect(Math.min(...xs)).toBeCloseTo(left, 5);
			expect(Math.max(...xs)).toBeCloseTo(left + (right - left) * 0.5, 5);
		});
	});
});

describe("keyed transitions on regressionPlot", () => {
	const line = (slope: number, noise: number[]) =>
		[0, 1, 2, 3, 4].map((x, i) => ({ x, y: slope * x + (noise[i] as number) }));
	const from = line(1, [0.3, -0.2, 0.1, -0.4, 0.2]);
	const to = line(2, [-0.1, 0.4, -0.3, 0.2, 0.1]);
	const build =
		(fixed = false): Build<typeof from> =>
		(blend, data, next) => ({
			layer: regressionPlot.create({
				data,
				to: next,
				blend,
				x: "x",
				y: "y",
				zIndex: Z,
			}),
			chart: fixed ? { xRange: [0, 4], yRange: [-2, 10] } : {},
		});

	// needs frame: keyed transition axis fitting
	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expectEnds(build(), from, to);
	});

	it("is exactly each end's chart under fixed ranges", () => {
		expectEnds(build(true), from, to);
	});

	it("blends the fit and both ends of its band per x", () => {
		const built = build(true)(0.5, from, to);
		const { handle, items } = draw(built.layer, built.chart);
		const fitOf = (rows: typeof from) =>
			regression(
				rows.map((d) => d.x),
				rows.map((d) => d.y),
			);
		const fa = fitOf(from);
		const fb = fitOf(to);
		const [fit] = strokes(items).map((s) => dataPoints(handle, s)) as [
			number[][],
		];
		fit.forEach(([x, y], i) => {
			expect(x).toBeCloseTo(fa[i]?.x as number, 5);
			expect(y).toBeCloseTo(
				((fa[i]?.y as number) + (fb[i]?.y as number)) / 2,
				5,
			);
		});
		const [band] = fills(items).map((s) => dataPoints(handle, s)) as [
			number[][],
		];
		fa.forEach((p, i) => {
			expect(band[i]?.[1]).toBeCloseTo(
				(p.high + (fb[i]?.high as number)) / 2,
				5,
			);
		});
	});
});

describe("keyed transitions on fillBetween", () => {
	const from = [
		{ s: "p", x: 0, a: 2, b: 0 },
		{ s: "p", x: 1, a: 2, b: 0 },
		{ s: "p", x: 2, a: 2, b: 0 },
		{ s: "q", x: 0, a: 9, b: 8 },
		{ s: "q", x: 2, a: 9, b: 8 },
	];
	const to = [
		{ s: "p", x: 0, a: 4, b: 2 },
		{ s: "p", x: 1, a: 6, b: 2 },
		{ s: "p", x: 2, a: 4, b: 2 },
		{ s: "r", x: 0, a: 7, b: 6 },
		{ s: "r", x: 2, a: 7, b: 6 },
	];
	const build =
		(fixed = false): Build<typeof from> =>
		(blend, data, next) => ({
			layer: fillBetween.create({
				data,
				to: next,
				blend,
				x: "x",
				y1: "a",
				y2: "b",
				series: "s",
				zIndex: Z,
			}),
			chart: {
				color: { domain: ["p", "q", "r"] },
				...(fixed ? { xRange: [0, 2], yRange: [0, 10] } : {}),
			},
		});

	// needs frame: keyed transition axis fitting
	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expectEnds(build(), from, to);
	});

	it("is exactly each end's chart under fixed ranges", () => {
		expectEnds(build(true), from, to);
	});

	it("morphs both bounds together on a shared x grid", () => {
		const built = build(true)(0.5, from, to);
		const { handle, items } = draw(built.layer, built.chart);
		const regions = fills(items).map((s) => dataPoints(handle, s));
		expect(regions).toContainEqual([
			[0, 3],
			[1, 4],
			[2, 3],
			[2, 1],
			[1, 1],
			[0, 1],
			[0, 3],
		]);
	});

	it("fades a leaving region and sweeps a new one in along x", () => {
		const exiting = build(true)(1 / 6, from, to);
		const out = draw(exiting.layer, exiting.chart);
		const q = fills(out.items).find((s) =>
			dataPoints(out.handle, s).every(([, y]) => (y as number) >= 8),
		);
		expect(q?.opacity).toBeCloseTo(0.5);
		const entering = build(true)(5 / 6, from, to);
		const into = draw(entering.layer, entering.chart);
		const r = fills(into.items).find((s) =>
			dataPoints(into.handle, s).every(
				([, y]) => (y as number) >= 6 && (y as number) <= 7,
			),
		);
		expect(r).toBeDefined();
		const xs = dataPoints(into.handle, r as CurveItem).map(
			([x]) => x as number,
		);
		expect(Math.max(...xs)).toBeCloseTo(1);
	});
});

describe("keyed transitions on stackPlot", () => {
	const wideFrom = [
		{ t: 0, a: 1, b: 1 },
		{ t: 1, a: 1, b: 1 },
	];
	const wideTo = [
		{ t: 0, a: 3, b: 1 },
		{ t: 1, a: 1, b: 3 },
	];
	const long = (keys: string[]) =>
		keys.flatMap((s) => [0, 1].map((t) => ({ s, t, v: 1 })));
	const longFrom = long(["a", "b", "c"]);
	const longTo = long(["a", "c", "d"]);
	const wide =
		(fixed = false): Build<typeof wideFrom> =>
		(blend, data, to) => ({
			layer: stackPlot.create({
				data,
				to,
				blend,
				x: "t",
				y: ["a", "b"],
				series: ["a", "b"],
				zIndex: Z,
			}),
			chart: fixed ? { xRange: [0, 1], yRange: [0, 5] } : {},
		});
	const longChart = (blend: number | undefined, staging?: "together") =>
		draw(
			stackPlot.create({
				data: longFrom,
				to: longTo,
				blend,
				staging,
				x: "t",
				y: "v",
				series: "s",
				zIndex: Z,
			}),
			{ xRange: [0, 1], yRange: [0, 4] },
		);
	/** Each band's `[bottom, top]` in data units (the data is flat across x), by fill colour. */
	const spans = (handle: ChartHandle, items: CurveItem[]) =>
		new Map(
			fills(items).map((s) => {
				const ys = s.points.map((p) => p.y);
				const x = s.points[0]?.x ?? 0;
				const lo = handle.coords.pointToCoords({ x, y: Math.min(...ys) }).y;
				const hi = handle.coords.pointToCoords({ x, y: Math.max(...ys) }).y;
				return [s.fill, [rounded(Math.min(lo, hi)), rounded(Math.max(lo, hi))]];
			}),
		);

	// needs frame: keyed transition axis fitting
	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expectEnds(wide(), wideFrom, wideTo);
	});

	it("is exactly each end's chart under fixed ranges", () => {
		expectEnds(wide(true), wideFrom, wideTo);
		expectEnds<typeof longFrom>(
			(blend, data, to) => ({
				layer: stackPlot.create({
					data,
					to,
					blend,
					x: "t",
					y: "v",
					series: "s",
					zIndex: Z,
				}),
				chart: {
					color: { domain: ["a", "b", "c", "d"] },
					xRange: [0, 1],
					yRange: [0, 4],
				},
			}),
			longFrom,
			longTo,
		);
	});

	it("morphs each band's bounds together, so the stack stays a stack", () => {
		const built = wide(true)(0.5, wideFrom, wideTo);
		const { handle, items } = draw(built.layer, built.chart);
		const rings = fills(items).map((s) => dataPoints(handle, s));
		// a: [0, 1] → [0, 3] at t = 0 and [0, 1] → [0, 1] at t = 1.
		expect(rings).toContainEqual([
			[0, 2],
			[1, 1],
			[1, 0],
			[0, 0],
			[0, 2],
		]);
		// b sits on a: [1, 2] → [3, 4] and [1, 2] → [1, 4].
		expect(rings).toContainEqual([
			[0, 3],
			[1, 3],
			[1, 1],
			[0, 2],
			[0, 3],
		]);
	});

	it("shrinks a leaving band and settles the ones above, then grows a new one on top", () => {
		const at = (blend: number, staging?: "together") => {
			const { handle, items } = longChart(blend, staging);
			const out = spans(handle, items);
			return (key: string) => out.get(handle.color(key));
		};
		const exiting = at(1 / 6);
		expect(exiting("a")).toEqual([0, 1]);
		expect(exiting("b")).toEqual([1, 1.5]);
		expect(exiting("c")).toEqual([1.5, 2.5]);
		expect(exiting("d")).toBeUndefined();
		const updating = at(0.5);
		expect(updating("b")).toBeUndefined();
		expect(updating("c")).toEqual([1, 2]);
		expect(updating("d")).toBeUndefined();
		const entering = at(5 / 6);
		expect(entering("d")).toEqual([2, 2.5]);
		// All at once: the leaving band shrinks while the new one grows, and
		// every band still starts where the one below ends.
		const together = at(0.5, "together");
		expect(together("a")).toEqual([0, 1]);
		expect(together("b")).toEqual([1, 1.25]);
		expect(together("c")).toEqual([1.25, 2.25]);
		expect(together("d")).toEqual([2.25, 2.5]);
	});
});

describe("keyed curve marks under animation", () => {
	it("scrubs every mark back and forth, each frame finite and settled", () => {
		const samples = [
			...[1, 2, 2, 3, 4].map((x) => ({ s: "p", x, y: x * 1.5 })),
			...[4, 5, 5, 6, 7].map((x) => ({ s: "q", x, y: 9 - x })),
		];
		const samples2 = [
			...[2, 3, 3, 4, 6].map((x) => ({ s: "q", x, y: x * 0.5 })),
			...[0, 1, 1, 2, 3].map((x) => ({ s: "r", x, y: 2 + x })),
		];
		const stack = ["a", "b", "c"].flatMap((s, k) =>
			[0, 1, 2].map((t) => ({ s, t, v: 1 + ((t + k) % 2) })),
		);
		const stack2 = ["a", "c", "d"].flatMap((s, k) =>
			[0, 1, 2, 3].map((t) => ({ s, t, v: 2 - ((t + k) % 2) })),
		);
		const layers: SceneNode[][] = [
			[
				stairs.create({
					data: stepsFrom,
					to: stepsTo,
					value: "v",
					series: "s",
				}),
				ecdf.create({ data: samples, to: samples2, value: "x", series: "s" }),
			],
			[density.create({ data: samples, to: samples2, x: "x", series: "s" })],
			[
				density.create({
					data: samples,
					to: samples2,
					x: "x",
					series: "s",
					row: true,
				}),
			],
			[
				density.create({
					data: samples,
					to: samples2,
					x: "x",
					orientation: "horizontal",
				}),
			],
			[
				regressionPlot.create({
					data: samples,
					to: samples2,
					x: "x",
					y: "y",
					series: "s",
				}),
				fillBetween.create({
					data: samples,
					to: samples2,
					x: "x",
					y1: "y",
					y2: (d: { y: number }) => d.y - 1,
					series: "s",
				}),
			],
			[
				stackPlot.create({
					data: stack,
					to: stack2,
					x: "t",
					y: "v",
					series: "s",
				}),
			],
		];
		for (const children of layers) {
			const plot = chart.create({ width: 8, height: 4, children });
			const scene = mount(plot);
			for (const t of [
				0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 0.5, 0.15, 0, 1,
			]) {
				for (const layer of children) layer.set("blend" as never, t as never);
				scene.commit();
				for (const item of itemsAt(scene.marks(), 0))
					for (const p of item.points)
						expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
			}
		}
	});
});
