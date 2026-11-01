/**
 * The `series` channel on the line and area marks: one shape per category,
 * coloured through the chart's scale, reported to its legend, yielding to an
 * explicit colour, and revealed behind one front.
 */

import type { SceneNode } from "@sophistry/core";
import { clipBounds, cssColor } from "@sophistry/core/internal";
import { resolveTheme } from "@sophistry/core/themes";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import { mount } from "../test-harness.js";
import { density } from "./density.js";
import { ecdf } from "./ecdf.js";
import { fillBetween } from "./fill-between.js";
import { linePlot } from "./line-plot.js";
import { regressionPlot } from "./regression.js";
import { stackPlot } from "./stack-plot.js";
import { stairs } from "./stairs.js";
import type { CurveItem } from "./test-items.js";
import { curveItems } from "./test-items.js";

const RANGE = ["#111111", "#222222", "#333333"].map((c) => cssColor(c));

let handle!: ChartHandle;
/** Mounts a chart around `layers`; the visible items of every curve mark. */
function draw(
	layers: SceneNode[],
	props: Partial<ChartProps> = {},
): CurveItem[] {
	const plot = chart.create({
		width: 8,
		height: 4,
		axis: { visible: false },
		...props,
		children: layers,
	});
	const scene = mount(plot);
	handle = chartHandle(plot) as ChartHandle;
	return curveItems(scene.marks()).filter(
		(item) => item.points.length > 0 && item.opacity > 0,
	);
}
const x = (value: number) => handle.coords.coordsToPoint(value, 0).x;
const y = (value: number) => handle.coords.coordsToPoint(0, value).y;
const boxOf = (item: CurveItem) => {
	const xs = item.points.map((p) => p.x);
	const ys = item.points.map((p) => p.y);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
	};
};
const lines = (items: CurveItem[]) => items.filter((s) => !s.closed);
const regions = (items: CurveItem[]) => items.filter((s) => s.closed);
const inRange = (items: CurveItem[], side: "fill" | "stroke") =>
	items.filter((s) =>
		side === "fill"
			? s.closed && RANGE.includes(s.fill)
			: !s.closed && RANGE.includes(s.stroke),
	);

const temps = [
	{ month: 1, city: "Oslo", c: -4 },
	{ month: 1, city: "Rome", c: 8 },
	{ month: 4, city: "Oslo", c: 6 },
	{ month: 4, city: "Rome", c: 15 },
	{ month: 7, city: "Oslo", c: 17 },
	{ month: 7, city: "Rome", c: 25 },
];

describe("series on linePlot", () => {
	it("draws one line per category, coloured by the chart's scale", () => {
		const drawn = inRange(
			draw(
				[linePlot.create({ data: temps, x: "month", y: "c", series: "city" })],
				{
					color: { range: RANGE },
					legend: false,
				},
			),
			"stroke",
		);
		expect(drawn.map((s) => s.stroke)).toEqual(RANGE.slice(0, 2));
		// Each line runs through its own category's three points.
		for (const line of drawn) {
			expect(line.points).toHaveLength(3);
			const box = boxOf(line);
			expect(box.minX).toBeLessThan(box.maxX);
		}
	});

	it("skips a NaN category, as the other grouped marks do", () => {
		const rows = [
			{ x: 0, y: 1, g: 1 },
			{ x: 1, y: 2, g: 1 },
			{ x: 0, y: 3, g: 2 },
			{ x: 1, y: 4, g: 2 },
			{ x: 0, y: 5, g: Number.NaN },
			{ x: 1, y: 6, g: Number.NaN },
		];
		const drawn = lines(
			draw([linePlot.create({ data: rows, x: "x", y: "y", series: "g" })], {
				color: { range: RANGE },
				legend: false,
			}),
		);
		expect(drawn.map((s) => s.stroke)).toEqual(RANGE.slice(0, 2));
	});

	it("without a series, draws the one line it always did, in the foreground", () => {
		const drawn = lines(draw([linePlot.create({ data: [1, 3, 2] })]));
		expect(drawn).toHaveLength(1);
		expect(drawn[0]?.polylines).toHaveLength(1);
		expect(drawn[0]?.stroke).toBe(
			cssColor(resolveTheme({ mode: "dark" }).palette.foreground),
		);
	});

	it("stroke overrides the scale, and the layer then reports no categories", () => {
		const drawn = draw([
			linePlot.create({
				data: temps,
				x: "month",
				y: "c",
				series: "city",
				stroke: "#abcdef",
			}),
		]);
		expect(
			lines(drawn).filter((s) => s.stroke === cssColor("#abcdef")),
		).toHaveLength(2);
		expect(handle.colorDomain()).toEqual([]);
	});

	it("reveals every series behind one front", () => {
		const drawn = lines(
			draw(
				[
					linePlot.create({
						data: [
							{ t: 0, v: 1, s: "a" },
							{ t: 10, v: 2, s: "a" },
							{ t: 5, v: 3, s: "b" },
							{ t: 10, v: 4, s: "b" },
						],
						x: "t",
						y: "v",
						series: "s",
						progress: 0.4,
					}),
				],
				{ color: { range: RANGE }, legend: false },
			),
		);
		// 40% along the joint extent [0, 10] is t = 4: "a" is partly drawn,
		// "b" (which starts at 5) has not begun.
		expect(drawn.map((s) => s.stroke)).toEqual([RANGE[0]]);
	});

	it("scrubs the reveal and changes data with every frame drawn", () => {
		const line = linePlot.create({
			data: temps,
			x: "month",
			y: "c",
			series: "city",
		});
		const plot = chart.create({
			width: 8,
			height: 4,
			progress: 0,
			children: [line],
		});
		const scene = mount(plot);
		for (const p of [0.2, 0.5, 0.7, 0.88, 0.93, 1, 1, 1, 0.6, 0, 1]) {
			plot.set("progress", p);
			scene.commit();
		}
		expect(lines(curveItems(scene.marks()))).toHaveLength(2);
		for (const k of [1, 2, 3, 4, 5]) {
			line.set(
				"data",
				temps.map((d) => ({ ...d, c: d.c + k })),
			);
			scene.commit();
		}
		const coords = (chartHandle(plot) as ChartHandle).coords;
		const top = Math.max(
			...lines(curveItems(scene.marks())).flatMap((s) =>
				s.points.map((p) => p.y),
			),
		);
		expect(top).toBeCloseTo(coords.coordsToPoint(7, 30).y, 9);
	});
});

describe("stackPlot series", () => {
	const wide = [
		{ t: 0, a: 1, b: 2 },
		{ t: 1, a: 2, b: 1 },
		{ t: 2, a: 3, b: 2 },
	];
	const long = wide.flatMap((row) => [
		{ t: row.t, kind: "a", v: row.a },
		{ t: row.t, kind: "b", v: row.b },
	]);

	it("names wide-format bands, colouring them through the scale", () => {
		const items = draw(
			[
				stackPlot.create({
					data: wide,
					x: "t",
					y: ["a", "b"],
					series: ["web", "app"],
				}),
			],
			{ color: { range: RANGE } },
		);
		expect(handle.colorDomain()).toEqual(["web", "app"]);
		expect(inRange(items, "fill").map((s) => s.fill)).toEqual(
			RANGE.slice(0, 2),
		);
	});

	it("lists wide-format band names in the legend", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			axis: { visible: false },
			color: { range: RANGE },
			children: [
				stackPlot.create({
					data: wide,
					x: "t",
					y: ["a", "b"],
					series: ["web", "app"],
				}),
			],
		});
		const scene = mount(plot);
		expect(scene.texts().map((t) => t.text)).toEqual(
			expect.arrayContaining(["web", "app"]),
		);
	});

	it("long format: one y channel and a series channel stack like the wide table", () => {
		const a = regions(
			draw([stackPlot.create({ data: wide, x: "t", y: ["a", "b"] })], {
				legend: false,
			}),
		);
		const b = regions(
			draw([stackPlot.create({ data: long, x: "t", y: "v", series: "kind" })], {
				legend: false,
				color: { range: RANGE },
			}),
		);
		expect(b).toHaveLength(2);
		expect(b.map((s) => s.fill)).toEqual(RANGE.slice(0, 2));
		for (let i = 0; i < 2; i++) {
			const boxA = boxOf(a[i] as CurveItem);
			const boxB = boxOf(b[i] as CurveItem);
			expect(boxB.maxY).toBeCloseTo(boxA.maxY);
			expect(boxB.minY).toBeCloseTo(boxA.minY);
			expect(boxB.maxX).toBeCloseTo(boxA.maxX);
		}
	});

	it("colors overrides the scale, and the layer then reports nothing", () => {
		const items = draw([
			stackPlot.create({
				data: long,
				x: "t",
				y: "v",
				series: "kind",
				colors: ["#abcdef", "#fedcba"],
			}),
		]);
		expect(handle.colorDomain()).toEqual([]);
		expect(regions(items).map((s) => s.fill)).toEqual(
			["#abcdef", "#fedcba"].map((c) => cssColor(c)),
		);
	});

	it("without a series, draws the bands it always did", () => {
		const items = draw([
			stackPlot.create({ data: wide, x: "t", y: ["a", "b"] }),
		]);
		const series = resolveTheme({ mode: "dark" }).palette.series;
		expect(handle.colorDomain()).toEqual([]);
		expect(regions(items).map((s) => s.fill)).toEqual(
			[series[0], series[1]].map((c) => cssColor(c as string)),
		);
	});
});

const waits = [
	...[2.1, 2.4, 3.0, 3.1, 3.3].map((v) => ({ v, line: "a" })),
	...[5.5, 6.1, 6.4, 7.0, 7.2].map((v) => ({ v, line: "b" })),
];

describe("density series", () => {
	it("draws one curve per category, coloured, all behind one front", () => {
		const items = draw(
			[density.create({ data: waits, x: "v", series: "line" })],
			{
				color: { range: RANGE },
				legend: false,
				progress: 0.75,
			},
		);
		const curves = inRange(items, "stroke");
		expect(curves.map((s) => s.stroke)).toEqual(RANGE.slice(0, 2));
		expect(curves[0]?.clip).toBe(curves[1]?.clip);
		// Half the data phase: the front stands halfway across both curves.
		const left = Math.min(...curves.map((s) => boxOf(s).minX));
		const right = Math.max(...curves.map((s) => boxOf(s).maxX));
		expect(clipBounds(curves[0]?.clip)?.maxX).toBeCloseTo((left + right) / 2);
	});

	it("row with a series: one ridge per category, the categories as rows", () => {
		draw([density.create({ data: waits, x: "v", series: "line", row: true })], {
			legend: false,
		});
		expect(handle.yBand?.domain).toEqual(["a", "b"]);
		expect(handle.colorDomain()).toEqual(["a", "b"]);
	});

	it("color overrides the scale", () => {
		const items = draw([
			density.create({ data: waits, x: "v", series: "line", color: "#abcdef" }),
		]);
		expect(handle.colorDomain()).toEqual([]);
		expect(
			lines(items).filter((s) => s.stroke === cssColor("#abcdef")),
		).toHaveLength(2);
	});
});

describe("regressionPlot series", () => {
	const points = [0, 1, 2, 3, 4].flatMap((t) => [
		{ t, v: 1 + t, g: "up" },
		{ t, v: 9 - t * 1.5, g: "down" },
	]);

	it("fits each category on its own, coloured", () => {
		const fits = lines(
			draw(
				[
					regressionPlot.create({
						data: points,
						x: "t",
						y: "v",
						series: "g",
						level: 0,
					}),
				],
				{ color: { range: RANGE } },
			),
		);
		expect(fits).toHaveLength(2);
		const [up, down] = fits as [CurveItem, CurveItem];
		expect(up.stroke).toBe(RANGE[0]);
		expect(down.stroke).toBe(RANGE[1]);
		// "up" runs from 1 to 5; "down" from 9 to 3.
		expect(boxOf(up).minY).toBeCloseTo(y(1));
		expect(boxOf(up).maxY).toBeCloseTo(y(5));
		expect(boxOf(down).minY).toBeCloseTo(y(3));
		expect(boxOf(down).maxY).toBeCloseTo(y(9));
		expect(handle.colorDomain()).toEqual(["up", "down"]);
	});
});

describe("stairs series and ecdf series", () => {
	const steps = [
		{ g: "a", v: 1 },
		{ g: "b", v: 3 },
		{ g: "a", v: 2 },
		{ g: "b", v: 1 },
	];

	it("stairs: one step line per category over the shared edges", () => {
		const drawn = inRange(
			draw(
				[
					stairs.create({
						data: steps,
						value: "v",
						series: "g",
						edges: [0, 1, 2],
					}),
				],
				{
					color: { range: RANGE },
					legend: false,
				},
			),
			"stroke",
		);
		expect(drawn.map((s) => s.stroke)).toEqual(RANGE.slice(0, 2));
		expect(boxOf(drawn[0] as CurveItem).maxY).toBeCloseTo(y(2));
		expect(boxOf(drawn[1] as CurveItem).maxY).toBeCloseTo(y(3));
		expect(boxOf(drawn[0] as CurveItem).maxX).toBeCloseTo(x(2));
	});

	it("stairs: the lines reveal behind one front, across their joint extent", () => {
		const drawn = inRange(
			draw(
				[
					stairs.create({
						data: [...steps, { g: "b", v: 2 }, { g: "b", v: 2 }],
						value: "v",
						series: "g",
						progress: 0.5,
					}),
				],
				{ color: { range: RANGE }, legend: false, xRange: [0, 4] },
			),
			"stroke",
		);
		// "a" spans 0..2, "b" 0..4: the joint front is at x = 2.
		expect(drawn).toHaveLength(2);
		for (const line of drawn)
			expect(boxOf(line).maxX).toBeLessThanOrEqual(x(2) + 1e-9);
		expect(boxOf(drawn[1] as CurveItem).maxX).toBeCloseTo(x(2));
	});

	it("stairs: stroke overrides the scale", () => {
		const items = draw([
			stairs.create({
				data: steps,
				value: "v",
				series: "g",
				stroke: "#abcdef",
			}),
		]);
		expect(handle.colorDomain()).toEqual([]);
		expect(
			lines(items).filter((s) => s.stroke === cssColor("#abcdef")),
		).toHaveLength(2);
	});

	it("ecdf: one curve per category, each rising to 1", () => {
		const curves = inRange(
			draw([ecdf.create({ data: waits, value: "v", series: "line" })], {
				color: { range: RANGE },
			}),
			"stroke",
		);
		expect(curves.map((s) => s.stroke)).toEqual(RANGE.slice(0, 2));
		for (const curve of curves) expect(boxOf(curve).maxY).toBeCloseTo(y(1));
		// "a" is done before "b" begins.
		expect(boxOf(curves[0] as CurveItem).maxX).toBeLessThan(
			boxOf(curves[1] as CurveItem).maxX,
		);
		expect(handle.colorDomain()).toEqual(["a", "b"]);
	});
});

describe("fillBetween series", () => {
	it("one region per category, filled from the scale; fill overrides", () => {
		const band = [0, 1, 2].flatMap((t) => [
			{ t, lo: t, hi: t + 1, g: "a" },
			{ t, lo: t + 3, hi: t + 4, g: "b" },
		]);
		const filled = inRange(
			draw(
				[
					fillBetween.create({
						data: band,
						x: "t",
						y1: "hi",
						y2: "lo",
						series: "g",
					}),
				],
				{
					color: { range: RANGE },
					legend: false,
				},
			),
			"fill",
		);
		expect(filled.map((s) => s.fill)).toEqual(RANGE.slice(0, 2));
		expect(boxOf(filled[0] as CurveItem).maxY).toBeCloseTo(y(3));
		expect(boxOf(filled[1] as CurveItem).minY).toBeCloseTo(y(3));

		const plain = draw([
			fillBetween.create({
				data: band,
				x: "t",
				y1: "hi",
				y2: "lo",
				series: "g",
				fill: "#abcdef",
			}),
		]);
		expect(handle.colorDomain()).toEqual([]);
		expect(
			regions(plain).filter((s) => s.fill === cssColor("#abcdef")),
		).toHaveLength(2);
	});
});

describe("series marks under animation", () => {
	it("scrubs the reveal and changes the samples with every frame drawn", () => {
		const layers: SceneNode[] = [
			density.create({ data: waits, x: "v", series: "line" }),
			ecdf.create({ data: waits, value: "v", series: "line" }),
		];
		const plot = chart.create({
			width: 8,
			height: 4,
			progress: 0,
			children: layers,
		});
		const scene = mount(plot);
		for (const p of [0.3, 0.6, 1, 0.5, 1]) {
			plot.set("progress", p);
			scene.commit();
		}
		for (const k of [1, 2, 3]) {
			const shifted = waits.map((d) => ({ ...d, v: d.v + k }));
			for (const layer of layers) layer.set("data" as never, shifted as never);
			scene.commit();
		}
		// Two density curves with their fills, two ECDF lines.
		expect(curveItems(scene.marks())).toHaveLength(6);
	});
});
