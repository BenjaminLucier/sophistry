/**
 * The chart families built on `chart` and its marks: candlesticks, the
 * waterfall and the funnel. (The annotated heatmap's case lives with the
 * grids family.)
 */

import type { MarksSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartHandle } from "../chart";
import { chart, chartHandle } from "../chart";
import { mount } from "../test-harness";
import { candlestick } from "./candlestick";
import { funnel } from "./funnel";
import { boxes } from "./test-helpers";
import { waterfall } from "./waterfall";

const days = [
	{ day: "Mon", o: 10, h: 12, l: 9, c: 11.5 },
	{ day: "Tue", o: 11.5, h: 13, l: 11, c: 11 },
];

/** The rect specs (bodies, bars, stages) among `marks`. */
const rectMarks = (marks: MarksSpec[]) =>
	marks.filter((spec) => spec.shape.kind === "rect");

describe("candlestick", () => {
	it("fits the price axis to lows and highs, without forcing zero", () => {
		const plot = chart.create({
			width: 6,
			height: 4,
			children: [
				candlestick.create({
					data: days,
					x: "day",
					open: "o",
					high: "h",
					low: "l",
					close: "c",
				}),
			],
		});
		mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		const [min, max] = handle.coords.yRange();
		expect(min).toBeGreaterThan(0);
		expect(min).toBeLessThanOrEqual(9);
		expect(max).toBeGreaterThanOrEqual(13);
		expect(handle.xBand?.domain).toEqual(["Mon", "Tue"]);
	});

	it("colours by direction and draws the body from open to close", () => {
		const plot = chart.create({
			width: 6,
			height: 4,
			yRange: [8, 14],
			axis: { visible: false },
			children: [
				candlestick.create({
					data: days,
					x: "day",
					open: "o",
					high: "h",
					low: "l",
					close: "c",
					upColor: "#00ff00",
					downColor: "#ff0000",
				}),
			],
		});
		const scene = mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		// Bodies are the rect items; a per-item fill opacity is folded into the
		// fill's alpha (up candles light, down solid).
		const bodies = boxes(rectMarks(scene.marks()));
		expect(bodies).toHaveLength(2);
		expect(bodies[0]?.fill).not.toBe(bodies[1]?.fill);
		const up = bodies[0];
		expect(up?.minY).toBeCloseTo(handle.coords.coordsToPoint(0, 10).y);
		expect(up?.maxY).toBeCloseTo(handle.coords.coordsToPoint(0, 11.5).y);
	});
});

describe("waterfall", () => {
	it("floats the steps, totals stand on zero, labels are signed", () => {
		const scene = mount(
			waterfall.create({
				data: [
					{ n: "Start", v: 100 },
					{ n: "Cost", v: -30 },
					{ n: "End", v: 0, total: true },
				],
				value: "v",
				label: "n",
				total: (d: { total?: boolean }) => d.total === true,
				width: 6,
				height: 4,
				upColor: "#00ff00",
				downColor: "#ff0000",
				totalColor: "#0000ff",
			}),
		);
		expect(scene.texts().map((t) => t.text)).toEqual(
			expect.arrayContaining(["Start", "Cost", "End", "+100", "−30", "70"]),
		);
		const fills = boxes(rectMarks(scene.marks())).map((b) => b.fill);
		expect(fills).toEqual(["#00ff00", "#ff0000", "#0000ff"]);
	});
});

describe("funnel", () => {
	it("stacks stages top-down, centred, widths proportional to value", () => {
		const scene = mount(
			funnel.create({
				data: [
					{ s: "Visit", n: 100 },
					{ s: "Buy", n: 25 },
				],
				value: "n",
				label: "s",
				width: 8,
				height: 4,
				colors: ["#336699"],
				connectors: false,
			}),
		);
		const stages = boxes(rectMarks(scene.marks()));
		expect(stages).toHaveLength(2);
		const [top, bottom] = stages as [(typeof stages)[0], (typeof stages)[0]];
		expect(top.minY).toBeGreaterThan(bottom.maxY);
		expect((top.maxX - top.minX) / (bottom.maxX - bottom.minX)).toBeCloseTo(4);
		expect((top.minX + top.maxX) / 2).toBeCloseTo(
			(bottom.minX + bottom.maxX) / 2,
		);
		expect(scene.texts().map((t) => t.text)).toEqual(
			expect.arrayContaining(["Visit", "Buy", "25 · 25%"]),
		);
	});

	it("grows each stage out from the centre", () => {
		const scene = mount(
			funnel.create({
				data: [100],
				width: 8,
				height: 4,
				colors: ["#336699"],
				progress: 0.75,
				show: "none",
			}),
		);
		const [stage] = boxes(rectMarks(scene.marks()));
		// The data half is at 0.5: half the full width (8 units at value 100).
		expect((stage?.maxX ?? 0) - (stage?.minX ?? 0)).toBeCloseTo(4);
		expect(((stage?.minX ?? 0) + (stage?.maxX ?? 0)) / 2).toBeCloseTo(0);
	});
});
