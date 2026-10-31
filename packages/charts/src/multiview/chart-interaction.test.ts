/**
 * Brushing and zoom: the box `rangeBrush` (x and
 * y), a brush on a band axis selecting categories, `chartZoom`'s wheel,
 * drag, pinch and keyboard actions over a chart's range tracks, and
 * `chartLink`.
 *
 * Gestures are driven the way the pointer driver and the accessibility
 * mirror deliver them: a node's registered `drag` behaviour gets
 * `start`/`move`/`end` with scene points, its `keyboard` behaviour gets
 * `nudge` and `key`; `commit()` runs between events, as the frame loop does.
 */

import type { SceneNode } from "@sophistry/core";
import { derive, track } from "@sophistry/core";
import { bandScale } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { chart, chartHandle } from "../chart";
import type { ChartHandle } from "../frame/types";
import { scatter } from "../points/scatter";
import {
	boxBrushDrags,
	brushDrags,
	chartZoomActions,
	chartZoomDrag,
} from "./brush";
import { brushedCategories, chartLink, rangeBrush } from "./chart-link";
import { chartZoom } from "./chart-zoom";
import { at, boxOf, press, stage, values } from "./test-utils";

type Cell = ReturnType<typeof track<number>>;

/** A 10 × 10 frame over [0, 10] × [0, 10]: one scene unit per data unit, 0 at -5. */
function unitFrame() {
	const plot = chart.create({
		width: 10,
		height: 10,
		autosize: "pad",
		xRange: [0, 10],
		yRange: [0, 10],
	});
	stage(plot);
	return () => chartHandle(plot) as ChartHandle;
}

const brushAxis = (
	axis: "x" | "y",
	pair: readonly [Cell, Cell],
	minSpan = 0.5,
) => ({
	axis,
	from: pair[0],
	to: pair[1],
	bounds: () => undefined,
	minSpan: () => minSpan,
	snap: () => false,
});

const range = (from: Cell, to: Cell) =>
	derive([from, to], (a, b) => [a, b] as [number, number]);

describe("rangeBrush gestures", () => {
	it("moves the body keeping its span, clamped to the bounds; edges resize", () => {
		const from = track(2);
		const to = track(4);
		const frame = unitFrame();
		const { drag } = brushDrags({
			coords: () => frame().coords,
			from,
			to,
			vertical: () => false,
			bounds: () => undefined,
			minSpan: () => 0.5,
			disabled: () => false,
		});
		drag.body.drag.start(at(-2));
		drag.body.drag.move(at(1));
		expect([from.peek(), to.peek()]).toEqual([5, 7]);
		drag.body.drag.move(at(20));
		expect([from.peek(), to.peek()]).toEqual([8, 10]);
		drag.body.drag.end(at(20), false);
		// The low edge can't cross the high one (minus minSpan).
		drag.from.drag.start(at(3));
		drag.from.drag.move(at(9));
		expect(from.peek()).toBeCloseTo(9.5);
		drag.from.drag.end(at(9), false);
		drag.to.drag.start(at(5));
		drag.to.drag.move(at(-20));
		expect(to.peek()).toBeCloseTo(10);
		drag.to.drag.end(at(-20), false);
	});
});

describe("box rangeBrush", () => {
	it("moves its body on both axes, keeping both spans, clamped to the frame", () => {
		const frame = unitFrame();
		const x = [track(2), track(4)] as const;
		const y = [track(1), track(3)] as const;
		const g = boxBrushDrags({
			coords: () => frame().coords,
			x: brushAxis("x", x),
			y: brushAxis("y", y),
			disabled: () => false,
		});
		g.body.drag.start(at(-2, -3));
		g.body.drag.move(at(0, 0));
		expect(values(x)).toEqual([4, 6]);
		expect(values(y)).toEqual([4, 6]);
		g.body.drag.move(at(20, 20));
		expect(values(x)).toEqual([8, 10]);
		expect(values(y)).toEqual([8, 10]);
		g.body.drag.end(at(20, 20), false);
		// The keyboard moves it in the arrow's direction, one step (0.25 units).
		g.body.keyboard.nudge({ x: -1, y: 0 }, false);
		expect(values(x)).toEqual([7.75, 9.75]);
		expect(values(y)).toEqual([8, 10]);
	});

	it("resizes from an edge along one axis and from a corner along both", () => {
		const frame = unitFrame();
		const x = [track(2), track(4)] as const;
		const y = [track(1), track(3)] as const;
		const g = boxBrushDrags({
			coords: () => frame().coords,
			x: brushAxis("x", x),
			y: brushAxis("y", y),
			disabled: () => false,
		});
		// The top edge (y's high end) moves only y, and not below y.from + minSpan.
		g.y.to.drag.start(at(-2, -2));
		g.y.to.drag.move(at(1, -10));
		expect(values(y)).toEqual([1, 1.5]);
		expect(values(x)).toEqual([2, 4]);
		g.y.to.drag.end(at(1, -10), false);
		// The corner at (x.from, y.to) moves both of those ends.
		const corner = g.corners.find((c) => c.x === "a" && c.y === "b");
		corner?.drag.drag.start(at(-3, -3.5));
		corner?.drag.drag.move(at(-4, -1.5));
		expect(values(x)).toEqual([1, 4]);
		expect(values(y)).toEqual([1, 3.5]);
		corner?.drag.drag.end(at(-4, -1.5), false);
		// A cancelled drag puts the ends back.
		g.x.to.drag.start(at(-1, 0));
		g.x.to.drag.move(at(3, 0));
		expect(x[1].peek()).toBe(8);
		g.x.to.drag.end(at(3, 0), true);
		expect(x[1].peek()).toBe(4);
	});

	it("draws a box, four edges and four corners; the body and edges are the tab stops", () => {
		const x = [track(2), track(6)] as const;
		const y = [track(1), track(4)] as const;
		const plot = chart.create({
			width: 10,
			height: 10,
			autosize: "pad",
			xRange: [0, 10],
			yRange: [0, 10],
			children: [rangeBrush.create({ x, y, label: "window" })],
		});
		const t = stage(plot);
		const frame = chartHandle(plot) as ChartHandle;
		const filled = t
			.shapes()
			.filter((s) => s.closed && s.style.fill && s.style.opacity > 0);
		const body = filled.find(
			(s) => Math.abs(s.style.fillOpacity - 0.18) < 1e-9,
		);
		if (!body) throw new Error("no body");
		const box = boxOf(body);
		const a = frame.coords.coordsToPoint(2, 1);
		const b = frame.coords.coordsToPoint(6, 4);
		expect(box.minX).toBeCloseTo(a.x);
		expect(box.maxX).toBeCloseTo(b.x);
		expect(box.minY).toBeCloseTo(a.y);
		expect(box.maxY).toBeCloseTo(b.y);
		expect(filled).toHaveLength(9);
		expect([...t.focusable()].sort()).toEqual(
			[
				"window",
				"window x start",
				"window x end",
				"window y start",
				"window y end",
			].sort(),
		);
		// Moving the tracks moves the box: no state of its own.
		x[1].set(8);
		t.commit();
		const moved = t
			.shapes()
			.find((s) => s.closed && Math.abs(s.style.fillOpacity - 0.18) < 1e-9);
		expect(moved && boxOf(moved).maxX).toBeCloseTo(
			frame.coords.coordsToPoint(8, 0).x,
		);
	});

	it("needs a pair of tracks, and a chart", () => {
		expect(() =>
			stage(
				chart.create({
					width: 4,
					height: 4,
					children: [rangeBrush.create({})],
				}),
			),
		).toThrow(/needs/);
		expect(() =>
			stage(rangeBrush.create({ from: track(0), to: track(1) })),
		).toThrow(/inside a chart/);
	});
});

describe("rangeBrush, drawn from its tracks", () => {
	it("draws the selection from its tracks and drives a linked chart", () => {
		const from = track(2);
		const to = track(4);
		const overview = chart.create({
			width: 8,
			height: 2,
			xRange: [0, 10],
			yRange: [0, 1],
			children: [rangeBrush.create({ from, to })],
		});
		const detail = chart.create({
			width: 8,
			height: 2,
			xRange: range(from, to),
			yRange: [0, 1],
		});
		const t = stage(overview, detail);
		const body = t
			.shapes()
			.find((s) => s.closed && Math.abs(s.style.fillOpacity - 0.18) < 1e-9);
		expect(body).toBeDefined();
		const coords = (chartHandle(overview) as ChartHandle).coords;
		const box = boxOf(body as never);
		expect(box.minX).toBeCloseTo(coords.coordsToPoint(2, 0).x);
		expect(box.maxX).toBeCloseTo(coords.coordsToPoint(4, 0).x);
		from.set(5);
		to.set(9);
		t.commit();
		expect(chartHandle(detail)?.coords.xRange().slice(0, 2)).toEqual([5, 9]);
	});
});

describe("rangeBrush on a band axis", () => {
	it("brushDrags snaps only when asked", () => {
		const frame = unitFrame();
		const from = track(2);
		const to = track(4);
		const { drag } = brushDrags({
			coords: () => frame().coords,
			from,
			to,
			vertical: () => false,
			bounds: () => undefined,
			minSpan: () => 0,
			disabled: () => false,
		});
		drag.to.drag.start(at(-1, 0));
		drag.to.drag.move(at(-0.6, 0));
		expect(to.peek()).toBeCloseTo(4.4);
		drag.to.drag.end(at(-0.6, 0), false);
	});

	it("snaps the ends to whole categories; a key moves one category", () => {
		// A band x axis from a layer's categories (scatter on a category channel).
		const sales = ["a", "b", "c", "d", "e", "f"].map((k, i) => ({
			k,
			v: i + 1,
		}));
		const from = track(1);
		const to = track(3);
		const t = stage(
			chart.create({
				width: 6,
				height: 3,
				autosize: "pad",
				xAxis: { categories: sales.map((d) => d.k), padding: 0 },
				yAxis: { visible: false },
				children: [
					scatter.create({ data: sales, x: "k", y: "v" } as never),
					rangeBrush.create({ from, to }),
				],
			}),
		);
		// Six bands over six units: slot edge i is at i - 3.
		const end = t.find("selected range end").handlers();
		end.drag?.start(at(0, 0));
		end.drag?.move(at(0.6, 0));
		expect(to.peek()).toBe(4);
		end.drag?.move(at(9, 0));
		expect(to.peek()).toBe(6);
		end.drag?.end(at(9, 0), false);
		// An arrow key steps one category even though its step is a quarter unit.
		end.keyboard?.nudge?.({ x: -1, y: 0 }, false);
		expect(to.peek()).toBe(5);
		const start = t.find("selected range start").handlers();
		start.keyboard?.nudge?.({ x: 1, y: 0 }, false);
		start.keyboard?.nudge?.({ x: 1, y: 0 }, false);
		start.keyboard?.nudge?.({ x: 1, y: 0 }, false);
		expect(from.peek()).toBe(4);
		// At least one category stays selected.
		start.keyboard?.nudge?.({ x: 1, y: 0 }, false);
		expect(from.peek()).toBe(4);
		const body = t.find("selected range").handlers();
		body.keyboard?.nudge?.({ x: -1, y: 0 }, false);
		expect([from.peek(), to.peek()]).toEqual([3, 4]);
		expect(
			brushedCategories(
				sales.map((d) => d.k),
				from.peek(),
				to.peek(),
			),
		).toEqual(["d"]);
	});

	it("brushedCategories reads a list or a (reversed) band scale", () => {
		expect(brushedCategories(["Jan", "Feb", "Mar", "Apr"], 1, 3)).toEqual([
			"Feb",
			"Mar",
		]);
		expect(brushedCategories(["Jan", "Feb", "Mar", "Apr"], 3, 1)).toEqual([
			"Feb",
			"Mar",
		]);
		const reversed = bandScale(["a", "b", "c", "d"], { reverse: true });
		// Reversed, d takes slot 0 and c slot 1; the result keeps domain order.
		expect(brushedCategories(reversed, 0, 2)).toEqual(["c", "d"]);
		expect(brushedCategories(["a", "b"], 0.6, 1.4)).toEqual([]);
	});
});

describe("chartZoom actions", () => {
	/** A frame reading its x range (and optionally y) from tracks. */
	function zoomable(
		options: {
			log?: boolean;
			reverse?: boolean;
			y?: boolean;
			bounds?: readonly [number, number];
			minSpan?: number;
		} = {},
	) {
		const x = [
			track(options.log ? 1 : 0),
			track(options.log ? 100 : 10),
		] as const;
		const y = [track(0), track(4)] as const;
		const plot = chart.create({
			width: 10,
			height: 4,
			autosize: "pad",
			xRange: range(x[0], x[1]),
			yRange: range(y[0], y[1]),
			xAxis: {
				scale: options.log ? "log" : undefined,
				reverse: options.reverse,
			},
		});
		const t = stage(plot);
		const frame = () => chartHandle(plot) as ChartHandle;
		const actions = chartZoomActions({
			coords: () => frame().coords,
			x,
			y: options.y ? y : undefined,
			bounds: (axis) => (axis === "x" ? options.bounds : undefined),
			minSpan: (axis) => (axis === "x" ? options.minSpan : undefined),
		});
		return { x, y, frame, actions, commit: t.commit };
	}

	it("zooms about a point, which stays put; only the axes it was given", () => {
		const { x, y, frame, actions, commit } = zoomable();
		actions.zoomAbout({ x: 0, y: 1 }, 0.5);
		commit();
		expect(values(x)).toEqual([2.5, 7.5]);
		expect(values(y)).toEqual([0, 4]);
		expect(frame().coords.pointToCoords({ x: 0, y: 0 }).x).toBeCloseTo(5);
		// About the left edge: the value there stays.
		actions.zoomAbout({ x: -5, y: 0 }, 2);
		commit();
		expect(values(x)).toEqual([2.5, 12.5]);
	});

	it("composes writes made before the frame catches up", () => {
		const flushed = zoomable();
		flushed.actions.zoomAbout({ x: 1, y: 0 }, 0.5);
		flushed.commit();
		flushed.actions.panBy({ x: 2, y: 0 });
		flushed.commit();
		const quick = zoomable();
		// The same two steps in one task: the second reads the tracks' view.
		quick.actions.zoomAbout({ x: 1, y: 0 }, 0.5);
		quick.actions.panBy({ x: 2, y: 0 });
		quick.commit();
		expect(values(quick.x)).toEqual(values(flushed.x));
	});

	it("composes on a reversed axis", () => {
		const reversed = zoomable({ reverse: true });
		reversed.actions.zoomAbout({ x: -5, y: 0 }, 0.5);
		reversed.actions.zoomAbout({ x: -5, y: 0 }, 0.5);
		reversed.commit();
		expect(values(reversed.x)).toEqual([7.5, 10]);
	});

	it("pans by a scene distance, the content following", () => {
		const { x, actions, commit } = zoomable();
		actions.panBy({ x: 1, y: 0 });
		commit();
		expect(values(x)).toEqual([-1, 9]);
	});

	it("keeps the view inside its bounds and wider than minSpan", () => {
		const { x, actions, commit } = zoomable({ bounds: [0, 10], minSpan: 2 });
		actions.panBy({ x: 3, y: 0 });
		commit();
		expect(values(x)).toEqual([0, 10]);
		actions.zoomAbout({ x: 0, y: 0 }, 0.01);
		commit();
		expect(x[1].peek() - x[0].peek()).toBeCloseTo(2);
		expect((x[0].peek() + x[1].peek()) / 2).toBeCloseTo(5);
		actions.panBy({ x: -20, y: 0 });
		commit();
		expect(values(x)).toEqual([8, 10]);
		expect(actions.reset()).toBe(true);
		expect(values(x)).toEqual([0, 10]);
	});

	it("zooms a log axis geometrically and a reversed axis the right way round", () => {
		const log = zoomable({ log: true });
		log.actions.zoomAbout({ x: 0, y: 0 }, 0.5);
		log.commit();
		expect(log.x[0].peek()).toBeCloseTo(10 ** 0.5, 6);
		expect(log.x[1].peek()).toBeCloseTo(10 ** 1.5, 6);
		const reversed = zoomable({ reverse: true });
		// Reversed, the left edge shows 10: zooming about it keeps 10 there.
		reversed.actions.zoomAbout({ x: -5, y: 0 }, 0.5);
		reversed.commit();
		expect(values(reversed.x)).toEqual([5, 10]);
	});

	it("drag pans holding the grabbed value under the pointer; a cancel puts it back", () => {
		const { x, y, actions, commit } = zoomable({ y: true });
		const drag = chartZoomDrag(actions, () => true);
		expect(drag.start(at(0, 0))).toBe(true);
		drag.move(at(1, 0));
		commit();
		expect(values(x)).toEqual([-1, 9]);
		drag.move(at(2, 1));
		commit();
		expect(values(x)).toEqual([-2, 8]);
		expect(values(y)).toEqual([-1, 3]);
		expect(drag.end(at(2, 1), true)).toBe(true);
		expect(values(x)).toEqual([0, 10]);
		expect(values(y)).toEqual([0, 4]);
	});

	it("a press that does not move is a tap, and changes nothing", () => {
		const { x, actions } = zoomable();
		const drag = chartZoomDrag(actions, () => true);
		drag.start(at(0, 0));
		drag.move(at(0.03, 0));
		expect(drag.end(at(0.03, 0), false)).toBe(false);
		expect(values(x)).toEqual([0, 10]);
		// Disabled, it declines the press so it can fall through.
		expect(chartZoomDrag(actions, () => false).start(at(0, 0))).toBe(false);
	});

	it("pinches: the fingers keep the values they went down on", () => {
		const { x, actions, commit } = zoomable();
		const drag = chartZoomDrag(actions, () => true);
		drag.start(at(-1, 0, 1));
		drag.start(at(1, 0, 2));
		drag.move(at(3, 0, 2));
		commit();
		// 4 stays at -1 and 6 is now at 3: two units per value.
		expect(x[0].peek()).toBeCloseTo(2, 9);
		expect(x[1].peek()).toBeCloseTo(7, 9);
		// A third finger is not part of it.
		expect(drag.start(at(0, 0, 3))).toBe(false);
		drag.end(at(3, 0, 2), false);
		// The remaining finger re-grabs: dragging it now pans.
		drag.move(at(0, 0, 1));
		commit();
		// 4 (under it since the lift) is now at 0, two units per value still.
		expect(x[0].peek()).toBeCloseTo(1.5, 9);
		drag.end(at(0, 0, 1), false);
	});
});

describe("chartZoom keyboard", () => {
	it("arrows pan, + and - zoom about the middle, 0 returns to the bounds", () => {
		const from = track(0);
		const to = track(10);
		const t = stage(
			chart.create({
				width: 10,
				height: 4,
				autosize: "pad",
				xRange: range(from, to),
				yRange: [0, 1],
				children: [chartZoom.create({ x: [from, to], bounds: [0, 20] })],
			}),
		);
		const surface = t.find("zoomable plot");
		// The surface paints nothing: no fill and no outline.
		const drawnSurface = t
			.shapes()
			.filter(
				(shape) =>
					shape.closed && shape.style.stroke === "none" && !shape.style.fill,
			);
		expect(drawnSurface).toHaveLength(1);
		expect(surface.pointerEvents()).toBe("all");
		const keyboard = surface.handlers().keyboard;
		expect(keyboard?.shortcuts).toContain("+");
		keyboard?.nudge?.({ x: 1, y: 0 }, false);
		t.commit();
		expect(values([from, to])).toEqual([1, 11]);
		keyboard?.nudge?.({ x: -1, y: 0 }, true);
		t.commit();
		expect(from.peek()).toBeCloseTo(0.8, 9);
		expect(keyboard?.key?.(press("+"))).toBe(true);
		t.commit();
		expect(to.peek() - from.peek()).toBeCloseTo(8, 9);
		expect(keyboard?.key?.(press("-"))).toBe(true);
		t.commit();
		expect(to.peek() - from.peek()).toBeCloseTo(10, 9);
		expect(keyboard?.key?.(press("x"))).toBe(false);
		expect(keyboard?.key?.(press("0"))).toBe(true);
		expect([from.peek(), to.peek()]).toEqual([0, 20]);
		// A double tap resets too; the surface is one tab stop.
		from.set(3);
		surface.handlers().onDoubleTap?.({} as never);
		expect(from.peek()).toBe(0);
		expect(t.focusable()).toEqual(["zoomable plot"]);
	});

	it("without bounds, 0 is left alone; disabled, nothing is taken", () => {
		const from = track(0);
		const to = track(10);
		const zoom = chartZoom.create({ x: [from, to] });
		const t = stage(
			chart.create({
				width: 10,
				height: 4,
				xRange: range(from, to),
				yRange: [0, 1],
				children: [zoom],
			}),
		);
		const keyboard = () => t.find("zoomable plot").handlers().keyboard;
		expect(keyboard()?.key?.(press("0"))).toBe(false);
		zoom.set("disabled", true);
		t.commit();
		expect(keyboard()?.key?.(press("+"))).toBe(false);
		expect(t.focusable()).toEqual([]);
	});

	it("throws outside a chart or without tracks", () => {
		expect(() => stage(chartZoom.create({ x: [track(0), track(1)] }))).toThrow(
			/inside a chart/,
		);
		expect(() =>
			stage(
				chart.create({ width: 4, height: 4, children: [chartZoom.create({})] }),
			),
		).toThrow(/needs/);
	});
});

describe("chartLink", () => {
	it("fits linked charts' x to the union and shares one colour scale", () => {
		const a = chart.create({
			width: 6,
			height: 2,
			children: [
				scatter.create({
					data: [
						{ t: 0, v: 1, s: "p" },
						{ t: 4, v: 2, s: "p" },
					],
					x: "t",
					y: "v",
					series: "s",
				}),
			],
		});
		const b = chart.create({
			width: 6,
			height: 2,
			legend: false,
			children: [
				scatter.create({
					data: [
						{ t: 2, v: 10, s: "q" },
						{ t: 9, v: 20, s: "q" },
					],
					x: "t",
					y: "v",
					series: "s",
				}),
			],
		});
		stage(chartLink.create({ children: [a, b] }));
		const ha = chartHandle(a) as ChartHandle;
		const hb = chartHandle(b) as ChartHandle;
		expect(ha.coords.xRange()).toEqual(hb.coords.xRange());
		expect(
			Math.max(...(ha.coords.xRange().slice(0, 2) as number[])),
		).toBeGreaterThanOrEqual(9);
		// y is not linked by default.
		expect(ha.coords.yRange()).not.toEqual(hb.coords.yRange());
		expect(ha.color("q")).toBe(hb.color("q"));
		expect(ha.color("p")).not.toBe(ha.color("q"));
	});

	it("drives every member from one given range", () => {
		const lo = track(1);
		const members: SceneNode[] = [1, 2].map((i) =>
			chart.create({
				width: 6,
				height: 2,
				children: [
					scatter.create({
						data: i === 1 ? [1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1],
					}),
				],
			}),
		);
		const t = stage(
			chartLink.create({
				xRange: derive(lo, (value) => [value, 5] as [number, number]),
				children: members,
			}),
		);
		expect(
			chartHandle(members[0] as SceneNode)
				?.coords.xRange()
				.slice(0, 2),
		).toEqual([1, 5]);
		lo.set(3);
		t.commit();
		expect(
			chartHandle(members[1] as SceneNode)
				?.coords.xRange()
				.slice(0, 2),
		).toEqual([3, 5]);
	});

	it("leaves the group when a member goes, and the rest refit", () => {
		const wide = chart.create({
			width: 6,
			height: 2,
			children: [scatter.create({ data: [{ x: 100, y: 1 }], x: "x", y: "y" })],
		});
		const narrow = chart.create({
			width: 6,
			height: 2,
			children: [scatter.create({ data: [{ x: 1, y: 1 }], x: "x", y: "y" })],
		});
		const link = chartLink.create({ children: [narrow, wide] });
		const t = stage(link);
		expect(chartHandle(narrow)?.coords.xRange()[1]).toBeGreaterThanOrEqual(100);
		link.set("children", [narrow]);
		t.commit();
		expect(chartHandle(narrow)?.coords.xRange()[1]).toBeLessThan(100);
	});
});

describe("brushing and zoom over shared tracks", () => {
	it("zooms linked charts from one pair of tracks", () => {
		const from = track(10);
		const to = track(30);
		const low = track(-1);
		const high = track(1);
		const series = Array.from({ length: 60 }, (_, t) => ({
			t,
			v: Math.sin(t / 5),
		}));
		const detail = chart.create({
			width: 8,
			height: 3,
			yRange: range(low, high),
			clip: true,
			children: [
				chartZoom.create({
					x: [from, to],
					y: [low, high],
					bounds: { x: [0, 59] },
				}),
				scatter.create({ data: series, x: "t", y: "v" }),
			],
		});
		const t = stage(
			chartLink.create({ xRange: range(from, to), children: [detail] }),
			chart.create({
				width: 8,
				height: 2,
				children: [
					scatter.create({ data: series, x: "t", y: "v" }),
					rangeBrush.create({ x: [from, to], y: [low, high] }),
				],
			}),
		);
		const surface = t.find("zoomable plot").handlers();
		for (let i = 0; i < 8; i++) {
			// Alternate gestures: drag the zoom, then key it.
			surface.drag?.start(at(0, 0));
			surface.drag?.move(at(0.2 * (i % 3) + 0.1, 0.05));
			surface.drag?.end(at(0.2 * (i % 3) + 0.1, 0.05), false);
			surface.keyboard?.key?.(press(i % 2 ? "+" : "-"));
			t.commit();
		}
		expect(chartHandle(detail)?.coords.xRange()[0]).toBeCloseTo(from.peek(), 9);
	});
});
