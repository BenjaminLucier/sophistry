/**
 * `pairPlot` and `jointPlot`.
 */

import type { Range } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { chart, chartHandle } from "../chart";
import type { ChartFrame, ChartHandle } from "../frame/types";
import { scatter } from "../points/scatter";
import { mount, probe } from "../test-harness";
import { jointPlot } from "./joint-plot";
import type { PairPanel } from "./pair-plot";
import { pairPlot } from "./pair-plot";

const top = (range: Range) => Math.max(range[0], range[1]);
const area = (frame: ChartFrame) => frame.coords.area();
const width = (frame: ChartFrame) => area(frame).maxX - area(frame).minX;

/** An `offDiagonal` builder of scatters with probes; `frames()` in reading order. */
function probed(series?: string) {
	const seen: { at: number; seen: { frame: ChartFrame | null } }[] = [];
	const offDiagonal = (p: PairPanel<Record<string, unknown>>) => {
		const watcher = probe();
		seen.push({ at: p.row * 100 + p.column, seen: watcher.seen });
		return [
			scatter.create({ data: p.data, x: p.x, y: p.y, series } as never),
			watcher.node,
		];
	};
	const frames = () =>
		[...seen]
			.sort((a, b) => a.at - b.at)
			.map((s) => s.seen.frame as ChartFrame);
	return { offDiagonal, frames };
}

describe("pairPlot", () => {
	const flowers = [
		{ kind: "a", petal: 1.4, sepal: 5.1, width: 0.2 },
		{ kind: "a", petal: 1.3, sepal: 4.7, width: 0.3 },
		{ kind: "b", petal: 4.7, sepal: 7.0, width: 1.4 },
		{ kind: "b", petal: 4.5, sepal: 6.4, width: 1.5 },
		{ kind: "b", petal: 5.0, sepal: 6.9, width: 2.1 },
	];

	it("draws n × n panels sharing x down columns and y across rows", () => {
		const { offDiagonal, frames } = probed("kind");
		const scene = mount(
			pairPlot.create({
				data: flowers,
				variables: ["petal", "sepal", "width"],
				series: "kind",
				width: 6,
				height: 6,
				offDiagonal,
			} as never),
		);
		const panels = frames();
		expect(panels).toHaveLength(6);
		// Row 0: (0,1) and (0,2) share y.
		expect(panels[0]?.coords.yRange()).toEqual(panels[1]?.coords.yRange());
		// Column 0: (1,0) and (2,0) share x.
		expect(panels[2]?.coords.xRange()).toEqual(panels[4]?.coords.xRange());
		expect(area(panels[2] as ChartFrame).minX).toBeCloseTo(
			area(panels[4] as ChartFrame).minX,
		);
		// Every variable named twice: under its column and beside its row; one legend.
		const all = scene.texts().map((t) => t.text);
		for (const name of ["petal", "sepal", "width"])
			expect(all.filter((t) => t === name)).toHaveLength(2);
		expect(all.filter((t) => t === "a")).toHaveLength(1);
	});

	it("keeps only the lower triangle with corner, every row still fitted", () => {
		const { offDiagonal, frames } = probed();
		mount(
			pairPlot.create({
				data: flowers,
				variables: ["petal", "sepal", "width"],
				corner: true,
				width: 6,
				height: 6,
				offDiagonal,
			} as never),
		);
		const panels = frames();
		expect(panels).toHaveLength(3);
		// The last column has only its diagonal panel, yet the "width" row is fitted to width's data.
		expect(
			top((panels[1] as ChartFrame).coords.yRange()),
		).toBeGreaterThanOrEqual(2.1);
	});

	it('space="free" sizes each column and row by its variable\'s range', () => {
		const data = [
			{ kind: "a", petal: 1, sepal: 4, width: 0.2 },
			{ kind: "a", petal: 2, sepal: 5, width: 0.4 },
			{ kind: "b", petal: 5, sepal: 7, width: 1.4 },
			{ kind: "b", petal: 6, sepal: 8, width: 1.6 },
		];
		const { offDiagonal, frames } = probed();
		mount(
			pairPlot.create({
				data,
				variables: ["petal", "width"],
				width: 8,
				height: 8,
				space: "free",
				diag: false,
				offDiagonal,
			} as never),
		);
		const [upper, lower] = frames() as ChartFrame[];
		const spanX = (c: ChartFrame) =>
			Math.abs(c.coords.xRange()[1] - c.coords.xRange()[0]);
		expect(width(upper as ChartFrame) / spanX(upper as ChartFrame)).toBeCloseTo(
			width(lower as ChartFrame) / spanX(lower as ChartFrame),
			6,
		);
		expect(width(upper as ChartFrame)).toBeLessThan(width(lower as ChartFrame));
	});

	it("takes given widths and a top legend", () => {
		const { offDiagonal, frames } = probed("kind");
		const scene = mount(
			pairPlot.create({
				data: flowers,
				variables: ["petal", "sepal"],
				series: "kind",
				width: 8,
				height: 6,
				widths: [2, 1],
				legend: "top",
				diag: false,
				offDiagonal,
			} as never),
		);
		const [upper, lower] = frames() as ChartFrame[];
		expect(width(lower as ChartFrame) / width(upper as ChartFrame)).toBeCloseTo(
			2,
			6,
		);
		const at = (text: string) => scene.texts().find((t) => t.text === text)?.at;
		expect(at("a")?.y).toBeCloseTo(at("b")?.y as number, 9);
		expect(at("a")?.y).toBeGreaterThan(area(upper as ChartFrame).maxY);
		expect(area(upper as ChartFrame).maxX).toBeCloseTo(4, 6);
	});

	it("draws densities on the diagonal by default", () => {
		const scene = mount(
			pairPlot.create({
				data: flowers,
				variables: ["petal", "sepal"],
				width: 6,
				height: 6,
			} as never),
		);
		// Two scatters (one marks node each) and the densities.
		expect(scene.marks().length + scene.shapes().length).toBeGreaterThan(2);
	});
});

describe("jointPlot", () => {
	const points = Array.from({ length: 40 }, (_, i) => ({
		x: 2 + ((i * 7) % 13) / 4,
		y: 1 + ((i * 5) % 11) / 3,
		g: i % 3 === 0 ? "few" : "many",
	}));

	it("aligns the marginals with the scatter without widening its range", () => {
		const watcher = probe();
		const plain = chart.create({
			width: 6,
			height: 5,
			children: [scatter.create({ data: points, x: "x", y: "y" })],
		});
		mount(
			jointPlot.create({
				data: points,
				x: "x",
				y: "y",
				series: "g",
				width: 7,
				height: 6,
				children: [watcher.node],
			} as never),
			plain,
		);
		const main = watcher.seen.frame as ChartFrame;
		const handle = chartHandle(plain) as ChartHandle;
		expect(main.coords.xRange()).toEqual(handle.coords.xRange());
		expect(main.coords.yRange()).toEqual(handle.coords.yRange());
	});

	it("draws one legend and the axis titles", () => {
		const scene = mount(
			jointPlot.create({
				data: points,
				x: "x",
				y: "y",
				series: "g",
				width: 7,
				height: 6,
				xLabel: "x",
				yLabel: "y",
			} as never),
		);
		const all = scene.texts().map((t) => t.text);
		expect(all.filter((t) => t === "few")).toHaveLength(1);
		expect(all).toContain("x");
		expect(all).toContain("y");
	});

	it("draws histogram marginals on request", () => {
		const scene = mount(
			jointPlot.create({
				data: points,
				x: "x",
				y: "y",
				width: 7,
				height: 6,
				marginal: "histogram",
				binCount: 5,
			} as never),
		);
		// Two rects layers of five bins each.
		const rects = scene.marks().filter((s) => s.shape.kind === "rect");
		expect(rects.reduce((n, s) => n + s.count, 0)).toBe(10);
	});

	it("puts its legend in a row on top", () => {
		const data = [
			{ kind: "a", petal: 1, sepal: 4 },
			{ kind: "a", petal: 2, sepal: 5 },
			{ kind: "b", petal: 5, sepal: 7 },
			{ kind: "b", petal: 6, sepal: 8 },
		];
		const watcher = probe();
		const scene = mount(
			jointPlot.create({
				data,
				x: "petal",
				y: "sepal",
				series: "kind",
				width: 6,
				height: 5,
				legend: "top",
				title: "Flowers",
				children: [watcher.node],
			} as never),
		);
		const main = watcher.seen.frame as ChartFrame;
		const at = (text: string) => scene.texts().find((t) => t.text === text)?.at;
		expect(at("a")?.y).toBeCloseTo(at("b")?.y as number, 9);
		expect(at("a")?.y).toBeGreaterThan(area(main).maxY + 0.5);
		expect(at("Flowers")?.y).toBeGreaterThan(at("a")?.y as number);
		expect(at("a")?.x).toBeLessThan(0);
	});
});
