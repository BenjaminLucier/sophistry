/**
 * `chart`: layers report their data, the frame fits its axes to it, and
 * `progress` draws the frame before the data, against the imperative graph
 * (`mount` commits by hand).
 */

import type { SceneNode } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { TextSpec } from "@sophistry/core/internal";
import { DEFAULT_GRID_Z_INDEX } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { bars, barsHandle } from "../bars/bars";
import { histogram } from "../bars/histogram";
import type { ChartHandle, ChartProps } from "../chart";
import { chart, chartHandle } from "../chart";
import { linePlot } from "../curves/line-plot";
import { stackPlot } from "../curves/stack-plot";
import { scatter } from "../points/scatter";
import { stem } from "../points/stem";
import { markItems, mount } from "../test-harness";

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

const words = (view: View) => view.texts().map((t) => t.text);
const textAt = (view: View, text: string): TextSpec[] =>
	view.texts().filter((s) => s.text === text);

/** Straight two-point lines in the frame (axes, grid, zero lines), as [from, to]. */
const segments = (view: View) =>
	view.shapes().flatMap((s) => {
		const line = s.polylines[0] as unknown;
		const points = (
			Array.isArray(line) ? line : (line as { points: Point[] }).points
		) as Point[];
		return s.polylines.length === 1 && points.length === 2
			? [{ spec: s, from: points[0] as Point, to: points[1] as Point }]
			: [];
	});
const horizontalAt = (view: View, y: number, minLength: number) =>
	segments(view).filter(
		(l) =>
			Math.abs(l.from.y - y) < 1e-6 &&
			Math.abs(l.to.y - y) < 1e-6 &&
			Math.abs(l.to.x - l.from.x) >= minLength,
	);
const verticalAt = (view: View, x: number, minLength: number) =>
	segments(view).filter(
		(l) =>
			Math.abs(l.from.x - x) < 1e-6 &&
			Math.abs(l.to.x - x) < 1e-6 &&
			Math.abs(l.to.y - l.from.y) >= minLength,
	);

describe("chart fitting", () => {
	it("fits both axes to a scatter, without forcing zero", () => {
		const { handle } = plot(
			{},
			scatter.create({
				data: [
					{ a: 3.2, b: 41 },
					{ a: 8.9, b: 57 },
				],
				x: "a",
				y: "b",
			}),
		);
		expect(handle.coords.xRange()).toEqual([2, 10, 2]);
		const [ymin, ymax] = handle.coords.yRange();
		expect(ymin).toBeGreaterThan(0);
		expect(ymin).toBeLessThanOrEqual(41);
		expect(ymax).toBeGreaterThanOrEqual(57);
	});

	it("unions every layer's report, and keeps zero when any layer asks", () => {
		const { handle } = plot(
			{},
			histogram.create({ data: [4, 5, 5, 6], binCount: 2 }),
			linePlot.create({ data: [{ t: 2, v: 9 }], x: "t", y: "v" }),
		);
		const [xmin, xmax] = handle.coords.xRange();
		expect(xmin).toBeLessThanOrEqual(2);
		expect(xmax).toBeGreaterThanOrEqual(6);
		const [ymin, ymax] = handle.coords.yRange();
		expect(ymin).toBe(0);
		expect(ymax).toBeGreaterThanOrEqual(9);
	});

	it("fits around layers that stand on the baseline (stem, stackPlot)", () => {
		// Both draw from `coords.crossing()`, which comes from the fitted
		// range; their reports must not read it, or fitting never settles.
		const { handle } = plot(
			{},
			stem.create({ data: [3, -2, 5] }),
			stackPlot.create({
				data: [
					{ t: 0, a: 4, b: 3 },
					{ t: 2, a: 2, b: 2 },
				],
				x: "t",
				y: ["a", "b"],
			}),
		);
		const [ymin, ymax] = handle.coords.yRange();
		expect(ymin).toBeLessThanOrEqual(-2);
		expect(ymax).toBeGreaterThanOrEqual(7);
		expect(handle.coords.crossing().y).toBe(0);
	});

	it("an explicit range wins over fitting", () => {
		const { handle } = plot(
			{ yRange: [-1, 1] },
			scatter.create({ data: [100, 200] }),
		);
		expect(handle.coords.yRange()).toEqual([-1, 1]);
	});

	it("fits a log axis to whole decades", () => {
		const { handle } = plot(
			{ yAxis: { scale: "log" } },
			scatter.create({ data: [3, 40, 700] }),
		);
		expect(handle.coords.yRange()).toEqual([1, 1000]);
	});

	it("a log axis zoomed inside one decade writes numbers at its multiples", () => {
		const { view } = plot({
			xRange: [2000, 9000],
			yRange: [0, 1],
			xAxis: { scale: "log", position: "bottom" },
		});
		const written = words(view);
		// No decade in view; the 2, 3 and 5 multiples carry the numbers.
		expect(written).toEqual(expect.arrayContaining(["2000", "3000", "5000"]));
		expect(written).not.toContain("4000");
	});

	it("draws grid lines at the major ticks and a title", () => {
		const { view } = plot({
			xRange: [0, 4, 1],
			yRange: [0, 2, 1],
			grid: true,
			title: "Growth",
		});
		expect(words(view)).toContain("Growth");
		const lines = view
			.batchedShapes()
			.filter(
				(s) =>
					s.style.opacity !== undefined && s.zIndex === DEFAULT_GRID_Z_INDEX,
			);
		// 5 vertical (0..4) + 3 horizontal (0..2)
		expect(lines).toHaveLength(8);
	});
});

describe("chart band axes and bars", () => {
	const sales = [
		{ q: "Q2", n: 2 },
		{ q: "Q1", n: 6 },
		{ q: "Q2", n: 4 },
	];

	it("lays reported categories out in first-seen order, with names", () => {
		const { view, handle } = plot(
			{},
			bars.create({ data: sales, category: "q", value: "n" }),
		);
		expect(handle.xBand?.domain).toEqual(["Q2", "Q1"]);
		expect(handle.coords.yRange()[0]).toBe(0);
		expect(words(view)).toEqual(expect.arrayContaining(["Q1", "Q2"]));
	});

	it("named categories fix the order and the band", () => {
		const layer = bars.create({ data: sales, category: "q", value: "n" });
		const { handle } = plot(
			{ xAxis: { categories: ["Q1", "Q2"], padding: 0.5 }, yRange: [0, 8] },
			layer,
		);
		const own = barsHandle(layer);
		const q1 = own?.barBounds(1);
		const q2 = own?.barBounds(0);
		expect(q1).not.toBeNull();
		const centre = handle.coords.coordsToPoint(0.5, 0).x;
		expect(((q1?.minX ?? 0) + (q1?.maxX ?? 0)) / 2).toBeCloseTo(centre);
		// Half of a 4-wide slot (8 units / 2 slots) at padding 0.5.
		expect((q1?.maxX ?? 0) - (q1?.minX ?? 0)).toBeCloseTo(2);
		// Bars measure from zero: 6 is three times 2.
		expect(
			((q1?.maxY ?? 0) - (q1?.minY ?? 0)) / ((q2?.maxY ?? 0) - (q2?.minY ?? 1)),
		).toBeCloseTo(3);
	});

	it("horizontal bars put the categories on y and grow along x", () => {
		const layer = bars.create({
			data: [
				{ q: "a", n: 1 },
				{ q: "b", n: 3 },
			],
			category: "q",
			value: "n",
			orientation: "horizontal",
		});
		const { handle } = plot({}, layer);
		expect(handle.yBand?.domain).toEqual(["a", "b"]);
		expect(handle.xBand).toBeUndefined();
		const a = barsHandle(layer)?.barBounds(0);
		const b = barsHandle(layer)?.barBounds(1);
		expect(a && b).toBeTruthy();
		expect(
			((b?.maxX ?? 0) - (b?.minX ?? 0)) / ((a?.maxX ?? 0) - (a?.minX ?? 1)),
		).toBeCloseTo(3);
		expect(a?.minX).toBeCloseTo(handle.coords.coordsToPoint(0, 0).x);
	});
});

describe("chart progress", () => {
	/** Heights of the bars drawn (batched rect items with area and opacity). */
	const barHeights = (view: View) =>
		view.marks().flatMap((spec) =>
			markItems(spec)
				.filter(
					(item) =>
						item.alpha * spec.style.opacity * spec.progress > 0 &&
						item.halfHeight > 0,
				)
				.map((item) => 2 * item.halfHeight),
		);

	it("draws the frame first: no bar is drawn at the halfway mark", () => {
		const { view } = plot(
			{ xAxis: { categories: [0, 1] }, yRange: [0, 4], progress: 0.5 },
			bars.create({ data: [2, 4] }),
		);
		// Not started, a bar is not drawn at all: no zero-height box on the axis.
		expect(barHeights(view)).toHaveLength(0);
	});

	it("grows the bars over the second half, scaled by their own progress", () => {
		const { view } = plot(
			{ xAxis: { categories: [0, 1] }, yRange: [0, 4], progress: 0.75 },
			bars.create({ data: [2, 4], progress: 0.5 }),
		);
		// data half is at 0.5, the layer's own progress 0.5: a quarter grown.
		const [a, b] = barHeights(view);
		expect(a).toBeCloseTo(0.25 * 2);
		expect(b).toBeCloseTo(0.25 * 4);
	});
});

describe("chart scale options", () => {
	it("reverse flips a continuous axis, fitted or given", () => {
		const { handle } = plot(
			{ xRange: [0, 10], yAxis: { reverse: true } },
			scatter.create({ data: [{ a: 1, b: 3 }], x: "a", y: "b" }),
		);
		const [top, bottom] = handle.coords.yRange();
		expect(top).toBeGreaterThan(bottom);
		// The smallest value now sits at the top of the plot.
		expect(handle.coords.coordsToPoint(0, bottom).y).toBeCloseTo(
			handle.coords.area().maxY,
		);
	});

	it("reverse lays band categories out the other way", () => {
		const { view, handle } = plot(
			{ yRange: [0, 4], xAxis: { reverse: true } },
			bars.create({
				data: [
					{ k: "a", v: 1 },
					{ k: "b", v: 2 },
				],
				category: "k",
				value: "v",
			}),
		);
		const band = handle.xBand;
		expect(band?.center("a")).toBeGreaterThan(band?.center("b") ?? 0);
		expect(words(view)).toEqual(expect.arrayContaining(["a", "b"]));
	});

	it("clamp pins values outside the range to its ends", () => {
		const { handle } = plot({
			xRange: [0, 10],
			yRange: [0, 10],
			yAxis: { clamp: true },
		});
		expect(handle.coords.coordsToPoint(0, 50).y).toBeCloseTo(
			handle.coords.area().maxY,
		);
		expect(handle.coords.coordsToPoint(50, 0).x).toBeGreaterThan(
			handle.coords.area().maxX,
		);
	});

	it("margin pads a fitted range before rounding", () => {
		const { handle } = plot(
			{ yRange: [0, 1], xAxis: { margin: 0.05, nice: false } },
			scatter.create({
				data: [
					{ a: 0, b: 0.5 },
					{ a: 10, b: 0.5 },
				],
				x: "a",
				y: "b",
			}),
		);
		expect(handle.coords.xRange()).toEqual([-0.5, 10.5]);
	});

	it("tickFormat takes a d3-format string", () => {
		const { view } = plot({
			xRange: [0, 1, 0.25],
			yRange: [0, 1],
			xAxis: { tickFormat: ".0%" },
		});
		expect(words(view)).toEqual(expect.arrayContaining(["25%", "50%", "100%"]));
	});
});

describe("chart axis position", () => {
	const diverging = [
		{ q: "a", v: -3 },
		{ q: "b", v: 5 },
	];

	it("a band axis stands at the edge when the other range spans zero, with a zero line", () => {
		const layer = bars.create({
			data: diverging,
			category: "q",
			value: "v",
			orientation: "horizontal",
		});
		const { view, handle } = plot({}, layer);
		const box = handle.coords.area();
		const zero = handle.coords.coordsToPoint(0, 0).x;
		expect(zero).toBeGreaterThan(box.minX + 0.5);
		// The names sit left of the plot, not at x = 0 among the bars.
		for (const name of ["a", "b"]) {
			const [written] = textAt(view, name);
			expect(written?.at.x).toBeLessThan(box.minX);
		}
		// The band axis line runs up the left edge...
		expect(verticalAt(view, box.minX, 3.9)).not.toHaveLength(0);
		// ...and a zero line marks the baseline the bars grow from.
		expect(verticalAt(view, zero, 3.9)).toHaveLength(1);
		expect(handle.coords.crossing().x).toBe(0);
		const a = barsHandle(layer)?.barBounds(0);
		const b = barsHandle(layer)?.barBounds(1);
		expect(a?.maxX).toBeCloseTo(zero);
		expect(b?.minX).toBeCloseTo(zero);
	});

	it('position: "zero" puts a band axis back at the crossing', () => {
		const { view, handle } = plot(
			{ yAxis: { position: "zero" } },
			bars.create({
				data: diverging,
				category: "q",
				value: "v",
				orientation: "horizontal",
			}),
		);
		const zero = handle.coords.coordsToPoint(0, 0).x;
		const [written] = textAt(view, "a");
		expect(written?.at.x).toBeLessThan(zero);
		expect(written?.at.x).toBeGreaterThan(handle.coords.area().minX);
		// The band axis is the baseline itself: no separate zero line.
		expect(verticalAt(view, zero, 3.9)).toHaveLength(1);
	});

	it("draws no zero line when the band axis stands on zero already, or when turned off", () => {
		const positive = plot(
			{},
			bars.create({ data: [{ q: "a", v: 2 }], category: "q", value: "v" }),
		);
		const box = positive.handle.coords.area();
		expect(positive.handle.coords.coordsToPoint(0, 0).y).toBeCloseTo(box.minY);
		expect(horizontalAt(positive.view, box.minY, 7.9)).toHaveLength(1);

		const off = plot(
			{ xAxis: { zeroLine: false } },
			bars.create({
				data: diverging,
				category: "q",
				value: "v",
				orientation: "horizontal",
			}),
		);
		expect(
			verticalAt(off.view, off.handle.coords.coordsToPoint(0, 0).x, 3.9),
		).toHaveLength(0);
	});

	it("continuous axes still cross at zero by default", () => {
		const { view, handle } = plot({ xRange: [-4, 4], yRange: [-2, 2] });
		const origin = handle.coords.coordsToPoint(0, 0);
		expect(horizontalAt(view, origin.y, 7.9)).toHaveLength(1);
		expect(verticalAt(view, origin.x, 3.9)).toHaveLength(1);
		// No "0" where they meet: each axis's line runs through the other's.
		expect(textAt(view, "0")).toHaveLength(0);
	});

	it('position: "bottom" moves the x axis, its numbers and its title, not the crossing', () => {
		const { view, handle } = plot({
			xRange: [-4, 4],
			yRange: [-2, 2],
			xAxis: { position: "bottom" },
			xLabel: "time",
		});
		const box = handle.coords.area();
		expect(horizontalAt(view, box.minY, 7.9)).toHaveLength(1);
		expect(
			horizontalAt(view, handle.coords.coordsToPoint(0, 0).y, 7.9),
		).toHaveLength(0);
		expect(handle.coords.crossing()).toEqual({ x: 0, y: 0 });
		const [four] = textAt(view, "4");
		expect(four?.at.y).toBeLessThan(box.minY);
		const [title] = textAt(view, "time");
		expect(title?.at.y).toBeCloseTo(box.minY, 0);
		expect(title?.at.x).toBeGreaterThan(box.maxX);
		// The axes no longer meet at the origin, so both "0"s are written.
		expect(textAt(view, "0")).toHaveLength(2);
	});

	it('"top" and "right" write the numbers outward; a value pins the line there', () => {
		const top = plot({
			xRange: [-4, 4, 2],
			yRange: [-2, 2, 1],
			xAxis: { position: "top" },
			yAxis: { position: 1 },
			autosize: "pad",
		});
		const box = top.handle.coords.area();
		expect(horizontalAt(top.view, box.maxY, 7.9)).toHaveLength(1);
		expect(
			verticalAt(top.view, top.handle.coords.coordsToPoint(1, 0).x, 3.9),
		).toHaveLength(1);
		const [four] = textAt(top.view, "4");
		expect(four?.at.y).toBeGreaterThan(box.maxY);

		const right = plot({
			xRange: [-4, 4],
			yRange: [-20, 20, 10],
			yAxis: { position: "right" },
			autosize: "pad",
		});
		const area = right.handle.coords.area();
		expect(verticalAt(right.view, area.maxX, 3.9)).toHaveLength(1);
		const [ten] = textAt(right.view, "10");
		expect(ten?.at.x).toBeGreaterThan(area.maxX);
	});

	it("an edge axis stays on its edge through reverse and an animated domain", () => {
		const { view, handle } = plot({
			xRange: [-4, 4],
			yRange: { from: [-2, 2], to: [-10, 30], t: 0.4 },
			xAxis: { position: "bottom" },
			yAxis: { reverse: true },
		});
		const box = handle.coords.area();
		expect(horizontalAt(view, box.minY, 7.9)).toHaveLength(1);
		// Reversed: the range's first entry, now its largest value, is at the bottom.
		const [first] = handle.coords.yRange();
		expect(handle.coords.coordsToPoint(0, first).y).toBeCloseTo(box.minY);
	});
});

describe("chart autosize", () => {
	const temps = [
		{ m: 1, city: "Oslo", c: -4 },
		{ m: 7, city: "Oslo", c: 17 },
		{ m: 1, city: "Rome", c: 8 },
		{ m: 7, city: "Rome", c: 25 },
	];

	it("leaves a chart without guides on the right exactly width wide", () => {
		const { handle } = plot({}, linePlot.create({ data: [1, 2, 3] }));
		const box = handle.coords.area();
		expect(box.maxX - box.minX).toBeCloseTo(8);
		expect(box.minX).toBeCloseTo(-4);
	});

	it("narrows the plot so a right-hand legend fits inside width", () => {
		const { view, handle } = plot(
			{},
			linePlot.create({ data: temps, x: "m", y: "c", series: "city" }),
		);
		const box = handle.coords.area();
		expect(box.minX).toBeCloseTo(-4);
		expect(box.maxX).toBeLessThan(3);
		const names = view
			.texts()
			.filter((s) => s.text === "Oslo" || s.text === "Rome");
		expect(names).toHaveLength(2);
		for (const name of names) {
			expect(name.at.x).toBeGreaterThan(box.maxX);
			expect(name.at.x).toBeLessThan(4);
		}
	});

	it('"pad" keeps the plot at width and lets the legend hang past it', () => {
		const { handle } = plot(
			{ autosize: "pad" },
			linePlot.create({ data: temps, x: "m", y: "c", series: "city" }),
		);
		const box = handle.coords.area();
		expect(box.maxX - box.minX).toBeCloseTo(8);
	});

	it("makes room for a right y axis's numbers", () => {
		const { handle } = plot({
			xRange: [0, 4],
			yRange: [0, 1000],
			yAxis: { position: "right" },
		});
		const box = handle.coords.area();
		expect(box.minX).toBeCloseTo(-4);
		expect(box.maxX).toBeLessThan(3.6);
	});
});

describe("chart labels during a domain transition", () => {
	const opacityOf = (view: View, text: string) =>
		textAt(view, text).map((s) => s.style.opacity ?? 1);

	it("fades x's \"0\" with its tick, and keeps y's off the x line, mid-transition", () => {
		const { view } = plot({
			xRange: { from: [-4, 4], to: [2, 10], t: 0.5 },
			yRange: [0, 2],
		});
		// x's 0 is on the old axis only, fading at 1 − t. The x line runs on
		// left of the origin, through where y's would be, so y's stays hidden.
		const zeros = opacityOf(view, "0");
		expect(zeros).toHaveLength(1);
		expect(zeros[0]).toBeCloseTo(0.5);
	});

	it('hands the origin\'s "0" to the y axis as the x line leaves its spot', () => {
		// x runs from 0: nothing left of the origin, so y can write its "0"
		// there, and does, while the y line running below 0 crosses x's.
		const { view } = plot({ xRange: [0, 8], yRange: [-2, 2] });
		expect(opacityOf(view, "0")).toEqual([1]);
	});

	it("writes numbers with the ends' precision, not the blended range's", () => {
		const { view } = plot({
			xRange: { from: [0, 1], to: [0, 10], t: 0.3 },
			yRange: [0, 1],
			xAxis: { tickFormat: "f" },
		});
		const written = words(view);
		// Old axis (step 0.2): one decimal; new axis (step 2): none.
		expect(written).toContain("0.2");
		expect(written).toContain("2");
		expect(written).not.toContain("2.0");
	});
});

describe("chart waits for its reports before laying an axis out", () => {
	/**
	 * The chart fits within one commit (reports rerun its update before
	 * anything is drawn), so the intent is checked on what the frame holds
	 * after the first commit: which axis nodes exist, and that no continuous
	 * x axis was ever drawn.
	 */
	const types = (root: SceneNode) => {
		const out: string[] = [];
		const walk = (node: SceneNode) => {
			out.push(node.type);
			for (const child of (node as { children?: readonly SceneNode[] })
				.children ?? [])
				walk(child);
		};
		walk(root);
		return out;
	};
	const layer = () =>
		bars.create({
			data: [
				{ c: "a", v: 1 },
				{ c: "b", v: 2 },
				{ c: "c", v: 3 },
			],
			category: "c",
			value: "v",
		});

	for (const scale of [undefined, "band" as const]) {
		it(`a band window from xRange, yRange given (scale ${scale ?? "default"}): no continuous x axis first`, () => {
			const { node, view } = plot(
				{
					xRange: [0, 2],
					yRange: [0, 10],
					...(scale ? { xAxis: { scale } } : {}),
				},
				layer(),
			);
			// One `NumberLine` (the y axis's): the x axis is a band axis.
			expect(types(node).filter((t) => t === "NumberLine")).toHaveLength(1);
			expect(words(view)).toEqual(expect.arrayContaining(["a", "b"]));
			expect(words(view)).not.toContain("1.5");
		});
	}

	it("ranges on axes with a continuous scale named still draw at once", () => {
		const { node } = plot(
			{ xRange: [0, 4], yRange: [0, 2], axis: { scale: "linear" } },
			linePlot.create({ data: [{ t: 1, v: 1 }], x: "t", y: "v" }),
		);
		expect(types(node).filter((t) => t === "NumberLine")).toHaveLength(2);
	});
});
