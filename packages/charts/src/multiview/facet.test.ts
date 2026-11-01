/**
 * `facet`: panels per category, shared and independent scales, wrap, row × column
 * grids, titles, one legend, the reveal and its stagger, keyed transitions,
 * unequal panel sizes and `space="free"`.
 *
 * Each panel's frame is read through a probe among its layers.
 */

import { track } from "@sophistry/core";
import type { Range } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import type { ChartFrame } from "../frame/types.js";
import { scatter } from "../points/scatter.js";
import { mount, probe } from "../test-harness.js";
import type { FacetPanel, FacetProps } from "./facet.js";
import { facet } from "./facet.js";

/** A range's upper end. */
const top = (range: Range) => Math.max(range[0], range[1]);

const rows = [
	{ site: "A", year: "y1", temp: 1, rain: 10 },
	{ site: "A", year: "y2", temp: 3, rain: 30 },
	{ site: "B", year: "y1", temp: 5, rain: 20 },
	{ site: "B", year: "y2", temp: 9, rain: 80 },
	{ site: "C", year: "y1", temp: 2, rain: 15 },
];
type Row = (typeof rows)[number];

/**
 * A facet of scatters with a probe per panel; `frames()` lists the panels'
 * frames in reading order.
 */
function scatterFacet(
	props: Partial<FacetProps<Row>> & { data?: readonly Row[] },
	layer: (panel: FacetPanel<Row>) => Record<string, unknown> = () => ({}),
) {
	const probes: { index: number; seen: { frame: ChartFrame | null } }[] = [];
	const node = facet.create({
		data: rows,
		width: 9,
		height: 3,
		...props,
		panel: (panel: FacetPanel<Row>) => {
			const watcher = probe();
			probes.push({ index: panel.index, seen: watcher.seen });
			return [
				scatter.create({
					data: panel.data,
					x: "temp",
					y: "rain",
					...layer(panel),
				} as never),
				watcher.node,
			];
		},
	} as never);
	const frames = () =>
		[...probes]
			.sort((a, b) => a.index - b.index)
			.map((p) => p.seen.frame as ChartFrame);
	return { node, frames };
}

const area = (frame: ChartFrame) => frame.coords.area();
const width = (frame: ChartFrame) => area(frame).maxX - area(frame).minX;
const height = (frame: ChartFrame) => area(frame).maxY - area(frame).minY;

describe("facet", () => {
	it("draws one panel per category, in a row, left to right inside the footprint", () => {
		const { node, frames } = scatterFacet({ column: "site" });
		const scene = mount(node);
		const panels = frames();
		expect(panels).toHaveLength(3);
		// One marks node per panel, five markers in all.
		expect(scene.marks().reduce((n, spec) => n + spec.count, 0)).toBe(
			rows.length,
		);
		const areas = panels.map(area);
		expect(areas[0]?.maxX).toBeLessThan(areas[1]?.minX as number);
		expect(areas[1]?.maxX).toBeLessThan(areas[2]?.minX as number);
		expect(width(panels[0] as ChartFrame)).toBeCloseTo(
			width(panels[2] as ChartFrame),
		);
		expect(areas[0]?.minX).toBeCloseTo(-4.5);
		expect(areas[2]?.maxX).toBeCloseTo(4.5);
	});

	it("titles each panel by its category", () => {
		const { node } = scatterFacet({ column: "site" });
		const scene = mount(node);
		const all = scene.texts().map((t) => t.text);
		for (const site of ["A", "B", "C"]) expect(all).toContain(site);
	});

	it("shares scales by default: the union", () => {
		const { node, frames } = scatterFacet({ column: "site" });
		mount(node);
		const ranges = frames().map((p) => p.coords.yRange());
		expect(ranges[0]).toEqual(ranges[1]);
		expect(ranges[0]).toEqual(ranges[2]);
		// The union: B's 80 is in A's range.
		expect(top(ranges[0] as Range)).toBeGreaterThanOrEqual(80);
	});

	it("labels only the outer panels' shared axes", () => {
		const { node } = scatterFacet({ column: "site" });
		const scene = mount(node);
		expect(scene.texts().filter((t) => t.text === "80")).toHaveLength(1);
	});

	it("fits each panel alone with independent scales", () => {
		const { node, frames } = scatterFacet({
			column: "site",
			scales: "independent",
		});
		mount(node);
		const tops = frames().map((p) => top(p.coords.yRange()));
		expect(tops[0]).toBeLessThan(tops[1] as number);
	});

	it("leaves independent numbers room between panels", () => {
		const { node, frames } = scatterFacet({
			column: "site",
			scales: "independent",
		});
		mount(node);
		const [a, b] = frames().map(area);
		expect((b?.minX as number) - (a?.maxX as number)).toBeGreaterThan(0.5);
	});

	it("wraps one variable onto several rows", () => {
		const { node, frames } = scatterFacet({
			column: "site",
			wrap: 2,
			width: 8,
			height: 6,
		});
		mount(node);
		const panels = frames();
		expect(panels).toHaveLength(3);
		const [a, b, c] = panels.map(area);
		expect(a?.minY).toBeGreaterThan(c?.maxY as number);
		expect(b?.minY).toBeGreaterThan(c?.maxY as number);
		expect(c?.minX).toBeCloseTo(a?.minX as number);
	});

	it("lays a row × col grid", () => {
		const { node, frames } = scatterFacet({
			row: "year",
			column: "site",
			height: 6,
		});
		mount(node);
		expect(frames()).toHaveLength(6);
	});

	it("titles the rows in the right margin and the columns over the top row", () => {
		const { node, frames } = scatterFacet({
			row: "year",
			column: "site",
			height: 6,
		});
		const scene = mount(node);
		const panels = frames();
		const text = scene.texts();
		const all = text.map((s) => s.text);
		// No "row · col" titles; each category written once.
		expect(all.some((t) => t.includes("·"))).toBe(false);
		for (const key of ["y1", "y2", "A", "B", "C"])
			expect(all.filter((t) => t === key)).toHaveLength(1);
		const right = Math.max(...panels.map((p) => area(p).maxX));
		for (const [row, key] of ["y1", "y2"].entries()) {
			const title = text.find((s) => s.text === key);
			const box = area(panels[row * 3 + 2] as ChartFrame);
			// Beside the last column of its row, centred on it, reading downward.
			expect(title?.at.x).toBeGreaterThan(right);
			expect(title?.at.y).toBeCloseTo((box.minY + box.maxY) / 2, 9);
			expect(title?.rotation).toBeCloseTo(-Math.PI / 2, 9);
		}
	});

	it("titles every panel row · column without margin titles", () => {
		const { node } = scatterFacet({
			row: "year",
			column: "site",
			height: 6,
			marginTitles: false,
		});
		const scene = mount(node);
		expect(scene.texts().map((t) => t.text)).toContain("y1 · A");
	});

	it("titles each panel unrotated when wrap folds the rows", () => {
		const { node } = scatterFacet({ row: "site", wrap: 2, height: 6 });
		const scene = mount(node);
		const titles = scene
			.texts()
			.filter((s) => ["A", "B", "C"].includes(s.text));
		expect(titles).toHaveLength(3);
		expect(titles.every((s) => s.rotation === 0)).toBe(true);
	});

	it("keeps one colour per series across panels and draws one legend", () => {
		const { node } = scatterFacet({ column: "site" }, () => ({
			series: "year",
		}));
		const scene = mount(node);
		const all = scene.texts().map((t) => t.text);
		expect(all.filter((t) => t === "y1")).toHaveLength(1);
		expect(all.filter((t) => t === "y2")).toHaveLength(1);
		const fills = new Set<string>();
		for (const spec of scene.marks()) {
			if (spec.shape.kind !== "circle") continue;
			for (let i = 0; i < spec.count; i++)
				fills.add(
					typeof spec.fills === "string" ? spec.fills : String(spec.fills[i]),
				);
		}
		// Two series over five markers in three panels: two colours.
		expect(fills.size).toBe(2);
	});

	it("reveals every panel's frame, then the data", () => {
		const { node, frames } = scatterFacet(
			{ column: "site", progress: 0.3 },
			() => ({
				series: "year",
			}),
		);
		const scene = mount(node);
		// Frames first, together; no data.
		for (const panel of frames()) {
			expect(panel.frameProgress).toBeGreaterThan(0.5);
			expect(panel.dataProgress).toBe(0);
		}
		node.set("progress" as never, 0.85 as never);
		scene.commit();
		for (const panel of frames())
			expect(panel.dataProgress).toBeGreaterThan(0.5);
		node.set("progress" as never, 1 as never);
		scene.commit();
		for (const panel of frames()) expect(panel.dataProgress).toBe(1);
	});

	it("staggers panels' data in reading order", () => {
		const { node, frames } = scatterFacet({
			column: "site",
			progress: 0.7,
			stagger: 0.6,
			legend: false,
		});
		mount(node);
		const data = frames().map((p) => p.dataProgress);
		expect(data[0]).toBeGreaterThan(data[1] as number);
		expect(data[1]).toBeGreaterThan(data[2] as number);
	});

	it("hands each panel its rows of `to` for a keyed transition, sharing the blended domain", () => {
		const blend = track(0);
		const next = rows.map((d) => ({ ...d, rain: d.rain * 2 }));
		const { node, frames } = scatterFacet(
			{ column: "site", to: next },
			(panel) => ({ to: panel.to, blend, key: "year" }),
		);
		const scene = mount(node);
		const start = top((frames()[0] as ChartFrame).coords.yRange());
		blend.set(1);
		scene.commit();
		expect(top((frames()[0] as ChartFrame).coords.yRange())).toBeGreaterThan(
			start,
		);
		expect((frames()[1] as ChartFrame).coords.yRange()).toEqual(
			(frames()[0] as ChartFrame).coords.yRange(),
		);
	});

	it("rebuilds a panel's layers when its rows change, and drops a panel whose category went", () => {
		const { node, frames } = scatterFacet({ column: "site" });
		const scene = mount(node);
		expect(frames()).toHaveLength(3);
		node.set("data" as never, rows.filter((r) => r.site !== "C") as never);
		scene.commit();
		expect(scene.marks().reduce((n, spec) => n + spec.count, 0)).toBe(4);
		const live = scene.marks().length;
		expect(live).toBe(2);
	});
});

describe("facet panel sizes", () => {
	const points = rows.slice(0, 4);

	it("sizes columns and rows by the given ratios", () => {
		const { node, frames } = scatterFacet({
			data: points,
			row: "year",
			column: "site",
			height: 6,
			widths: [2, 1],
			heights: [1, 3],
		});
		mount(node);
		const panels = frames() as ChartFrame[];
		expect(panels).toHaveLength(4);
		expect(
			width(panels[0] as ChartFrame) / width(panels[1] as ChartFrame),
		).toBeCloseTo(2, 6);
		expect(
			height(panels[2] as ChartFrame) / height(panels[0] as ChartFrame),
		).toBeCloseTo(3, 6);
		// Columns stay aligned down the grid.
		expect(area(panels[0] as ChartFrame).minX).toBeCloseTo(
			area(panels[2] as ChartFrame).minX,
			9,
		);
	});

	it("free space on a continuous axis follows each panel's span", () => {
		const { node, frames } = scatterFacet({
			data: points,
			column: "site",
			scales: { x: "independent" },
			space: { x: "free" },
		});
		mount(node);
		const span = (frame: ChartFrame) => {
			const [lo, hi] = frame.coords.xRange();
			return Math.abs(hi - lo);
		};
		const [a, b] = frames() as ChartFrame[];
		// One unit of temperature is as long in both panels.
		expect(width(a as ChartFrame) / span(a as ChartFrame)).toBeCloseTo(
			width(b as ChartFrame) / span(b as ChartFrame),
			6,
		);
	});

	it("given widths win over space", () => {
		const { node, frames } = scatterFacet({
			data: points,
			column: "site",
			scales: "independent",
			space: "free",
			widths: [1, 1],
		});
		mount(node);
		const [a, b] = frames() as ChartFrame[];
		expect(width(a as ChartFrame)).toBeCloseTo(width(b as ChartFrame), 6);
	});
});

describe("facet scales shared within a column or row", () => {
	const grid = [
		{ site: "A", year: "y1", temp: 1, rain: 10 },
		{ site: "A", year: "y2", temp: 3, rain: 30 },
		{ site: "B", year: "y1", temp: 5, rain: 20 },
		{ site: "B", year: "y2", temp: 19, rain: 400 },
		{ site: "B", year: "y1", temp: 7, rain: 25 },
	];
	const make = (props: Partial<FacetProps<Row>>) => {
		const built = scatterFacet({
			data: grid,
			row: "year",
			column: "site",
			height: 6,
			...props,
		});
		mount(built.node);
		return built.frames();
	};
	const xRange = (frame: ChartFrame | undefined) =>
		(frame as ChartFrame).coords.xRange().slice(0, 2);
	const yRange = (frame: ChartFrame | undefined) =>
		(frame as ChartFrame).coords.yRange().slice(0, 2);

	it('{ x: "column" } shares x down each column, the columns independent', () => {
		const panels = make({ scales: { x: "column" } });
		// Row-major: (y1, A), (y1, B), (y2, A), (y2, B).
		expect(xRange(panels[0])).toEqual(xRange(panels[2]));
		expect(xRange(panels[1])).toEqual(xRange(panels[3]));
		expect(xRange(panels[0])).not.toEqual(xRange(panels[1]));
		// y stays shared across the grid.
		expect(yRange(panels[0])).toEqual(yRange(panels[3]));
	});

	it('{ y: "row" } shares y along each row', () => {
		const panels = make({ scales: { y: "row" } });
		expect(yRange(panels[0])).toEqual(yRange(panels[1]));
		expect(yRange(panels[2])).toEqual(yRange(panels[3]));
		expect(yRange(panels[0])).not.toEqual(yRange(panels[2]));
		expect(xRange(panels[0])).toEqual(xRange(panels[3]));
	});

	it('with space="free", each column is exactly as wide as its own range', () => {
		const panels = make({ scales: { x: "column", y: "row" }, space: "free" });
		const span = (range: readonly (number | undefined)[]) =>
			Math.abs((range[1] ?? 0) - (range[0] ?? 0));
		const unitX = (frame: ChartFrame | undefined) =>
			width(frame as ChartFrame) / span(xRange(frame));
		const unitY = (frame: ChartFrame | undefined) =>
			height(frame as ChartFrame) / span(yRange(frame));
		expect(unitX(panels[0])).toBeCloseTo(unitX(panels[3]), 6);
		expect(unitX(panels[1])).toBeCloseTo(unitX(panels[2]), 6);
		expect(unitY(panels[0])).toBeCloseTo(unitY(panels[3]), 6);
	});
});

describe("facet under a keyed transition", () => {
	it("scrubs the blend without rebuilding a panel or re-laying the grid out", () => {
		// Per frame of the blend, no panel's layers are
		// rebuilt and (with fixed `widths`) every panel keeps its place.
		const blend = track(0);
		const later = rows.map((d) => ({ ...d, rain: d.rain * 1.5 }));
		let built = 0;
		const watchers: { seen: { frame: ChartFrame | null } }[] = [];
		const node = facet.create({
			data: rows,
			to: later,
			column: "site",
			width: 9,
			height: 3,
			widths: [2, 1, 1],
			legend: "top",
			panel: (panel: FacetPanel<Row>) => {
				built++;
				const watcher = probe();
				watchers.push(watcher);
				return [
					scatter.create({
						data: panel.data,
						to: panel.to,
						blend,
						key: "year",
						x: "temp",
						y: "rain",
						series: "year",
					} as never),
					watcher.node,
				];
			},
		} as never);
		const scene = mount(node);
		const areas = () =>
			watchers.map((w) => (w.seen.frame as ChartFrame).coords.area().minX);
		const before = areas();
		const builtBefore = built;
		for (const t of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.4, 0]) {
			blend.set(t);
			scene.commit();
			// The panels blend together.
			const frames = watchers.map((w) => w.seen.frame as ChartFrame);
			expect(frames[1]?.coords.yRange()).toEqual(frames[0]?.coords.yRange());
		}
		expect(built).toBe(builtBefore);
		expect(areas()).toEqual(before);
	});
});
