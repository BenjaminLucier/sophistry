/**
 * The frame's share of a chart's `progress`: the frame (axes, numbers,
 * titles) draws over the first half, the data over the rest, and a legend
 * or colour bar, when there is one, comes in last (the data phase then ends
 * at 0.9). `reveal="x"` draws every layer whole behind one front sweeping
 * across the plot instead. Covers the frame phase and the phase boundaries
 * (`FRAME_END`, `DATA_END_WITH_LEGEND`); the marks' own reveals are tested
 * with the marks (`curves/reveal.test.ts`, `bars/reveal.test.ts`, ...).
 */

import type { SceneNode } from "@sophistry/core";
import type { MarksSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartFrame, ChartHandle, ChartProps } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import { linePlot } from "../curves/line-plot.js";
import { scatter } from "../points/scatter.js";
import { markItems, mount, probe } from "../test-harness.js";

const rows = [
	{ x: 1, y: 2, s: "a" },
	{ x: 2, y: 3, s: "b" },
	{ x: 4, y: 8, s: "c" },
];

/** An 8 × 4 chart over fixed ranges, mounted, with its handle, the frame it provides, and its layer. */
function plot(props: Partial<ChartProps>, layer: SceneNode) {
	const { node: watcher, seen } = probe();
	const node = chart.create({
		width: 8,
		height: 4,
		xRange: [0, 5],
		yRange: [0, 10],
		title: "T",
		...props,
		children: [layer, watcher],
	});
	const view = mount(node);
	return Object.assign(view, {
		node,
		layer,
		handle: chartHandle(node) as ChartHandle,
		frame: () => seen.frame as ChartFrame,
	});
}

type Plot = ReturnType<typeof plot>;

/** The specs drawn by `node` or a node under it. */
function idsUnder(node: SceneNode): Set<number> {
	const ids = new Set<number>();
	const walk = (own: SceneNode) => {
		ids.add(own.id);
		for (const child of (own as { children?: readonly SceneNode[] }).children ??
			[])
			walk(child);
	};
	walk(node);
	return ids;
}
/** The frame's own specs: everything not drawn by the layer. */
const frameSpecs = (view: Plot) => {
	const layer = idsUnder(view.layer);
	return view.graph.frame.filter((spec) => !layer.has(spec.id));
};
/** The layer's batched items that paint something (an item's own reveal included). */
const drawnItems = (view: Plot) => {
	const layer = idsUnder(view.layer);
	return view
		.marks()
		.filter((spec) => layer.has(spec.id))
		.flatMap((spec: MarksSpec) =>
			markItems(spec).filter(
				(item, i) =>
					item.alpha *
						spec.style.opacity *
						spec.progress *
						(spec.progresses?.[i] ?? 1) >
						0 &&
					(item.radius > 0 || item.polylines.length > 0),
			),
		);
};
const legendNames = (view: Plot) =>
	view
		.texts()
		.filter((t) => ["a", "b", "c"].includes(t.text) && t.style.opacity > 0)
		.map((t) => t.text);
const dots = () => scatter.create({ data: rows, x: "x", y: "y" });
const seriesDots = () =>
	scatter.create({ data: rows, x: "x", y: "y", series: "s" });

describe("chart progress phases", () => {
	it("draws the frame over the first half, before any data", () => {
		const view = plot({ progress: 0.25 }, dots());
		expect(view.frame().frameProgress).toBeCloseTo(0.5);
		expect(view.frame().dataProgress).toBe(0);
		// The axes are half drawn; the title writes in with them.
		const strokes = frameSpecs(view).filter((s) => s.kind === "shape");
		expect(strokes.length).toBeGreaterThan(0);
		expect(strokes.some((s) => s.progress === 0.5)).toBe(true);
		expect(view.texts().find((t) => t.text === "T")?.progress).toBeCloseTo(0.5);
		expect(drawnItems(view)).toHaveLength(0);
	});

	it("draws the data over the second half, behind a finished frame", () => {
		const view = plot({ progress: 0.75 }, dots());
		expect(view.frame().frameProgress).toBe(1);
		expect(view.frame().dataProgress).toBeCloseTo(0.5);
		for (const spec of frameSpecs(view)) expect(spec.progress).toBe(1);
		expect(drawnItems(view)).toHaveLength(rows.length);
	});

	it("follows the chart's own progress: nothing until the frame has drawn", () => {
		const layer = linePlot.create({ data: [0, 9, 0, 9, 0, 1] });
		const view = plot({ progress: 0.5 }, layer);
		expect(drawnItems(view)).toHaveLength(0);
	});

	it("without a legend, the data phase runs to the end", () => {
		const view = plot({ progress: 0.95 }, dots());
		expect(view.frame().dataProgress).toBeCloseTo(0.9);
	});

	it("with a legend, the data phase ends at 0.9 and the legend comes in last", () => {
		const mid = plot({ progress: 0.7 }, seriesDots());
		expect(mid.frame().dataProgress).toBeCloseTo(0.5);
		expect(legendNames(mid)).toEqual([]);

		const late = plot({ progress: 0.95 }, seriesDots());
		expect(late.frame().dataProgress).toBe(1);
		// Entries come in one after another: some but not all are in.
		const some = legendNames(late);
		expect(some.length).toBeGreaterThan(0);
		expect(some.length).toBeLessThan(3);

		const done = plot({ progress: 1 }, seriesDots());
		expect(legendNames(done)).toEqual(["a", "b", "c"]);
	});

	it("moving progress on a mounted chart replays the phases", () => {
		const view = plot({ progress: 0 }, seriesDots());
		expect(drawnItems(view)).toHaveLength(0);
		view.node.set("progress", 0.75);
		view.commit();
		expect(view.frame().frameProgress).toBe(1);
		expect(drawnItems(view)).toHaveLength(rows.length);
		expect(legendNames(view)).toEqual([]);
		view.node.set("progress", 1);
		view.commit();
		expect(legendNames(view)).toEqual(["a", "b", "c"]);
	});
});

describe('chart reveal="x"', () => {
	it("hands the layers their whole data once the frame is drawn, behind a sweeping clip", () => {
		const early = plot({ progress: 0.4, reveal: "x" }, dots());
		expect(early.frame().dataProgress).toBe(0);
		expect(drawnItems(early)).toHaveLength(0);

		const mid = plot({ progress: 0.75, reveal: "x" }, dots());
		expect(mid.frame().dataProgress).toBe(1);
		const area = mid.handle.coords.area();
		const front = area.minX + (area.maxX - area.minX) * 0.5;
		const layerIds = idsUnder(mid.layer);
		const [spec] = mid.marks().filter((s) => layerIds.has(s.id));
		const region = spec?.clip?.[0]?.rings.flat() ?? [];
		expect(Math.max(...region.map((p) => p.x))).toBeCloseTo(front);
		// The frame is never clipped.
		for (const own of frameSpecs(mid)) expect(own.clip).toBeUndefined();

		const done = plot({ progress: 1, reveal: "x" }, dots());
		const doneIds = idsUnder(done.layer);
		for (const own of done.marks().filter((s) => doneIds.has(s.id)))
			expect(own.clip).toBeUndefined();
	});

	it("the front moves at a constant rate across the data phase", () => {
		const fronts = [0.6, 0.7, 0.8, 0.9].map((progress) => {
			const view = plot({ progress, reveal: "x" }, dots());
			const ids = idsUnder(view.layer);
			const [spec] = view.marks().filter((s) => ids.has(s.id));
			const region = spec?.clip?.[0]?.rings.flat() ?? [];
			return Math.max(...region.map((p) => p.x));
		});
		const steps = fronts.slice(1).map((f, i) => f - (fronts[i] as number));
		for (const step of steps) expect(step).toBeCloseTo(steps[0] as number);
		expect(steps[0]).toBeGreaterThan(0);
	});
});
