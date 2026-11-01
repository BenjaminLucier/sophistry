/**
 * What renderer clipping unlocks in `chart`: layers clipped to the plot
 * area (`clip`), one shared reveal front across layers (`reveal="x"`), and
 * animated domains (`xRange: { from, to, t }`) whose ticks and grid lines
 * cross-fade by value. The line and the markers are batched (one marks spec each).
 */

import type { SceneNode } from "@sophistry/core";
import type { Bounds } from "@sophistry/core/geometry";
import type { DrawSpec, MarksSpec } from "@sophistry/core/internal";
import { DEFAULT_GRID_Z_INDEX } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import { linePlot } from "../curves/line-plot.js";
import { scatter } from "../points/scatter.js";
import { markItems, mount } from "../test-harness.js";

type View = ReturnType<typeof mount>;

/** An 8 × 4 chart, mounted, with its handle. */
function plot(
	props: Omit<ChartProps, "width" | "height" | "children">,
	...children: SceneNode[]
) {
	const node = chart.create({ width: 8, height: 4, ...props, children });
	const view = mount(node);
	return { node, view, handle: chartHandle(node) as ChartHandle };
}

/** The box every region of a clip list overlaps (core's `clipBounds`). */
function clipBounds(clip: DrawSpec["clip"]): Bounds | null {
	if (!clip || clip.length === 0) return null;
	let box: Bounds = {
		minX: Number.NEGATIVE_INFINITY,
		minY: Number.NEGATIVE_INFINITY,
		maxX: Number.POSITIVE_INFINITY,
		maxY: Number.POSITIVE_INFINITY,
	};
	for (const region of clip) {
		const points = region.rings.flat();
		box = {
			minX: Math.max(box.minX, Math.min(...points.map((p) => p.x))),
			minY: Math.max(box.minY, Math.min(...points.map((p) => p.y))),
			maxX: Math.min(box.maxX, Math.max(...points.map((p) => p.x))),
			maxY: Math.min(box.maxY, Math.max(...points.map((p) => p.y))),
		};
	}
	return box;
}

const line = [0, 4, 2, 8, 6, 10];
/** The data line: the batched path with more than two points, if drawn. */
const dataLine = (view: View): MarksSpec | undefined =>
	view
		.marks()
		.find(
			(s) =>
				s.shape.kind === "paths" &&
				s.count > 0 &&
				markItems(s).some((item) =>
					item.polylines.some((polyline) => polyline.length > 2),
				),
		);
const lineBox = (spec: MarksSpec) => {
	const xs = markItems(spec).flatMap((item) =>
		item.polylines.flat().map((p) => p.x),
	);
	return { minX: Math.min(...xs), maxX: Math.max(...xs) };
};

describe("chart clip", () => {
	it("clips the layers to the plotting area, and not the frame", () => {
		const { view, handle } = plot(
			{ xRange: [0, 5], yRange: [0, 5], clip: true },
			linePlot.create({ data: line }),
		);
		const data = dataLine(view);
		expect(clipBounds(data?.clip)).toEqual(handle.coords.area());
		// The axes and their numbers are frame, never clipped.
		const frame = view.graph.frame.filter((s) => s !== data);
		expect(frame.length).toBeGreaterThan(0);
		for (const spec of frame) expect(spec.clip).toBeUndefined();
	});

	it("clips nothing by default", () => {
		const { view } = plot(
			{ xRange: [0, 5], yRange: [0, 5] },
			linePlot.create({ data: line }),
		);
		expect(view.graph.frame.every((s) => s.clip === undefined)).toBe(true);
	});
});

describe('chart reveal="x"', () => {
	const sweptChart = (progress: number, clip = false) =>
		plot(
			{ xRange: [0, 5], yRange: [0, 10], progress, reveal: "x", clip },
			linePlot.create({ data: line }),
			scatter.create({
				data: line,
				x: (_: unknown, i: number) => i,
				y: (d: unknown) => d as number,
			}),
		);

	it("draws every layer whole behind one front moving across the plot", () => {
		// Frame done, data half at 0.5: the front is mid-plot.
		const { view, handle } = sweptChart(0.75);
		const area = handle.coords.area();
		const front = area.minX + (area.maxX - area.minX) * 0.5;
		const data = dataLine(view) as MarksSpec;
		expect(data.progress).toBe(1);
		// The whole line is there, cut only by the clip.
		expect(lineBox(data).maxX).toBeCloseTo(handle.coords.coordsToPoint(5).x);
		expect(clipBounds(data.clip)?.maxX).toBeCloseTo(front);
		// The markers share the same front: one clip list for every layer.
		const markers = view.marks().filter((s) => s !== data && s.clip);
		expect(markers.reduce((n, s) => n + s.count, 0)).toBe(line.length);
		for (const marker of markers) expect(marker.clip).toBe(data.clip);
	});

	it("hides the layers until the frame is drawn, and unclips once done", () => {
		expect(dataLine(sweptChart(0.5).view)).toBeUndefined();
		expect(dataLine(sweptChart(1).view)?.clip).toBeUndefined();
	});

	it("nests inside the plot clip", () => {
		expect(dataLine(sweptChart(0.75, true).view)?.clip).toHaveLength(2);
	});
});

describe("animated domains", () => {
	const zoom = (t: number) =>
		plot(
			{
				xRange: [0, 3, 1],
				yRange: { from: [0, 10, 5], to: [0, 100, 50], t },
				grid: "y",
				clip: true,
			},
			linePlot.create({ data: [0, 10, 20, 100] }),
		);
	const opacityOf = (view: View, text: string) =>
		view.texts().find((s) => s.text === text)?.style.opacity;

	it("is the from range at 0 and the to range at 1, exactly", () => {
		const start = zoom(0);
		expect(start.handle.coords.yRange()).toEqual([0, 10, 5]);
		expect(opacityOf(start.view, "5")).toBe(1);
		expect(opacityOf(start.view, "50")).toBeUndefined();
		const end = zoom(1);
		expect(end.handle.coords.yRange()).toEqual([0, 100, 50]);
		expect(opacityOf(end.view, "50")).toBe(1);
		expect(opacityOf(end.view, "5")).toBeUndefined();
	});

	it("maps the layers through the blended range", () => {
		const { handle } = zoom(0.5);
		expect(handle.coords.yRange()[1]).toBeCloseTo(55);
		// The top of the plot is y = 55 halfway through.
		expect(handle.coords.coordsToPoint(0, 55).y).toBeCloseTo(
			handle.coords.area().maxY,
		);
	});

	it("cross-fades ticks by value: old fade out, new fade in, shared stay", () => {
		const { view } = zoom(0.5);
		// 50 is on the new axis only (step 5 → 50), with room: at its weight.
		expect(opacityOf(view, "50")).toBeCloseTo(0.5);
		// 5 and 10 are old-only, squeezed into the bottom of 0..55 until they
		// touch: they make way, fainter than their weight alone, rather than
		// piling up.
		for (const crowded of ["5", "10"])
			expect(opacityOf(view, crowded) ?? 0).toBeLessThan(0.5);
		// Grid lines fade with their ticks.
		const grid = view
			.batchedShapes()
			.filter((s) => s.zIndex === DEFAULT_GRID_Z_INDEX);
		// A batch keeps each line's opacity as a float32, so compare to 1e-6.
		const faded = grid.filter((s) => s.style.opacity < 0.45 - 1e-6);
		expect(faded.length).toBeGreaterThan(0);
		expect(grid.some((s) => Math.abs(s.style.opacity - 0.45) < 1e-6)).toBe(
			true,
		);
	});
});
