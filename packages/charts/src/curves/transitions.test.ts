/**
 * Keyed transitions on `linePlot`: both ends are each end's plain chart, a
 * matched line morphs in data units on a shared x grid, a new line sweeps in
 * along x and a leaving one fades. Plus what the batch keeps across frames:
 * an unchanged line hands the batch the same item, and the shared nearest-x
 * tooltip gets the lines' points.
 */

import type { PathBatchItem } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import type { ChartHandle } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import { mount, probe } from "../test-harness.js";
import { tooltipContext } from "../tooltip.js";
import { linePlot } from "./line-plot.js";
import type { CurveItem } from "./test-items.js";
import { curveItems, rounded } from "./test-items.js";

const rows = [
	{ s: "p", x: 0, y: 1 },
	{ s: "p", x: 2, y: 1 },
	{ s: "q", x: 0, y: 5 },
	{ s: "q", x: 2, y: 5 },
];
const next = [
	{ s: "p", x: 0, y: 3 },
	{ s: "p", x: 1, y: 9 },
	{ s: "p", x: 2, y: 3 },
	{ s: "r", x: 0, y: 7 },
	{ s: "r", x: 2, y: 7 },
];

let handle!: ChartHandle;
function draw(
	blend: number | undefined,
	data: typeof rows,
	to: typeof rows | undefined,
): CurveItem[] {
	const plot = chart.create({
		width: 8,
		height: 4,
		xRange: [0, 2],
		yRange: [0, 10],
		legend: false,
		children: [
			linePlot.create({ data, to, blend, x: "x", y: "y", series: "s" }),
		],
	});
	const scene = mount(plot);
	handle = chartHandle(plot) as ChartHandle;
	return curveItems(scene.marks()).filter(
		(item) => item.points.length > 0 && item.opacity > 0,
	);
}
const drawn = (items: CurveItem[]) =>
	items
		.map((s) => s.points.map((p) => [rounded(p.x), rounded(p.y)]))
		.sort((a, b) => (a[0]?.[1] as number) - (b[0]?.[1] as number));

describe("keyed transitions on linePlot", () => {
	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		expect(drawn(draw(0, rows, next))).toEqual(
			drawn(draw(undefined, rows, undefined)),
		);
		expect(drawn(draw(1, rows, next))).toEqual(
			drawn(draw(undefined, next, undefined)),
		);
	});

	it("morphs a matched line in data units on a shared x grid", () => {
		const items = draw(0.5, rows, next);
		// Stages: exit (q), update, enter (r); the update's midpoint is 0.5.
		const p = items.find((s) =>
			s.points.some(
				(q) => Math.abs(q.y - handle.coords.coordsToPoint(0, 2).y) < 1e-6,
			),
		);
		expect(p).toBeDefined();
		const ys = (p as CurveItem).points.map((q) => rounded(q.y));
		const at = (y: number) => rounded(handle.coords.coordsToPoint(0, y).y);
		// x = 1 is on the new line only: the old one's y there is 1.
		expect(ys).toEqual([at(2), at(5), at(2)]);
	});

	it("sweeps a new line in along x and fades a leaving one", () => {
		const exiting = draw(1 / 6, rows, next);
		const q = exiting.find((s) =>
			s.points.every(
				(p) => Math.abs(p.y - handle.coords.coordsToPoint(0, 5).y) < 1e-6,
			),
		);
		expect(q?.opacity).toBeCloseTo(0.5);
		const entering = draw(5 / 6, rows, next);
		const r = entering.find((s) =>
			s.points.every(
				(p) => Math.abs(p.y - handle.coords.coordsToPoint(0, 7).y) < 1e-6,
			),
		);
		const xs = (r as CurveItem).points.map((p) => p.x);
		const left = handle.coords.coordsToPoint(0, 0).x;
		const right = handle.coords.coordsToPoint(2, 0).x;
		expect(Math.max(...xs)).toBeCloseTo(left + (right - left) * 0.5);
	});
});

describe("linePlot's batch across frames", () => {
	it("hands the batch the same item for a line that did not move", () => {
		const line = linePlot.create({
			data: rows,
			x: "x",
			y: "y",
			series: "s",
			progress: 0.99,
		});
		const plot = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 2],
			yRange: [0, 10],
			children: [line],
		});
		const scene = mount(plot);
		const batch = () =>
			(
				line.children[0] as unknown as {
					children: readonly { get(key: string): unknown }[];
				}
			).children[0] as { get(key: "items"): readonly PathBatchItem[] };
		line.set("progress", 1);
		scene.commit();
		const first = batch().get("items");
		line.set("opacity", 0.5);
		scene.commit();
		expect(batch().get("items")).toBe(first);
		// Only q moves: p keeps its item object.
		line.set(
			"data",
			rows.map((d) => (d.s === "q" ? { ...d, y: d.y + 1 } : d)),
		);
		scene.commit();
		const after = batch().get("items");
		expect(after).not.toBe(first);
		expect(after[0]).toBe(first[0]);
		expect(after[1]).not.toBe(first[1]);
	});

	it("offers every point to the chart's shared nearest-x tooltip, and withdraws them", () => {
		const line = linePlot.create({ data: rows, x: "x", y: "y", series: "s" });
		const { node: watcher } = probe();
		const plot = chart.create({
			width: 8,
			height: 4,
			tooltip: { mode: "x" },
			children: [line, watcher],
		});
		const scene = mount(plot);
		const tooltip = (
			watcher as unknown as { context<T>(key: unknown): T }
		).context(tooltipContext) as {
			points(): readonly { x: string; row: { name: string } }[];
		} | null;
		expect(tooltip?.points()).toHaveLength(4);
		expect(tooltip?.points().map((p) => p.row.name)).toEqual([
			"p",
			"p",
			"q",
			"q",
		]);
		plot.set("children", [watcher]);
		scene.commit();
		expect(tooltip?.points()).toHaveLength(0);
	});
});
