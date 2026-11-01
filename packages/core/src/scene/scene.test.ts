// @vitest-environment happy-dom
/**
 * `createScene` end to end: the DOM it builds, the whole pipeline (nodes,
 * graph commit, renderer) painting through the scene's view matrix, framing,
 * theme and background, cameras, headless scenes, the idle cost and disposal.
 *
 *
 * happy-dom has no 2D context, so `getContext` is a recorder and frames are
 * run by hand (`test-dom.ts`). What is asserted is the sequence of calls the
 * canvas received: the painted order and the transform it was painted under.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BLUE, parseColor, toCss } from "../color/index.js";
import { track } from "../reactive/index.js";
import { rect } from "../shapes/rect.js";
import { resolveTheme } from "../themes/theme.js";
import { stepFrame } from "../tween/frame-loop.js";
import { frameContext, themeContext } from "./context.js";
import type { Scene } from "./scene.js";
import { createScene, pointerDriver, sceneInternals } from "./scene.js";
import type { Call, DomHarness } from "./test-dom.js";
import { installDom, mountPoint, paintedXs } from "./test-dom.js";

let dom: DomHarness;
const scenes: Scene[] = [];

beforeEach(() => {
	dom = installDom({ width: 1000, height: 500 });
});

afterEach(() => {
	for (const scene of scenes.splice(0)) scene.dispose();
	dom.restore();
});

/** A scene mounted into a fresh element, disposed after the test. */
function mount(options: Parameters<typeof createScene>[0] = {}): Scene {
	const scene = createScene({ host: mountPoint(), ...options });
	scenes.push(scene);
	return scene;
}

/** Runs the queued frames and returns the canvas calls they made. */
function paint(): Call[] {
	dom.takeCalls();
	dom.drain();
	return dom.takeCalls();
}

const unitRect = (x: number, extra: Record<string, unknown> = {}) =>
	rect.create({ center: { x, y: 0 }, width: 1, height: 1, ...extra });

/** The scale of each non-identity view matrix installed, in order. */
const viewScales = (made: Call[]) =>
	made
		.filter(
			(call) =>
				call.op === "setTransform" &&
				(call.args as number[])[0] !== 1 &&
				(call.args as number[])[0] !== 0,
		)
		.map((call) => (call.args as number[])[0] as number);

const fills = (made: Call[]) => made.filter((call) => call.op === "fillRect");
const fillStyles = (made: Call[]) =>
	made
		.filter((call) => call.op === "set:fillStyle")
		.map((call) => call.args[0]);

describe("the DOM a scene builds", () => {
	it("creates a positioned box holding one hidden canvas inside the host", () => {
		const host = mountPoint();
		const scene = createScene({ host });
		scenes.push(scene);
		const box = scene.element as HTMLElement;
		expect(box.parentElement).toBe(host);
		expect(box.tagName).toBe("DIV");
		expect(box.className).toBe("w-full overflow-hidden rounded-xl");
		expect(box.style.position).toBe("relative");
		expect(box.style.width).toBe("100%");
		expect(box.style.overflow).toBe("hidden");
		expect(box.querySelectorAll("canvas").length).toBe(1);
		const canvas = scene.canvas as HTMLCanvasElement;
		expect(canvas.parentElement).toBe(box);
		expect(canvas.getAttribute("aria-hidden")).toBe("true");
		expect(canvas.style.width).toBe("100%");
		expect(canvas.style.height).toBe("100%");
	});

	it("sizes the backing store to the box times devicePixelRatio, clamped to 16384", () => {
		window.devicePixelRatio = 2;
		const scene = mount();
		expect(scene.size.peek()).toEqual({ width: 2000, height: 1000 });
		expect(scene.dpr.peek()).toBe(2);
		expect(scene.canvas?.width).toBe(2000);
		dom.setRect(20000, 10);
		dom.resizes[0]?.callback([]);
		expect(scene.size.peek()).toEqual({ width: 16384, height: 20 });
		// The backing store follows in the next frame's commit, right before its paint.
		paint();
		expect(scene.canvas?.width).toBe(16384);
	});

	it("uses a given canvas and observes its parent", () => {
		const parent = mountPoint();
		const canvas = document.createElement("canvas");
		parent.append(canvas);
		const scene = createScene({ canvas });
		scenes.push(scene);
		expect(scene.canvas).toBe(canvas);
		expect(scene.element).toBe(parent);
		expect(dom.resizes[0]?.targets).toEqual([parent]);
		scene.dispose();
		// A canvas it did not create stays where it was.
		expect(canvas.parentElement).toBe(parent);
	});

	it("re-measures when the devicePixelRatio changes, re-arming the query", () => {
		const queries: { query: string; listeners: Set<() => void> }[] = [];
		window.matchMedia = ((query: string) => {
			const entry = { query, listeners: new Set<() => void>() };
			queries.push(entry);
			return {
				matches: false,
				addEventListener: (_: string, listener: () => void) =>
					entry.listeners.add(listener),
				removeEventListener: (_: string, listener: () => void) =>
					entry.listeners.delete(listener),
			};
		}) as unknown as typeof window.matchMedia;
		const scene = mount();
		const first = queries.find((entry) => entry.query.includes("resolution"));
		expect(first?.query).toBe("(resolution: 1dppx)");
		window.devicePixelRatio = 3;
		for (const listener of [...(first?.listeners ?? [])]) listener();
		expect(scene.dpr.peek()).toBe(3);
		expect(first?.listeners.size).toBe(0);
		expect(queries.at(-1)?.query).toBe("(resolution: 3dppx)");
		scene.dispose();
		expect(queries.at(-1)?.listeners.size).toBe(0);
	});
});

describe("a mounted scene", () => {
	it("paints in tree order for equal z, through the scene's view matrix", () => {
		const scene = mount({ units: 10 });
		scene.add(unitRect(1));
		scene.add(unitRect(2));
		scene.add(unitRect(3));
		const made = paint();
		// Rect outlines start at the lower-left corner: cx - 0.5.
		expect(paintedXs(made)).toEqual([0.5, 1.5, 2.5]);
		expect(viewScales(made).length).toBeGreaterThan(0);
	});

	it("a node inserted later paints where it is placed in the tree", () => {
		const scene = mount({ units: 10 });
		scene.add(unitRect(1));
		const last = scene.add(unitRect(3));
		expect(paintedXs(paint())).toEqual([0.5, 2.5]);
		const middle = scene.root.add(unitRect(2), last);
		expect(paintedXs(paint())).toEqual([0.5, 1.5, 2.5]);
		middle.dispose();
		expect(paintedXs(paint())).toEqual([0.5, 2.5]);
	});

	it("reordering the children reorders painting", () => {
		const scene = mount({ units: 10 });
		const nodes = [1, 2, 3].map((x) => scene.add(unitRect(x)));
		expect(paintedXs(paint())).toEqual([0.5, 1.5, 2.5]);
		const [a, b, c] = nodes;
		scene.root.setChildren([c, a, b] as typeof nodes);
		expect(paintedXs(paint())).toEqual([2.5, 0.5, 1.5]);
	});

	it("z still wins over tree order", () => {
		const scene = mount({ units: 10 });
		scene.add(unitRect(1, { zIndex: 2 }));
		scene.add(unitRect(2));
		scene.add(unitRect(3, { zIndex: 1 }));
		expect(paintedXs(paint())).toEqual([1.5, 2.5, 0.5]);
	});

	it("animating a bound prop repaints with the new geometry", () => {
		const scene = mount({ units: 10 });
		const center = track({ x: 1, y: 0 });
		scene.add(rect.create({ center, width: 1, height: 1 }));
		expect(paintedXs(paint())).toEqual([0.5]);
		center.set({ x: 4, y: 0 });
		expect(paintedXs(paint())).toEqual([3.5]);
	});

	it("zooming repaints the same geometry through a new matrix, without recomputing nodes", () => {
		const scene = mount({ units: 10 });
		scene.add(unitRect(1));
		const first = paint();
		const graph = sceneInternals(scene)?.graph;
		const refreshes = graph?.stats.refreshes;
		scene.setView({ units: 5 });
		const second = paint();
		expect(paintedXs(second)).toEqual(paintedXs(first));
		expect(viewScales(second)[0]).toBeCloseTo(
			(viewScales(first)[0] ?? 0) * 2,
			9,
		);
		expect(graph?.stats.refreshes).toBe(refreshes);
	});

	it("a bound units track zooms", () => {
		const units = track(10);
		const scene = mount({ units });
		scene.add(unitRect(1));
		const first = paint();
		units.set(20);
		expect(viewScales(paint())[0]).toBeCloseTo(
			(viewScales(first)[0] ?? 0) / 2,
			9,
		);
		scene.setView({ units: 5 });
		units.set(40); // unbound by the plain value
		expect(scene.frame.peek().maxX).toBe(2.5);
	});
});

describe("framing", () => {
	it("frame is units wide about center, as tall as the canvas aspect makes it", () => {
		const scene = mount({ units: 10, center: { x: 1, y: 2 } });
		// 1000 x 500 canvas: 10 units wide, 5 tall.
		expect(scene.frame.peek()).toEqual({
			minX: -4,
			minY: -0.5,
			maxX: 6,
			maxY: 4.5,
		});
		expect(scene.add(unitRect(0)).context(frameContext)).toBe(scene.frame);
		const seen: number[] = [];
		const stop = scene.frame.subscribe(() =>
			seen.push(scene.frame.peek().maxX),
		);
		scene.setView({ center: { x: 0, y: 0 } });
		expect(seen.at(-1)).toBe(5);
		stop();
	});

	it("canonical view maps scene units to device pixels", () => {
		const scene = mount({ units: 10 });
		const view = scene.canonicalView.peek();
		// 100 px per unit, origin at the centre, y up.
		expect(view.a).toBe(100);
		expect(view.d).toBe(-100);
		expect(view.e).toBe(500);
		expect(view.f).toBe(250);
		scene.setView({ yUp: false });
		expect(scene.canonicalView.peek().d).toBe(100);
	});
});

describe("theme and background", () => {
	it("fills the whole canvas with the theme background by default", () => {
		const scene = mount({ palette: "catppuccin", mode: "dark" });
		scene.add(unitRect(0));
		const made = paint();
		expect(fills(made)[0]?.args).toEqual([0, 0, 1000, 500]);
		expect(fillStyles(made)[0]).toBe("#1e1e2e");
	});

	it('"transparent" clears without filling, so the canvas keeps its alpha', () => {
		const scene = mount({ background: "transparent" });
		scene.add(unitRect(0));
		const made = paint();
		expect(made.some((call) => call.op === "clearRect")).toBe(true);
		expect(fills(made)).toEqual([]);
	});

	it("accepts a Color object and a CSS string, and changes", () => {
		const scene = mount({ background: parseColor(BLUE), mode: "dark" });
		scene.add(unitRect(0));
		expect(fillStyles(paint())[0]).toBe(toCss(parseColor(BLUE)));
		scene.setBackground("theme");
		expect(fillStyles(paint())[0]).toBe("#1e1e2e");
	});

	it("provides the theme to nodes and follows setTheme", () => {
		const scene = mount({ mode: "dark" });
		const node = scene.add(unitRect(0));
		expect(node.context(themeContext)).toBe(resolveTheme({ mode: "dark" }));
		scene.setTheme({ mode: "light" });
		scene.commit();
		expect(node.context(themeContext)).toBe(resolveTheme({ mode: "light" }));
		expect(scene.theme.peek()).toBe(resolveTheme({ mode: "light" }));
	});

	it("follows the page's colour mode when the theme is the default", async () => {
		document.documentElement.dataset.mode = "dark";
		const scene = mount();
		// The attribute observer is a MutationObserver: its records arrive on a microtask.
		document.documentElement.dataset.mode = "light";
		await Promise.resolve();
		expect(scene.theme.peek()).toBe(resolveTheme({ mode: "light" }));
		document.documentElement.dataset.mode = "dark";
		await Promise.resolve();
		expect(scene.theme.peek()).toBe(resolveTheme({ mode: "dark" }));
	});
});

describe("cameras", () => {
	const clipLefts = (made: Call[]) =>
		made
			.filter((call) => call.op === "rect")
			.map((call) => call.args[0] as number);

	it("layers cameras in creation order, including one added later", () => {
		const scene = mount({ units: 10 });
		scene.add(unitRect(1));
		scene.addCamera({ viewport: { x: 0, y: 0, width: 0.5, height: 1 } });
		const right = scene.addCamera({
			viewport: { x: 0.75, y: 0, width: 0.25, height: 1 },
		});
		expect(clipLefts(paint())).toEqual([0, 750]);
		scene.addCamera({ viewport: { x: 0.5, y: 0, width: 0.25, height: 1 } });
		expect(clipLefts(paint())).toEqual([0, 750, 500]);
		right.dispose();
		expect(clipLefts(paint())).toEqual([0, 500]);
		expect(scene.element?.querySelectorAll("canvas").length).toBe(1);
	});

	it("an empty camera list is the plain single-view case", () => {
		const scene = mount();
		expect(scene.cameraViews.peek()).toEqual([]);
		const camera = scene.addCamera({ units: 4 });
		expect(scene.cameraViews.peek().map((view) => view.units)).toEqual([4]);
		camera.dispose();
		expect(scene.cameraViews.peek()).toEqual([]);
	});

	it("a transparent scene leaves its cameras' viewports unfilled", () => {
		const scene = mount({ background: "transparent" });
		scene.addCamera({ viewport: { x: 0, y: 0, width: 0.5, height: 1 } });
		scene.addCamera({
			viewport: { x: 0.5, y: 0, width: 0.5, height: 1 },
			background: BLUE,
		});
		scene.add(unitRect(0));
		const made = paint();
		// Only the second camera, which asked for a fill of its own, paints one.
		expect(fills(made).map((call) => call.args)).toEqual([[500, 0, 500, 500]]);
		expect(fillStyles(made)[0]).toBe(BLUE);
	});
});

describe("a headless scene", () => {
	it("touches no DOM, commits and reports its frame", () => {
		const before = document.body.innerHTML;
		const scene = createScene({ units: 8, size: { width: 800, height: 200 } });
		scenes.push(scene);
		expect(scene.headless).toBe(true);
		expect(scene.canvas).toBeNull();
		expect(scene.element).toBeNull();
		expect(document.body.innerHTML).toBe(before);
		expect(dom.resizes.length + dom.intersections.length).toBe(0);
		const node = scene.add(unitRect(1));
		expect(scene.commit()).toBe(true);
		expect(scene.snapshot().map((spec) => spec.id)).toEqual([node.id]);
		expect(scene.commit()).toBe(false);
		// 800 x 200 at 8 units: 2 units tall.
		expect(scene.frame.peek()).toEqual({
			minX: -4,
			minY: -1,
			maxX: 4,
			maxY: 1,
		});
		expect(sceneInternals(scene)?.renderer).toBeNull();
	});

	it("without a size takes the frame's height from aspect", () => {
		const scene = createScene({ headless: true, units: 16, aspect: 2 });
		scenes.push(scene);
		expect(scene.frame.peek()).toEqual({
			minX: -8,
			minY: -4,
			maxX: 8,
			maxY: 4,
		});
	});

	it("commits in the frame loop too", () => {
		const scene = createScene();
		scenes.push(scene);
		const node = scene.add(unitRect(1));
		stepFrame(0);
		expect(scene.snapshot().map((spec) => spec.id)).toEqual([node.id]);
	});
});

describe("cost and cleanup", () => {
	it("a scene with nothing dirty does no commit or paint work per frame", () => {
		const scene = mount();
		scene.add(unitRect(1));
		paint();
		const graph = sceneInternals(scene)?.graph;
		const stats = { ...graph?.stats };
		expect(dom.queue.length).toBe(0);
		// Frames caused by something else (here, by hand) find nothing to do.
		dom.takeCalls();
		stepFrame(5000);
		stepFrame(5016);
		expect(dom.takeCalls()).toEqual([]);
		expect(graph?.stats).toEqual(stats);
	});

	it("dispose removes the box, every observer, frame participant and subscription", () => {
		const units = track(10);
		const scene = createScene({ host: mountPoint(), units });
		const camera = track({ x: 0, y: 0 });
		scene.addCamera({ center: camera });
		const node = scene.add(unitRect(1));
		paint();
		let extension = 0;
		sceneInternals(scene)?.onDispose(() => extension++);
		scene.dispose();
		expect(extension).toBe(1);
		expect(document.querySelectorAll("canvas").length).toBe(0);
		expect(dom.resizes.every((observer) => observer.disconnected)).toBe(true);
		expect(dom.intersections.every((observer) => observer.disconnected)).toBe(
			true,
		);
		expect(node.disposed).toBe(true);
		// Nothing listens any more: writes request no frame and paint nothing.
		dom.takeCalls();
		units.set(20);
		camera.set({ x: 1, y: 1 });
		expect(dom.queue.length).toBe(0);
		stepFrame(9000);
		expect(dom.takeCalls()).toEqual([]);
		scene.dispose();
	});

	it("dispose aborts the scene's runs", async () => {
		const scene = mount();
		const x = track(0);
		const run = scene.play({ duration: 10, seek: (t: number) => x.set(t) });
		scene.dispose();
		expect(await run).toBe("aborted");
	});
});

describe("pointerDriver", () => {
	it("is the scene's driver, and null for a headless scene", () => {
		const scene = mount();
		expect(pointerDriver(scene)).not.toBeNull();
		expect(pointerDriver(scene)).toBe(sceneInternals(scene)?.driver);
		const headless = createScene({ headless: true, units: 8, aspect: 2 });
		scenes.push(headless);
		expect(pointerDriver(headless)).toBeNull();
	});
});
