/**
 * Zoom modes: zoom on band
 * (category) axes, the drag-a-box-to-zoom mode, the wheel resizing a
 * `rangeBrush`, zoom bounds and brush bodies on a log axis, and the
 * `chartZoom` toolbar.
 *
 * Gestures are driven the way the pointer driver and the accessibility
 * mirror deliver them (a node's `drag`, `keyboard` and `onWheel` handlers),
 * with `commit()` between events.
 */

import type { SceneNode } from "@sophistry/core";
import { derive, track } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { bars } from "../bars/bars";
import { chart, chartHandle } from "../chart";
import { linePlot } from "../curves/line-plot";
import type { ChartHandle } from "../frame/types";
import type { ChartZoomBox } from "./brush";
import {
	boxBrushDrags,
	brushDrags,
	brushWheel,
	chartZoomActions,
	chartZoomDrag,
} from "./brush";
import { brushedCategories, rangeBrush } from "./chart-link";
import type { ChartZoomDragMode } from "./chart-zoom";
import { chartZoom } from "./chart-zoom";
import { at, boxOf, press, stage, values, wheelAt } from "./test-utils";

type Cell = ReturnType<typeof track<number>>;
const range = (from: Cell, to: Cell) =>
	derive([from, to], (a, b) => [a, b] as [number, number]);
const sales = ["a", "b", "c", "d", "e", "f"].map((k, i) => ({ k, v: i + 1 }));

/** A chart handle that reads the node's latest frame. */
const handleOf = (node: SceneNode) => () => chartHandle(node) as ChartHandle;

describe("a window onto a band axis", () => {
	it("draws the categories inside an xRange", () => {
		const plot = chart.create({
			width: 6,
			height: 3,
			autosize: "pad",
			xRange: [1, 4],
			clip: true,
			children: [
				bars.create({ data: sales, category: "k", value: "v" } as never),
			],
		});
		const t = stage(plot);
		const handle = chartHandle(plot) as ChartHandle;
		// Still a band axis, over three of its six slots.
		expect(handle.xBand?.domain).toEqual(["a", "b", "c", "d", "e", "f"]);
		expect(handle.coords.xRange().slice(0, 2)).toEqual([1, 4]);
		const names = t
			.texts()
			.filter((s) => /^[a-f]$/.test(s.text) && s.style.opacity > 0)
			.map((s) => s.text);
		expect(names).toEqual(["b", "c", "d"]);
		// Two units a slot: b's middle (1.5) is drawn at the plot's left + 1.
		expect(t.texts().find((s) => s.text === "b")?.at.x).toBeCloseTo(-2, 6);
	});

	it("zooms, pans and resets in whole categories through chartZoom", () => {
		const from = track(0);
		const to = track(6);
		const t = stage(
			chart.create({
				width: 6,
				height: 3,
				autosize: "pad",
				xRange: range(from, to),
				yAxis: { visible: false },
				clip: true,
				children: [
					chartZoom.create({ x: [from, to] }),
					bars.create({ data: sales, category: "k", value: "v" } as never),
				],
			}),
		);
		const surface = t.find("zoomable plot").handlers();
		const keyboard = surface.keyboard;
		// The categories bound it: at all six, a pan or a zoom out goes nowhere.
		keyboard?.nudge?.({ x: 1, y: 0 }, false);
		keyboard?.key?.(press("-"));
		t.commit();
		expect(values([from, to])).toEqual([0, 6]);
		// + zooms about the middle on whole slots.
		keyboard?.key?.(press("+"));
		t.commit();
		expect(values([from, to])).toEqual([1, 5]);
		keyboard?.key?.(press("+"));
		t.commit();
		expect(to.peek() - from.peek()).toBe(3);
		expect(Number.isInteger(from.peek())).toBe(true);
		// An arrow pans one category even though its step is a tenth of the view.
		const before = from.peek();
		keyboard?.nudge?.({ x: -1, y: 0 }, false);
		t.commit();
		expect(from.peek()).toBe(before - 1);
		// The wheel is continuous: part of a slot is fine.
		surface.onWheel?.(wheelAt(0.3, 0, -60));
		t.commit();
		expect(Number.isInteger(from.peek())).toBe(false);
		// A drag settles on whole slots when it ends.
		surface.drag?.start(at(0, 0));
		surface.drag?.move(at(0.7, 0));
		surface.drag?.end(at(0.7, 0), false);
		t.commit();
		expect(Number.isInteger(from.peek())).toBe(true);
		expect(Number.isInteger(to.peek())).toBe(true);
		// No narrower than one category, and 0 returns to all of them.
		for (let i = 0; i < 8; i++) {
			keyboard?.key?.(press("+"));
			t.commit();
		}
		expect(to.peek() - from.peek()).toBe(1);
		expect(keyboard?.key?.(press("0"))).toBe(true);
		expect(values([from, to])).toEqual([0, 6]);
		expect(brushedCategories(["a", "b", "c", "d", "e", "f"], 2, 4)).toEqual([
			"c",
			"d",
		]);
	});

	it("`snap: false` leaves keyed band zooms fractional", () => {
		const from = track(0);
		const to = track(6);
		const t = stage(
			chart.create({
				width: 6,
				height: 3,
				xRange: range(from, to),
				children: [
					chartZoom.create({ x: [from, to], snap: false }),
					bars.create({ data: sales, category: "k", value: "v" } as never),
				],
			}),
		);
		t.find("zoomable plot").handlers().keyboard?.key?.(press("+"));
		t.commit();
		expect(to.peek() - from.peek()).toBeCloseTo(4.8, 9);
	});
});

describe("box zoom", () => {
	/** A 10 × 4 frame over [0, 10] × [0, 4]: one scene unit per data unit, x 0 at -5, y 0 at -2. */
	function zoomable(y = true) {
		const x = [track(0), track(10)] as const;
		const yy = [track(0), track(4)] as const;
		const plot = chart.create({
			width: 10,
			height: 4,
			autosize: "pad",
			xRange: range(x[0], x[1]),
			yRange: range(yy[0], yy[1]),
		});
		const t = stage(plot);
		const frame = handleOf(plot);
		const actions = chartZoomActions({
			coords: () => frame().coords,
			x,
			y: y ? yy : undefined,
			bounds: () => undefined,
			minSpan: () => undefined,
		});
		return { x, y: yy, actions, commit: t.commit };
	}

	it("zooms into the box it draws, reporting it while it is drawn", () => {
		const { x, y, actions, commit } = zoomable();
		const drawn: (ChartZoomBox | null)[] = [];
		const zooms: number[][] = [];
		const drag = chartZoomDrag(actions, () => true, {
			box: () => true,
			onBox: (box) => drawn.push(box),
			onZoom: (before) => zooms.push(before),
		});
		expect(drag.start(at(-3, -1))).toBe(true);
		drag.move(at(-2, 0));
		drag.move(at(1, 1));
		// Nothing zooms while the box is drawn.
		expect(values(x)).toEqual([0, 10]);
		expect(drawn.at(-1)).toEqual({
			a: { x: -3, y: -1 },
			b: { x: 1, y: 1 },
			x: true,
			y: true,
		});
		expect(drag.end(at(1, 1), false)).toBe(true);
		commit();
		expect(values(x)).toEqual([2, 6]);
		expect(values(y)).toEqual([1, 3]);
		expect(drawn.at(-1)).toBeNull();
		expect(zooms).toEqual([[0, 10, 0, 4]]);
	});

	it("a thin box zooms along its length only; a cancel or a tap zooms nothing", () => {
		const { x, y, actions, commit } = zoomable();
		const drag = chartZoomDrag(actions, () => true, { box: () => true });
		drag.start(at(-4, 0));
		drag.move(at(0, 0.03));
		drag.end(at(0, 0.03), false);
		commit();
		expect(values(x)).toEqual([1, 5]);
		expect(values(y)).toEqual([0, 4]);
		drag.start(at(-1, -1));
		drag.move(at(1, 1));
		expect(drag.end(at(1, 1), true)).toBe(true);
		drag.start(at(0, 0));
		expect(drag.end(at(0, 0), false)).toBe(false);
		commit();
		expect(values(x)).toEqual([1, 5]);
		expect(values(y)).toEqual([0, 4]);
	});

	it("a second finger turns the box into a pinch", () => {
		const { x, actions, commit } = zoomable(false);
		const boxes: (ChartZoomBox | null)[] = [];
		const drag = chartZoomDrag(actions, () => true, {
			box: () => true,
			onBox: (box) => boxes.push(box),
		});
		drag.start(at(-1, 0, 1));
		drag.move(at(-1.5, 0.5, 1));
		drag.start(at(1, 0, 2));
		expect(boxes.at(-1)).toBeNull();
		drag.move(at(3, 0, 2));
		commit();
		expect(x[1].peek() - x[0].peek()).toBeLessThan(10);
		drag.end(at(3, 0, 2), false);
		drag.end(at(-1.5, 0.5, 1), false);
	});

	it("Shift-drag draws a rubber band and zooms; Backspace steps back", () => {
		const from = track(0);
		const to = track(10);
		const low = track(0);
		const high = track(4);
		const t = stage(
			chart.create({
				width: 10,
				height: 4,
				autosize: "pad",
				xRange: range(from, to),
				yRange: range(low, high),
				children: [
					chartZoom.create({
						x: [from, to],
						y: [low, high],
						bounds: { x: [0, 10] },
					}),
				],
			}),
		);
		const surface = t.find("zoomable plot");
		expect(surface.handlers().keyboard?.shortcuts).toBe("+ - 0 Home Backspace");
		const drag = surface.handlers().drag;
		const dashed = () =>
			t
				.shapes()
				.filter((s) => s.style.dash !== null && s.style.dash !== undefined);
		// A plain drag pans.
		drag?.start(at(0, 0));
		drag?.move(at(1, 0));
		drag?.end(at(1, 0), false);
		t.commit();
		expect(values([from, to])).toEqual([0, 10]);
		// Shift: a box, drawn while dragging.
		drag?.start(at(-3, -1, 1, true));
		drag?.move(at(1, 1, 1, true));
		t.commit();
		expect(dashed()).toHaveLength(1);
		drag?.end(at(1, 1, 1, true), false);
		t.commit();
		expect(dashed()).toHaveLength(0);
		expect(values([from, to])).toEqual([2, 6]);
		expect(values([low, high])).toEqual([1, 3]);
		// Backspace steps back out of it; with nothing left it is not taken.
		expect(surface.handlers().keyboard?.key?.(press("Backspace"))).toBe(true);
		expect(values([from, to])).toEqual([0, 10]);
		expect(values([low, high])).toEqual([0, 4]);
		expect(surface.handlers().keyboard?.key?.(press("Backspace"))).toBe(false);
	});

	it('dragMode "box" boxes on a plain drag and pans with Shift; boxZoom false never boxes', () => {
		const from = track(0);
		const to = track(10);
		const t = stage(
			chart.create({
				width: 10,
				height: 4,
				autosize: "pad",
				xRange: range(from, to),
				children: [
					chartZoom.create({ x: [from, to], dragMode: "box", label: "boxes" }),
				],
			}),
			chart.create({
				width: 10,
				height: 4,
				autosize: "pad",
				xRange: range(from, to),
				children: [
					chartZoom.create({ x: [from, to], boxZoom: false, label: "pans" }),
				],
			}),
		);
		const boxes = t.find("boxes");
		expect(boxes.cursor()).toBe("crosshair");
		const drag = boxes.handlers().drag;
		drag?.start(at(-4, 0));
		drag?.move(at(0, 0));
		drag?.end(at(0, 0), false);
		t.commit();
		expect(values([from, to])).toEqual([1, 5]);
		drag?.start(at(0, 0, 1, true));
		drag?.move(at(1, 0, 1, true));
		drag?.end(at(1, 0, 1, true), false);
		t.commit();
		expect(from.peek()).toBeCloseTo(0.6, 9);
		const pans = t.find("pans");
		expect(pans.handlers().keyboard?.shortcuts).toBe("+ - 0 Home");
		from.set(0);
		to.set(10);
		t.commit();
		pans.handlers().drag?.start(at(0, 0, 1, true));
		pans.handlers().drag?.move(at(1, 0, 1, true));
		pans.handlers().drag?.end(at(1, 0, 1, true), false);
		t.commit();
		expect(values([from, to])).toEqual([-1, 9]);
	});

	it("boxes on a band axis select whole categories", () => {
		const from = track(0);
		const to = track(6);
		const t = stage(
			chart.create({
				width: 6,
				height: 3,
				autosize: "pad",
				xRange: range(from, to),
				children: [
					chartZoom.create({ x: [from, to], dragMode: "box" }),
					bars.create({ data: sales, category: "k", value: "v" } as never),
				],
			}),
		);
		const drag = t.find("zoomable plot").handlers().drag;
		// Slot edge i is at i - 3: from b's middle-ish to d's.
		drag?.start(at(-1.6, 0));
		drag?.move(at(0.4, 0));
		drag?.end(at(0.4, 0), false);
		t.commit();
		expect(values([from, to])).toEqual([1, 3]);
	});
});

describe("zoom bounds on a log axis", () => {
	it("a pan that meets a bound slides by decades, keeping the ratio", () => {
		const x = [track(1), track(100)] as const;
		const plot = chart.create({
			width: 10,
			height: 4,
			autosize: "pad",
			xRange: range(x[0], x[1]),
			yRange: [0, 1],
			xAxis: { scale: "log" },
		});
		const t = stage(plot);
		const frame = handleOf(plot);
		const actions = chartZoomActions({
			coords: () => frame().coords,
			x,
			bounds: () => [1, 1000],
			minSpan: () => undefined,
		});
		// Two plot widths left: four decades right, stopped at 1000.
		actions.panBy({ x: -20, y: 0 });
		t.commit();
		expect(values(x)).toEqual([10, 1000]);
		actions.panBy({ x: 40, y: 0 });
		t.commit();
		expect(values(x)).toEqual([1, 100]);
		// Out past the bounds: the bounds.
		actions.zoomAbout({ x: 0, y: 0 }, 4);
		t.commit();
		expect(values(x)).toEqual([1, 1000]);
	});
});

describe("a brush body on a log axis", () => {
	/** x log over [1, 1000] on a 10-unit plot (-5..5): a decade is 10/3 units. */
	function logFrame() {
		const plot = chart.create({
			width: 10,
			height: 10,
			autosize: "pad",
			xRange: [1, 1000],
			yRange: [0, 10],
			xAxis: { scale: "log" },
		});
		stage(plot);
		return handleOf(plot);
	}
	const DECADE = 10 / 3;

	it("slides by ratio, keeping its drawn width, and lands exactly on the frame's ends", () => {
		const frame = logFrame();
		const from = track(10);
		const to = track(100);
		const g = brushDrags({
			coords: () => frame().coords,
			from,
			to,
			vertical: () => false,
			bounds: () => undefined,
			minSpan: () => undefined,
			disabled: () => false,
		});
		const body = g.drag.body;
		// Grab the body at 30 (about the middle of its decade).
		const grab = frame().coords.coordsToPoint(30, 5).x;
		body.drag.start(at(grab, 0));
		body.drag.move(at(grab + DECADE, 0));
		// One decade right: 100..1000, not 100..190.
		expect(values([from, to])).toEqual([100, 1000]);
		// Past the frame's end: held there, the end on it exactly.
		body.drag.move(at(grab + 3 * DECADE, 0));
		expect(to.peek()).toBe(1000);
		expect(values([from, to])).toEqual([100, 1000]);
		// Two decades back, past the start: 1..10.
		body.drag.move(at(grab - 3 * DECADE, 0));
		expect(from.peek()).toBe(1);
		expect(values([from, to])).toEqual([1, 10]);
		body.drag.end(at(grab - 3 * DECADE, 0), false);
		// The arrow key's step is a drawn distance too: the ratio holds.
		body.keyboard.nudge({ x: 1, y: 0 }, false);
		expect(to.peek() / from.peek()).toBeCloseTo(10, 9);
		expect(from.peek()).toBeGreaterThan(1);
	});

	it("a box brush keeps the ratio on its log axis and the value span on its linear one", () => {
		const frame = logFrame();
		const x = [track(10), track(100)] as const;
		const y = [track(2), track(4)] as const;
		const axis = (along: "x" | "y", pair: readonly [Cell, Cell]) => ({
			axis: along,
			from: pair[0],
			to: pair[1],
			bounds: () => undefined,
			minSpan: () => undefined,
			snap: () => false,
		});
		const g = boxBrushDrags({
			coords: () => frame().coords,
			x: axis("x", x),
			y: axis("y", y),
			disabled: () => false,
		});
		const start = frame().coords.coordsToPoint(30, 3);
		g.body.drag.start(at(start.x, start.y));
		const moved = { x: start.x + DECADE, y: start.y + 1 };
		g.body.drag.move(at(moved.x, moved.y));
		expect(values(x)).toEqual([100, 1000]);
		expect(values(y)).toEqual([3, 5]);
		g.body.drag.end(at(moved.x, moved.y), false);
	});

	it("bounds are met in the axis's own space as well", () => {
		const frame = logFrame();
		const from = track(2);
		const to = track(20);
		const g = brushDrags({
			coords: () => frame().coords,
			from,
			to,
			vertical: () => false,
			bounds: () => [1, 500],
			minSpan: () => undefined,
			disabled: () => false,
		});
		const grab = frame().coords.coordsToPoint(5, 5).x;
		g.drag.body.drag.start(at(grab, 0));
		g.drag.body.drag.move(at(grab + 4 * DECADE, 0));
		expect(to.peek()).toBe(500);
		expect(from.peek()).toBeCloseTo(50, 9);
	});
});

describe("the wheel on a rangeBrush", () => {
	function unitFrame() {
		const plot = chart.create({
			width: 10,
			height: 10,
			autosize: "pad",
			xRange: [0, 10],
			yRange: [0, 10],
		});
		stage(plot);
		return handleOf(plot);
	}
	const axis = (
		along: "x" | "y",
		from: Cell,
		to: Cell,
		minSpan = 1,
		snap = false,
	) => ({
		axis: along,
		from,
		to,
		bounds: () => undefined,
		minSpan: () => minSpan,
		snap: () => snap,
	});

	it("grows (wheel down) and shrinks about the cursor, inside the frame and minSpan", () => {
		const frame = unitFrame();
		const from = track(2);
		const to = track(6);
		const wheel = brushWheel({
			coords: () => frame().coords,
			axes: [axis("x", from, to)],
		});
		// The cursor at value 4 (x = -1): both ends move away from it.
		expect(wheel(wheelAt(-1, 0, 100))).toBe(true);
		const k = Math.exp(0.2);
		expect(from.peek()).toBeCloseTo(4 - 2 * k, 9);
		expect(to.peek()).toBeCloseTo(4 + 2 * k, 9);
		// Far out: clamped to the frame.
		for (let i = 0; i < 20; i++) wheel(wheelAt(-1, 0, 100));
		expect(values([from, to])).toEqual([0, 10]);
		// Far in: no narrower than minSpan, about the cursor.
		for (let i = 0; i < 40; i++) wheel(wheelAt(-1, 0, -100));
		expect(to.peek() - from.peek()).toBeCloseTo(1, 9);
		expect((from.peek() + to.peek()) / 2).toBeCloseTo(4, 9);
	});

	it("resizes a box brush on both axes, and a band brush a category at a time", () => {
		const frame = unitFrame();
		const x = [track(2), track(4)] as const;
		const y = [track(2), track(4)] as const;
		brushWheel({
			coords: () => frame().coords,
			axes: [axis("x", ...x), axis("y", ...y)],
		})(wheelAt(-2, -2, 100));
		expect(x[1].peek() - x[0].peek()).toBeCloseTo(2 * Math.exp(0.2), 9);
		expect(y[1].peek() - y[0].peek()).toBeCloseTo(2 * Math.exp(0.2), 9);
		const from = track(2);
		const to = track(4);
		const snapped = brushWheel({
			coords: () => frame().coords,
			axes: [axis("x", from, to, 1, true)],
		});
		// One small notch is not a category yet; they add up.
		snapped(wheelAt(-2, 0, 30));
		expect(values([from, to])).toEqual([2, 4]);
		for (let i = 0; i < 6; i++) snapped(wheelAt(-2, 0, 30));
		expect(Number.isInteger(from.peek())).toBe(true);
		expect(Number.isInteger(to.peek())).toBe(true);
		expect(to.peek() - from.peek()).toBeGreaterThan(2);
	});

	it("is opt-in on rangeBrush, and disabled takes nothing", () => {
		const from = track(2);
		const to = track(6);
		const brushChart = (extra: Record<string, unknown>) =>
			chart.create({
				width: 10,
				height: 2,
				xRange: [0, 10],
				children: [rangeBrush.create({ from, to, ...extra })],
			});
		const t = stage(
			brushChart({ wheel: true, label: "wheeled" }),
			brushChart({ label: "plain" }),
			brushChart({ wheel: true, disabled: true, label: "off" }),
		);
		expect(t.find("plain").handlers().onWheel).toBeUndefined();
		expect(
			t
				.find("off")
				.handlers()
				.onWheel?.(wheelAt(0, 0, 100)),
		).toBe(false);
		expect(values([from, to])).toEqual([2, 6]);
		expect(
			t
				.find("wheeled")
				.handlers()
				.onWheel?.(wheelAt(-1, 0, 100)),
		).toBe(true);
		expect(to.peek() - from.peek()).toBeGreaterThan(4);
		// The edges take it too, so the wheel never falls through a handle.
		expect(t.find("wheeled end").handlers().onWheel).toBeDefined();
	});
});

describe("the chartZoom toolbar", () => {
	const line = Array.from({ length: 11 }, (_, t) => ({ t, v: t % 3 }));
	/** An 8 × 3 plot (-4..4 by -1.5..1.5) over x 0..10: 0.8 units a value. */
	function zoomable(zoom: (from: Cell, to: Cell) => SceneNode) {
		const from = track(0);
		const to = track(10);
		const t = stage(
			chart.create({
				width: 8,
				height: 3,
				autosize: "pad",
				xRange: range(from, to),
				yRange: [0, 2],
				children: [
					zoom(from, to),
					linePlot.create({ data: line, x: "t", y: "v" } as never),
				],
			}),
		);
		const labels = () => {
			t.commit();
			return t.registry.records().map((r) => r.label());
		};
		return { ...t, from, to, labels };
	}

	it("Pan and Box toggle the drag mode (pressed states), and Reset returns to the bounds", () => {
		const t = zoomable((from, to) =>
			chartZoom.create({ x: [from, to], bounds: [0, 10], toolbar: true }),
		);
		const pan = () => t.find("Pan");
		const box = () => t.find("Box zoom");
		const reset = t.find("Reset zoom");
		expect([pan().pressed?.(), box().pressed?.(), reset.pressed?.()]).toEqual([
			true,
			false,
			null,
		]);
		box().handlers().onTap?.(at(0, 0));
		t.commit();
		expect([pan().pressed?.(), box().pressed?.()]).toEqual([false, true]);
		// A plain drag now draws a box: 2.5..5.
		const drag = t.find("zoomable plot").handlers().drag;
		drag?.start(at(-2, 0));
		drag?.move(at(0, 0.5));
		t.commit();
		drag?.end(at(0, 0.5), false);
		t.commit();
		expect(values([t.from, t.to])).toEqual([2.5, 5]);
		// Shift still swaps: a Shift-drag pans in box mode.
		drag?.start(at(0, 0, 1, true));
		drag?.move(at(0.8, 0, 1, true));
		drag?.end(at(0.8, 0, 1, true), false);
		t.commit();
		expect(values([t.from, t.to])).toEqual([2.25, 4.75]);
		t.find("Reset zoom").handlers().onTap?.(at(0, 0));
		t.commit();
		expect(values([t.from, t.to])).toEqual([0, 10]);
		pan().handlers().onTap?.(at(0, 0));
		t.commit();
		expect([pan().pressed?.(), box().pressed?.()]).toEqual([true, false]);
	});

	it("sits inside the plot's corner, over the marks and under a tooltip", () => {
		const t = zoomable((from, to) =>
			chartZoom.create({ x: [from, to], bounds: [0, 10], toolbar: true }),
		);
		const buttons = t.shapes().filter((s) => s.zIndex === 998);
		expect(buttons).toHaveLength(3);
		for (const spec of buttons) {
			const b = boxOf(spec);
			expect(b.maxX).toBeLessThanOrEqual(4 + 1e-9);
			expect(b.minX).toBeGreaterThan(0);
			expect(b.maxY).toBeLessThanOrEqual(1.5 + 1e-9);
			expect(b.minY).toBeGreaterThan(0.5);
		}
		const bottomLeft = zoomable((from, to) =>
			chartZoom.create({
				x: [from, to],
				bounds: [0, 10],
				toolbar: { corner: "bottom-left" },
			}),
		);
		for (const spec of bottomLeft.shapes().filter((s) => s.zIndex === 998)) {
			const b = boxOf(spec);
			expect(b.minX).toBeGreaterThanOrEqual(-4 - 1e-9);
			expect(b.maxY).toBeLessThan(-0.5);
		}
	});

	it("shows only what applies: no modes without a box zoom, no Reset without bounds, nothing by default", () => {
		const plain = zoomable((from, to) =>
			chartZoom.create({ x: [from, to], bounds: [0, 10] }),
		);
		expect(plain.labels()).not.toContain("Pan");
		const noBox = zoomable((from, to) =>
			chartZoom.create({
				x: [from, to],
				bounds: [0, 10],
				boxZoom: false,
				toolbar: true,
			}),
		);
		expect(noBox.labels()).toContain("Reset zoom");
		expect(noBox.labels()).not.toContain("Pan");
		const unbounded = zoomable((from, to) =>
			chartZoom.create({ x: [from, to], toolbar: true }),
		);
		expect(unbounded.labels()).toContain("Box zoom");
		expect(unbounded.labels()).not.toContain("Reset zoom");
	});

	it("is controlled with onDragModeChange, and a later dragMode wins over its own choice", () => {
		const asked: ChartZoomDragMode[] = [];
		let controlledZoom: SceneNode | null = null;
		const controlled = zoomable((from, to) => {
			controlledZoom = chartZoom.create({
				x: [from, to],
				toolbar: true,
				dragMode: "pan",
				onDragModeChange: (m: ChartZoomDragMode) => asked.push(m),
			});
			return controlledZoom;
		});
		controlled.find("Box zoom").handlers().onTap?.(at(0, 0));
		controlled.commit();
		// Asked, but the mode is the prop's until it changes.
		expect(asked).toEqual(["box"]);
		expect(controlled.find("Box zoom").pressed?.()).toBe(false);
		(controlledZoom as unknown as SceneNode).set(
			"dragMode" as never,
			"box" as never,
		);
		controlled.commit();
		expect(controlled.find("Box zoom").pressed?.()).toBe(true);

		let ownZoom: SceneNode | null = null;
		const own = zoomable((from, to) => {
			ownZoom = chartZoom.create({
				x: [from, to],
				toolbar: true,
				dragMode: "pan",
			});
			return ownZoom;
		});
		own.find("Box zoom").handlers().onTap?.(at(0, 0));
		own.commit();
		expect(own.find("Box zoom").pressed?.()).toBe(true);
		(ownZoom as unknown as SceneNode).set("dragMode" as never, "box" as never);
		own.commit();
		(ownZoom as unknown as SceneNode).set("dragMode" as never, "pan" as never);
		own.commit();
		expect(own.find("Pan").pressed?.()).toBe(true);
	});
});
