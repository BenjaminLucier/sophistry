// @vitest-environment happy-dom
/**
 * Chart interaction through a mounted scene: real wheel and pointer events on the
 * canvas reach `chartZoom` and `rangeBrush` through the pointer driver, and
 * real key presses on the accessibility mirror reach their keys.
 *
 * happy-dom has no 2D context and lays nothing out, so (`test-dom.ts`)
 * `getContext` is stubbed, every box is 1000 × 500 CSS px, and animation
 * frames are run by hand. A 10-unit scene is then 100 px per unit with the
 * origin at (500, 250).
 */

import type { Scene, SceneNode } from "@sophistry/core";
import { createScene, derive, track } from "@sophistry/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bars } from "../bars/bars.js";
import { chart, chartHandle } from "../chart.js";
import { linePlot } from "../curves/line-plot.js";
import { rangeBrush } from "./chart-link.js";
import { chartZoom } from "./chart-zoom.js";
import type { DomHarness } from "./test-dom.js";
import { installDom, mountPoint } from "./test-dom.js";

let dom: DomHarness;
const scenes: Scene[] = [];

beforeEach(() => {
	dom = installDom({ width: 1000, height: 500 });
});

afterEach(() => {
	for (const scene of scenes.splice(0)) scene.dispose();
	dom.restore();
});

type Cell = ReturnType<typeof track<number>>;
const range = (from: Cell, to: Cell) =>
	derive([from, to], (a, b) => [a, b] as [number, number]);
const series = Array.from({ length: 11 }, (_, t) => ({ t, v: t % 3 }));

/** Mounts `nodes` on a 10-unit scene and runs its first frames. */
function mount(...nodes: SceneNode[]) {
	const host = mountPoint();
	const scene = createScene({ host, units: 10 });
	scenes.push(scene);
	for (const node of nodes) scene.add(node);
	dom.drain();
	const canvas = scene.canvas as HTMLCanvasElement;
	return { host, scene, canvas };
}

const paint = () => dom.drain();

const mirror = (host: HTMLElement, label: string) => {
	const found = [
		...host.querySelectorAll<HTMLElement>("[data-vis-focus]"),
	].find((el) => el.getAttribute("aria-label") === label);
	if (!found) throw new Error(`no mirror labelled ${label}`);
	return found;
};
const key = (el: HTMLElement, name: string) => {
	const event = new KeyboardEvent("keydown", {
		key: name,
		bubbles: true,
		cancelable: true,
	});
	el.dispatchEvent(event);
	return event;
};

/** A real wheel on the canvas at CSS pixel (x, y). */
const wheelOn = (
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number,
	deltaY: number,
) => {
	const event = new WheelEvent("wheel", { deltaY, cancelable: true });
	// happy-dom's WheelEvent carries no pointer position of its own.
	Object.defineProperties(event, {
		clientX: { value: clientX },
		clientY: { value: clientY },
	});
	canvas.dispatchEvent(event);
	return event;
};

/** A real mouse pointer event on the canvas at CSS pixel (x, y). */
const pointerOn = (
	canvas: HTMLCanvasElement,
	type: string,
	clientX: number,
	clientY: number,
	shiftKey = false,
) => {
	const event = new PointerEvent(type, {
		pointerId: 1,
		pointerType: "mouse",
		button: 0,
		clientX,
		clientY,
		shiftKey,
		bubbles: true,
		cancelable: true,
	});
	canvas.dispatchEvent(event);
	return event;
};

/** An 8 × 3 plot over x 0..10 with a zoom on x, bounded to 0..10. */
function zoomed(extra: Record<string, unknown> = {}) {
	const from = track(0);
	const to = track(10);
	const plot = chart.create({
		width: 8,
		height: 3,
		autosize: "pad",
		xRange: range(from, to),
		yRange: [0, 2],
		children: [
			chartZoom.create({ x: [from, to], bounds: [0, 10], ...extra }),
			linePlot.create({ data: series, x: "t", y: "v" } as never),
		],
	});
	return { ...mount(plot), from, to, plot };
}

describe("chartZoom in a scene", () => {
	it("zooms with the wheel about the cursor, and leaves wheels off the plot alone", () => {
		const { canvas, from, to } = zoomed();
		// At the plot's middle (value 5): in by e^-0.2, 5 staying put.
		const event = wheelOn(canvas, 500, 250, -100);
		expect(event.defaultPrevented).toBe(true);
		const span = to.peek() - from.peek();
		expect(span).toBeCloseTo(10 * Math.exp(-0.2), 9);
		expect((from.peek() + to.peek()) / 2).toBeCloseTo(5, 9);
		paint();
		// Outside the plot (above it): untouched, and the page keeps the wheel.
		const outside = wheelOn(canvas, 500, 20, -100);
		expect(outside.defaultPrevented).toBe(false);
		expect(to.peek() - from.peek()).toBeCloseTo(span, 9);
	});

	it("pans with a pointer drag on the plot", () => {
		const { canvas, from, to } = zoomed();
		// Zoom in first, so the bounds leave room to pan.
		from.set(2);
		to.set(6);
		paint();
		pointerOn(canvas, "pointerdown", 500, 250);
		// 100 px is one scene unit; the plot is 8 units over a span of 4.
		pointerOn(canvas, "pointermove", 600, 250);
		pointerOn(canvas, "pointerup", 600, 250);
		expect(from.peek()).toBeCloseTo(1.5, 9);
		expect(to.peek()).toBeCloseTo(5.5, 9);
	});

	it("Escape on the plot cancels a pan in flight, putting the range back", () => {
		const { host, canvas, from, to } = zoomed();
		from.set(2);
		to.set(6);
		paint();
		pointerOn(canvas, "pointerdown", 500, 250);
		pointerOn(canvas, "pointermove", 600, 250);
		expect(from.peek()).toBeCloseTo(1.5, 9);
		paint();
		const event = key(mirror(host, "zoomable plot"), "Escape");
		expect([from.peek(), to.peek()]).toEqual([2, 6]);
		// The cancel is the whole of that press: nothing else took it.
		expect(event.defaultPrevented).toBe(false);
		pointerOn(canvas, "pointerup", 600, 250);
		expect([from.peek(), to.peek()]).toEqual([2, 6]);
	});

	it("is a tab stop that takes + and the arrows, advertised to assistive technology", () => {
		const { host, from, to } = zoomed();
		const plot = mirror(host, "zoomable plot");
		expect(plot.getAttribute("aria-keyshortcuts")).toBe(
			"ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 Home Backspace",
		);
		expect(key(plot, "+").defaultPrevented).toBe(true);
		expect(to.peek() - from.peek()).toBeCloseTo(8, 9);
		key(plot, "ArrowRight");
		expect(from.peek()).toBeCloseTo(1.8, 9);
		// A key the plot does not take is left to the page.
		expect(key(plot, "q").defaultPrevented).toBe(false);
		key(plot, "Home");
		expect([from.peek(), to.peek()]).toEqual([0, 10]);
	});
});

describe("a brush on a log axis, in a scene", () => {
	it("a body drag slides it by ratio: one decade over, one decade across", () => {
		const lo = track(10);
		const hi = track(100);
		const { host, canvas } = mount(
			chart.create({
				width: 8,
				height: 3,
				autosize: "pad",
				xRange: [1, 1000],
				yRange: [0, 2],
				xAxis: { scale: "log" },
				children: [
					linePlot.create({
						data: [
							{ t: 1, v: 0 },
							{ t: 1000, v: 2 },
						],
						x: "t",
						y: "v",
					} as never),
					rangeBrush.create({ from: lo, to: hi }),
				],
			}),
		);
		// The plot spans CSS px 100..900, a decade every 800/3 px: the brush is 366.7..633.3.
		const decade = 800 / 3;
		pointerOn(canvas, "pointerdown", 500, 250);
		pointerOn(canvas, "pointermove", 520, 250);
		pointerOn(canvas, "pointermove", 500 + decade, 250);
		pointerOn(canvas, "pointerup", 500 + decade, 250);
		expect(lo.peek()).toBeCloseTo(100, 6);
		expect(hi.peek()).toBe(1000);
		paint();
		// The body's arrow keys keep the ratio too.
		key(mirror(host, "selected range"), "ArrowLeft");
		expect(hi.peek() / lo.peek()).toBeCloseTo(10, 9);
		expect(hi.peek()).toBeLessThan(1000);
	});
});

describe("box zoom in a scene", () => {
	it("Shift-drag zooms into the box; Backspace steps back out", () => {
		const { host, canvas, from, to } = zoomed();
		// The plot spans CSS px 100..900: value v is at 100 + 80 v.
		pointerOn(canvas, "pointerdown", 260, 220, true);
		pointerOn(canvas, "pointermove", 420, 260, true);
		pointerOn(canvas, "pointermove", 580, 300, true);
		// Nothing zooms until the release.
		expect([from.peek(), to.peek()]).toEqual([0, 10]);
		pointerOn(canvas, "pointerup", 580, 300, true);
		expect(from.peek()).toBeCloseTo(2, 9);
		expect(to.peek()).toBeCloseTo(6, 9);
		paint();
		const plot = mirror(host, "zoomable plot");
		expect(plot.getAttribute("aria-keyshortcuts")).toContain("Backspace");
		expect(key(plot, "Backspace").defaultPrevented).toBe(true);
		expect([from.peek(), to.peek()]).toEqual([0, 10]);
	});

	it("Escape cancels a box in flight", () => {
		const { host, canvas, from, to } = zoomed();
		const down = pointerOn(canvas, "pointerdown", 260, 250, true);
		// The press focuses the plot's mirror and keeps the browser's mousedown
		// from taking focus back to the page, so the keys reach the plot.
		expect(down.defaultPrevented).toBe(true);
		paint();
		expect(document.activeElement).toBe(mirror(host, "zoomable plot"));
		pointerOn(canvas, "pointermove", 580, 250, true);
		paint();
		key(mirror(host, "zoomable plot"), "Escape");
		pointerOn(canvas, "pointerup", 580, 250, true);
		expect([from.peek(), to.peek()]).toEqual([0, 10]);
	});
});

describe("the chartZoom toolbar in a scene", () => {
	it("a click on Box makes a plain drag zoom; the modes report aria-pressed; Enter on Reset resets", () => {
		const { host, canvas, from, to } = zoomed({ toolbar: true });
		const pan = mirror(host, "Pan");
		const box = mirror(host, "Box zoom");
		const reset = mirror(host, "Reset zoom");
		expect(pan.getAttribute("aria-pressed")).toBe("true");
		expect(box.getAttribute("aria-pressed")).toBe("false");
		expect(reset.hasAttribute("aria-pressed")).toBe(false);
		// Click the Box button where its mirror sits, over the plot's top right.
		const middle = (el: HTMLElement) => ({
			x:
				Number.parseFloat(el.style.left) +
				Number.parseFloat(el.style.width) / 2,
			y:
				Number.parseFloat(el.style.top) +
				Number.parseFloat(el.style.height) / 2,
		});
		const at = middle(box);
		expect(at.x).toBeGreaterThan(500);
		expect(at.y).toBeLessThan(250);
		pointerOn(canvas, "pointerdown", at.x, at.y);
		pointerOn(canvas, "pointerup", at.x, at.y);
		paint();
		expect(mirror(host, "Box zoom").getAttribute("aria-pressed")).toBe("true");
		expect(mirror(host, "Pan").getAttribute("aria-pressed")).toBe("false");
		expect([from.peek(), to.peek()]).toEqual([0, 10]);
		// A plain drag (no Shift) now zooms into the box: 2..4.
		pointerOn(canvas, "pointerdown", 260, 250);
		pointerOn(canvas, "pointermove", 340, 280);
		pointerOn(canvas, "pointermove", 420, 280);
		pointerOn(canvas, "pointerup", 420, 280);
		expect(from.peek()).toBeCloseTo(2, 9);
		expect(to.peek()).toBeCloseTo(4, 9);
		paint();
		// Enter on Reset, from the keyboard.
		expect(key(mirror(host, "Reset zoom"), "Enter").defaultPrevented).toBe(
			true,
		);
		expect([from.peek(), to.peek()]).toEqual([0, 10]);
	});
});

describe("band-axis zoom in a scene", () => {
	it("an arrow key moves the window one category; the wheel zooms it", () => {
		const from = track(0);
		const to = track(4);
		const days = Array.from({ length: 12 }, (_, i) => ({
			day: `d${i}`,
			v: (i % 4) + 1,
		}));
		const plot = chart.create({
			width: 8,
			height: 3,
			autosize: "pad",
			xRange: range(from, to),
			clip: true,
			children: [
				chartZoom.create({ x: [from, to] }),
				bars.create({ data: days, category: "day", value: "v" } as never),
			],
		});
		const { host, canvas } = mount(plot);
		const surface = mirror(host, "zoomable plot");
		key(surface, "ArrowRight");
		expect([from.peek(), to.peek()]).toEqual([1, 5]);
		paint();
		expect(chartHandle(plot)?.coords.xRange().slice(0, 2)).toEqual([1, 5]);
		wheelOn(canvas, 500, 250, 100);
		expect(to.peek() - from.peek()).toBeCloseTo(4 * Math.exp(0.2), 9);
		key(surface, "0");
		expect([from.peek(), to.peek()]).toEqual([0, 12]);
	});
});
