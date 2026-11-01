import { describe, expect, it } from "vitest";
import { bars } from "../bars/index.js";
import { chart, chartHandle } from "../chart.js";
import { secondaryY } from "../guides/index.js";
import { scatter } from "../points/index.js";
import { mount, probe } from "../test-harness.js";

const rows = [
	{ x: 1, y: 2, s: "a", c: "p" },
	{ x: 2, y: 5, s: "b", c: "q" },
	{ x: 4, y: 3, s: "a", c: "r" },
];

describe("chart smoke", () => {
	it("draws legend, grid, titles", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			grid: true,
			title: "T",
			xLabel: "X",
			yLabel: "Y",
			legendTitle: "S",
			children: [scatter.create({ data: rows, x: "x", y: "y", series: "s" })],
		});
		const view = mount(plot);
		const texts = view.texts().map((t) => t.text);
		expect(texts).toContain("T");
		expect(texts).toContain("S");
		expect(texts).toContain("a");
		expect(texts).toContain("b");
		expect(view.shapes().length).toBeGreaterThan(10);
		expect(chartHandle(plot)?.colorDomain()).toEqual(["a", "b"]);
	});
	it("band axis from categories", () => {
		const { node, seen } = probe();
		const plot = chart.create({
			width: 8,
			height: 4,
			children: [bars.create({ data: rows, category: "c", value: "y" }), node],
		});
		const view = mount(plot);
		expect(seen.frame?.xBand?.domain).toEqual(["p", "q", "r"]);
		expect(view.texts().map((t) => t.text)).toEqual(
			expect.arrayContaining(["p", "q", "r"]),
		);
	});
	it("secondary y", () => {
		const { node, seen } = probe();
		const plot = chart.create({
			width: 8,
			height: 4,
			y2Label: "Y2",
			children: [
				scatter.create({ data: rows, x: "x", y: "y" }),
				secondaryY.create({
					children: [
						scatter.create({
							data: rows.map((r) => ({ ...r, y: r.y * 100 })),
							x: "x",
							y: "y",
						}),
						node,
					],
				}),
			],
		});
		const view = mount(plot);
		expect(seen.coords?.yRange()[1]).toBeGreaterThanOrEqual(500);
		expect(chartHandle(plot)?.coords.yRange()[1]).toBeLessThan(10);
		expect(view.texts().map((t) => t.text)).toContain("Y2");
	});
});
