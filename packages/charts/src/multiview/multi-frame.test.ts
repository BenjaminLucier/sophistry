/**
 * The frame features multi-view charts stand on: a second scale per axis, room a layer
 * reserves beside the plot (reserved margins), `autosize="contain"`, and
 * guides fitted inside the footprint.
 */

import type { CompositeContext } from "@sophistry/core";
import { defineComposite, track } from "@sophistry/core";
import type { Range } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { bars } from "../bars/bars";
import { chart, chartHandle } from "../chart";
import { chartLayer } from "../context";
import { linePlot } from "../curves/line-plot";
import { secondaryX, secondaryY } from "../frame/secondary-axes";
import type { ChartFrame, ChartHandle, ChartMargin } from "../frame/types";
import { mount, probe } from "../test-harness";

const top = (range: Range) => Math.max(range[0], range[1]);
const handle = (node: Parameters<typeof chartHandle>[0]) =>
	chartHandle(node) as ChartHandle;

describe("secondaryY", () => {
	it("maps its layers through a second y scale on the right", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			y2Label: "°C",
			children: [
				linePlot.create({
					data: [
						{ x: 0, y: 100 },
						{ x: 4, y: 900 },
					],
					x: "x",
					y: "y",
				} as never),
				secondaryY.create({
					children: [
						linePlot.create({
							data: [
								{ x: 0, y: 2 },
								{ x: 4, y: 7 },
							],
							x: "x",
							y: "y",
						} as never),
					],
				} as never),
			],
		});
		const scene = mount(plot);
		const coords = handle(plot).coords;
		// The primary axis fits the primary layer only.
		expect(top(coords.yRange())).toBeGreaterThanOrEqual(900);
		expect(scene.texts().map((t) => t.text)).toContain("°C");
		// The secondary axis writes its own numbers, right of the plot.
		const right = scene
			.texts()
			.filter((s) => /^\d+$/.test(s.text) && s.at.x > coords.area().maxX);
		expect(right.length).toBeGreaterThan(1);
		expect(right.every((s) => Number(s.text) <= 10)).toBe(true);
	});

	it("makes room for the secondary axis's numbers inside width", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			children: [
				linePlot.create({ data: [1, 2, 3] } as never),
				secondaryY.create({
					children: [linePlot.create({ data: [1000, 3000, 2000] } as never)],
				} as never),
			],
		});
		mount(plot);
		const box = handle(plot).coords.area();
		expect(box.minX).toBeCloseTo(-4);
		expect(box.maxX).toBeLessThan(3.6);
	});

	it("throws outside a chart", () => {
		expect(() => mount(secondaryY.create({} as never))).toThrow(
			/inside a chart/,
		);
	});

	it("blends its fitted range under a keyed transition, the primary untouched", () => {
		const blend = track(0);
		const inner = probe();
		const outer = probe();
		const plot = chart.create({
			width: 8,
			height: 4,
			children: [
				linePlot.create({ data: [1, 2, 3] } as never),
				secondaryY.create({
					children: [
						linePlot.create({
							data: [1, 2, 3],
							to: [10, 40, 30],
							blend,
						} as never),
						inner.node,
					],
				} as never),
				outer.node,
			],
		});
		const scene = mount(plot);
		const secondary = () => inner.seen.frame as ChartFrame;
		const start = top(secondary().coords.yRange());
		blend.set(1);
		scene.commit();
		expect(top(secondary().coords.yRange())).toBeGreaterThanOrEqual(40);
		expect(start).toBeLessThan(10);
		expect(top((outer.seen.frame as ChartFrame).coords.yRange())).toBeLessThan(
			10,
		);
	});
});

describe("secondaryX", () => {
	const low = [
		{ x: 0, y: 1 },
		{ x: 10, y: 4 },
	];
	const high = [
		{ x: 100, y: 2 },
		{ x: 900, y: 3 },
	];

	it("maps its layers through a second x scale along the top", () => {
		const inner = probe();
		const plot = chart.create({
			width: 8,
			height: 4,
			x2Label: "km",
			children: [
				linePlot.create({ data: low, x: "x", y: "y" } as never),
				secondaryX.create({
					children: [
						linePlot.create({ data: high, x: "x", y: "y" } as never),
						inner.node,
					],
				} as never),
			],
		});
		const scene = mount(plot);
		const coords = handle(plot).coords;
		const secondary = inner.seen.frame as ChartFrame;
		expect(top(coords.xRange())).toBeLessThanOrEqual(10);
		expect(top(secondary.coords.xRange())).toBeGreaterThanOrEqual(900);
		// y is shared.
		expect(secondary.coords.yRange()).toEqual(coords.yRange());
		const box = coords.area();
		const above = scene
			.texts()
			.filter((s) => /^\d+$/.test(s.text) && s.at.y > box.maxY);
		expect(above.length).toBeGreaterThan(1);
		expect(above.every((s) => Number(s.text) % 100 === 0)).toBe(true);
		const title = scene.texts().find((s) => s.text === "km");
		expect(title?.at.x).toBeGreaterThan(box.maxX);
	});

	it("nests with secondaryY for layers on both secondary axes", () => {
		const both = probe();
		const plot = chart.create({
			width: 8,
			height: 4,
			children: [
				linePlot.create({ data: low, x: "x", y: "y" } as never),
				secondaryY.create({
					children: [
						secondaryX.create({
							children: [
								linePlot.create({
									data: [
										{ x: 100, y: 200 },
										{ x: 900, y: 700 },
									],
									x: "x",
									y: "y",
								} as never),
								both.node,
							],
						} as never),
					],
				} as never),
			],
		});
		mount(plot);
		const frame = both.seen.frame as ChartFrame;
		expect(top(frame.coords.xRange())).toBeGreaterThanOrEqual(900);
		expect(top(frame.coords.yRange())).toBeGreaterThanOrEqual(700);
		expect(top(handle(plot).coords.xRange())).toBeLessThanOrEqual(10);
		expect(top(handle(plot).coords.yRange())).toBeLessThanOrEqual(10);
	});
});

/** A layer that reserves `margin` beside the plot. */
const reserve = defineComposite<{ margin: ChartMargin }>({
	name: "Reserve",
	props: { margin: { default: {}, invalidates: 0 } },
	setup: (ctx: CompositeContext<{ margin: ChartMargin }>) => {
		chartLayer(ctx).report({ margin: ctx.props.margin });
		return [];
	},
});

describe("chart reserved margins", () => {
	it("keeps the title clear of a top margin and gives the layer its box", () => {
		const watcher = probe();
		const plain = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 1],
			yRange: [0, 1],
			title: "Plain",
		});
		const reserved = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 1],
			yRange: [0, 1],
			title: "Reserved",
			children: [
				reserve.create({ margin: { top: 1.2, right: 0.8 } }),
				watcher.node,
			],
		});
		const scene = mount(plain, reserved);
		const title = (text: string) =>
			scene.texts().find((s) => s.text === text)?.at.y ?? 0;
		const lift = title("Reserved") - title("Plain");
		const a = handle(plain).coords.area();
		const b = handle(reserved).coords.area();
		// The plot narrowed for the right margin, but stands at the same top.
		expect(b.maxY).toBeCloseTo(a.maxY);
		expect(lift).toBeCloseTo(1.2);
		// "fit" reserves the right margin inside width.
		expect(b.maxX).toBeCloseTo(a.maxX - 0.8);
		const frame = watcher.seen.frame as ChartFrame;
		const topBox = frame.marginBox("top");
		const rightBox = frame.marginBox("right");
		expect(topBox.minY).toBeCloseTo(b.maxY);
		expect(topBox.maxY - topBox.minY).toBeCloseTo(1.2);
		expect(rightBox.minX).toBeCloseTo(b.maxX);
		expect(rightBox.maxX - rightBox.minX).toBeCloseTo(0.8);
	});
});

describe('chart autosize="contain"', () => {
	const names = [
		{ q: "A rather long category name", v: 3 },
		{ q: "Short", v: 5 },
	];

	it("fits long category names, titles and numbers inside width × height", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			autosize: "contain",
			title: "Answers",
			xLabel: "count",
			children: [
				bars.create({
					data: names,
					category: "q",
					value: "v",
					orientation: "horizontal",
				} as never),
			],
		});
		const scene = mount(plot);
		const box = handle(plot).coords.area();
		expect(box.minX).toBeGreaterThan(-4 + 1);
		expect(box.maxY).toBeLessThan(2 - 0.4);
		expect(box.minY).toBeGreaterThan(-2 + 0.2);
		const title = scene.texts().find((s) => s.text === "Answers");
		expect(title?.at.y ?? 99).toBeLessThan(2);
	});

	it("leaves the default fit layout unchanged", () => {
		const plot = chart.create({
			width: 8,
			height: 4,
			title: "Answers",
			children: [
				bars.create({
					data: names,
					category: "q",
					value: "v",
					orientation: "horizontal",
				} as never),
			],
		});
		mount(plot);
		const box = handle(plot).coords.area();
		expect(box.minX).toBeCloseTo(-4);
		expect(box.maxY).toBeCloseTo(2);
	});
});

describe("multi-view under animation", () => {
	it("scrubs a facet, a link, a brush and a secondary axis without errors", async () => {
		const { facet } = await import("./facet");
		const { chartLink, rangeBrush } = await import("./chart-link");
		const { pairPlot } = await import("./pair-plot");
		const { jointPlot } = await import("./joint-plot");
		const { derive } = await import("@sophistry/core");
		const { scatter } = await import("../points/scatter");
		const rows = [
			{ site: "A", year: "y1", temp: 1, rain: 10 },
			{ site: "A", year: "y2", temp: 3, rain: 30 },
			{ site: "B", year: "y1", temp: 5, rain: 20 },
			{ site: "B", year: "y2", temp: 9, rain: 80 },
			{ site: "C", year: "y1", temp: 2, rain: 15 },
		];
		const p = track(0);
		const blend = track(0);
		const from = track(1);
		const to = track(3);
		const next = rows.map((d) => ({ ...d, rain: d.rain + 40 }));
		const scene = mount(
			facet.create({
				data: rows,
				to: next,
				column: "site",
				width: 9,
				height: 3,
				progress: p,
				stagger: 0.4,
				panel: (panel: { data: unknown[]; to: unknown[] | undefined }) => [
					scatter.create({
						data: panel.data,
						to: panel.to,
						blend,
						key: "year",
						x: "temp",
						y: "rain",
						series: "year",
					} as never),
				],
			} as never),
			chartLink.create({
				xRange: derive([from, to], (a, b) => [a, b] as [number, number]),
				children: [
					chart.create({
						width: 6,
						height: 2,
						progress: p,
						children: [
							linePlot.create({ data: [1, 4, 2, 5, 3] } as never),
							secondaryY.create({
								children: [
									linePlot.create({ data: [50, 10, 40, 20, 30] } as never),
								],
							} as never),
						],
					}),
				],
			}),
			chart.create({
				width: 6,
				height: 1,
				progress: p,
				children: [
					linePlot.create({ data: [1, 4, 2, 5, 3] } as never),
					rangeBrush.create({ from, to }),
				],
			}),
			pairPlot.create({
				data: rows,
				variables: ["temp", "rain"],
				series: "year",
				width: 5,
				height: 5,
				progress: p,
			} as never),
			jointPlot.create({
				data: rows,
				x: "temp",
				y: "rain",
				series: "year",
				width: 5,
				height: 5,
				progress: p,
			} as never),
		);
		for (const t of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.4, 1]) {
			p.set(t);
			scene.commit();
		}
		for (const t of [0.1, 0.3, 0.5, 0.7, 1, 0.5, 0]) {
			blend.set(t);
			from.set(1 + t);
			to.set(3 + t);
			scene.commit();
		}
		expect(scene.graph.frame.length).toBeGreaterThan(0);
	});
});
