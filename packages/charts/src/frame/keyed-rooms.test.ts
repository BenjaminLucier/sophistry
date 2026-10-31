/**
 * The room a chart reserves for its guides across a keyed transition: the
 * colour legend (whose entries come and go) and a right-hand y axis (whose
 * numbers widen or narrow as its fitted range rescales) are measured at
 * each end and blended, as the size key's room is, so the chart at
 * `blend = 0` and `1` is each end's plain chart: the plotting area, every
 * label and every marker. Plus a scrub that re-measures nothing (a spy on the frame's legend
 * measurement).
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it, vi } from "vitest";
import { chart, chartHandle } from "../chart";
import * as legendModule from "../guides/legend";
import { scatter } from "../points/scatter";
import { markItems, mount } from "../test-harness";
import type { ChartProps } from "./types";

vi.mock("../guides/legend", async (original) => {
	const actual = await original<typeof import("../guides/legend")>();
	return { ...actual, measureLegend: vi.fn(actual.measureLegend) };
});

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;
const Z = 7;

const start = [
	{ id: "a", x: 1, y: 1, region: "n" },
	{ id: "b", x: 2, y: 2, region: "s" },
	{ id: "c", x: 3, y: 3, region: "n" },
];
// A new, long series name and a far wider range of y.
const end = [
	{ id: "a", x: 1, y: 1200, region: "n" },
	{ id: "b", x: 2, y: 25000, region: "south-south-west" },
	{ id: "d", x: 4, y: 41000, region: "south-south-west" },
];
type Row = (typeof start)[number];

const build = (
	blend: number,
	data: Row[],
	to: Row[] | undefined,
	extra: Partial<ChartProps> = {},
) =>
	chart.create({
		width: 8,
		height: 4,
		...extra,
		children: [
			scatter.create({
				zIndex: Z,
				data,
				to,
				blend,
				key: "id",
				x: "x",
				y: "y",
				series: "region",
			}),
		],
	});
const snapshot = (node: SceneNode) => {
	const scene = mount(node);
	return {
		area: chartHandle(node)?.coords.area(),
		labels: scene
			.texts()
			.map((s) => ({
				text: s.text,
				x: rounded(s.at.x),
				y: rounded(s.at.y),
				opacity: rounded(s.style.opacity),
			}))
			.sort((p, q) => p.text.localeCompare(q.text) || p.x - q.x || p.y - q.y),
		markers: scene
			.marks()
			.filter((spec) => spec.zIndex === Z)
			.flatMap((spec) =>
				markItems(spec)
					.filter((item) => item.alpha > 0)
					.map((item) => ({
						x: rounded(item.center.x),
						y: rounded(item.center.y),
						r: rounded(item.radius),
					})),
			)
			.sort((p, q) => p.x - q.x || p.y - q.y),
	};
};
const width = (area: { minX: number; maxX: number } | undefined) =>
	area ? area.maxX - area.minX : Number.NaN;

describe("guide room across a keyed transition", () => {
	const variants: [string, Partial<ChartProps>][] = [
		["a legend on the right", {}],
		[
			"a legend on top, under autosize contain",
			{ legend: "top", autosize: "contain" },
		],
		["a right y axis", { yAxis: { position: "right" } }],
		[
			"a right y axis and a titled x axis",
			{ yAxis: { position: "right" }, xLabel: "x" },
		],
	];
	for (const [name, extra] of variants) {
		it(`${name}: exactly each end's plain chart at blend 0 and 1`, () => {
			expect(snapshot(build(0, start, end, extra))).toEqual(
				snapshot(build(0, start, undefined, extra)),
			);
			expect(snapshot(build(1, start, end, extra))).toEqual(
				snapshot(build(0, end, undefined, extra)),
			);
		});
	}

	it("an end listing no entry reserves no legend gap: each end's plain chart", () => {
		for (const extra of [
			{},
			{ legendTitle: "region" },
			{ legend: "top" as const, autosize: "contain" as const },
		]) {
			// Nothing at the start, a legend at the end; and the reverse.
			expect(snapshot(build(0, [], start, extra))).toEqual(
				snapshot(build(0, [], undefined, extra)),
			);
			expect(snapshot(build(1, [], start, extra))).toEqual(
				snapshot(build(0, start, undefined, extra)),
			);
			expect(snapshot(build(1, start, [], extra))).toEqual(
				snapshot(build(0, [], undefined, extra)),
			);
		}
		// The plot narrows by the gap and the legend together, on the update
		// stage (the first half here: the join only enters).
		const bare = width(snapshot(build(0, [], undefined)).area);
		const mid = width(snapshot(build(0.25, [], start)).area);
		const full = width(snapshot(build(0, start, undefined)).area);
		expect(mid).toBeLessThan(bare);
		expect(mid).toBeGreaterThan(full);
	});

	it("blends the plotting area between the two ends' widths", () => {
		for (const extra of [{}, { yAxis: { position: "right" as const } }]) {
			const a = width(snapshot(build(0, start, undefined, extra)).area);
			const b = width(snapshot(build(0, end, undefined, extra)).area);
			const mid = width(snapshot(build(0.5, start, end, extra)).area);
			// The far end's guides are wider: its plot is narrower.
			expect(b).toBeLessThan(a);
			expect(mid).toBeLessThanOrEqual(a);
			expect(mid).toBeGreaterThanOrEqual(b);
		}
	});

	it("scrubs without re-measuring either end", () => {
		const layers = [
			scatter.create({
				data: start,
				to: end,
				blend: 0,
				key: "id",
				x: "x",
				y: "y",
				series: "region",
			}),
			scatter.create({
				data: start,
				to: end,
				blend: 0,
				key: "id",
				x: "x",
				y: "y",
				series: "region",
			}),
		];
		const charts = [
			chart.create({ width: 8, height: 4, children: [layers[0] as SceneNode] }),
			chart.create({
				width: 8,
				height: 4,
				legend: "top",
				children: [layers[1] as SceneNode],
			}),
		];
		const scene = mount(...charts);
		const measure = vi.mocked(legendModule.measureLegend);
		expect(measure).toHaveBeenCalled();
		measure.mockClear();
		const areas: number[] = [];
		for (const t of [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.65, 0, 1]) {
			for (const layer of layers) layer.set("blend", t);
			scene.commit();
			areas.push(width(chartHandle(charts[0] as SceneNode)?.coords.area()));
		}
		// Each end's entries and their layouts are measured once per
		// transition: the frames of a scrub only mix them.
		expect(measure).not.toHaveBeenCalled();
		// ... and the room does follow the blend.
		expect(new Set(areas).size).toBeGreaterThan(1);
	});
});
