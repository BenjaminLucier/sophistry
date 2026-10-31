// @vitest-environment happy-dom
/**
 * One frame loop for clocks and scenes: a clock tick and the paint it causes
 * land in the same `requestAnimationFrame` callback, N clocks and M scenes
 * share one callback per frame, the loop idles when nothing needs frames, and
 * a scene scrolled out of view neither paints nor ticks its own clock.
 *
 * `requestAnimationFrame` is a manual queue; `IntersectionObserver` is a stub
 * whose callback the tests invoke (`test-dom.ts`).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { track } from "../reactive";
import { rect } from "../shapes/rect";
import type { Clock } from "../tween/clock";
import { createClock } from "../tween/clock";
import { isFrameLoopRunning } from "../tween/frame-loop";
import type { Scene, SceneOptions } from "./scene";
import { createScene } from "./scene";
import type { DomHarness } from "./test-dom";
import { installDom, mountPoint } from "./test-dom";

let dom: DomHarness;
const scenes: Scene[] = [];

beforeEach(() => {
	dom = installDom({ width: 100, height: 50 });
});

afterEach(() => {
	for (const scene of scenes.splice(0)) scene.dispose();
	dom.restore();
});

function mount(options: SceneOptions): Scene {
	const scene = createScene({ host: mountPoint(), units: 10, ...options });
	scenes.push(scene);
	return scene;
}

/** Strokes and fills issued since the last call. */
function strokes(): number {
	return dom
		.takeCalls()
		.filter((call) => call.op === "stroke" || call.op === "fill").length;
}

describe("shared frame loop with scenes", () => {
	it("a clock tick and the paint it causes happen in the same frame", () => {
		const clock = createClock();
		const x = track(0);
		const scene = mount({ clock });
		scene.add(
			rect.create({
				center: { peek: () => ({ x: x.peek(), y: 0 }), subscribe: x.subscribe },
				width: 1,
				height: 1,
			}),
		);
		clock.onTick((dt) => x.set(x.peek() + dt * 10));
		dom.runFrame(1000); // first paint, and primes the clock
		strokes();
		dom.runFrame(1016); // tick -> track write -> commit -> paint, inside this call
		expect(clock.time.peek()).toBeCloseTo(0.016, 9);
		expect(strokes()).toBeGreaterThan(0);
		expect(dom.queue.length).toBe(1); // one callback for the next frame
	});

	it("a node added during a tick is painted in that same frame, and a removed one is gone from it", () => {
		const clock = createClock();
		const scene = mount({ clock });
		let pending: (() => void) | null = null;
		clock.onTick(() => {
			pending?.();
			pending = null;
		});
		dom.runFrame(1000);
		dom.runFrame(1016);
		strokes();
		let node: ReturnType<typeof rect.create> | null = null;
		pending = () => {
			node = scene.add(rect.create({ width: 1, height: 1 }));
		};
		dom.runFrame(1032);
		expect(strokes()).toBeGreaterThan(0);
		pending = () => node?.dispose();
		dom.runFrame(1048);
		// Had the removal lingered a frame, 1048 would still draw the rect.
		expect(strokes()).toBe(0);
		dom.runFrame(1064);
		expect(strokes()).toBe(0);
	});

	it("two clocks and two scenes use one rAF callback per frame", () => {
		const a = createClock();
		const b = createClock();
		const xa = track({ x: 0, y: 0 });
		const xb = track({ x: 0, y: 0 });
		mount({ clock: a }).add(rect.create({ center: xa, width: 1, height: 1 }));
		mount({ clock: b }).add(rect.create({ center: xb, width: 1, height: 1 }));
		a.onTick((dt) => xa.set({ x: xa.peek().x + dt, y: 0 }));
		b.onTick((dt) => xb.set({ x: xb.peek().x + dt, y: 0 }));
		expect(dom.queue.length).toBe(1);
		dom.runFrame(1000);
		expect(dom.queue.length).toBe(1);
		strokes();
		dom.runFrame(1016);
		expect(strokes()).toBeGreaterThanOrEqual(2); // both scenes painted
		expect(dom.queue.length).toBe(1);
	});

	it("goes idle when no clock has subscribers and nothing is dirty", () => {
		mount({}).add(rect.create({ width: 1, height: 1 }));
		expect(dom.queue.length).toBe(1); // the first commit and paint
		dom.runFrame(1000);
		expect(dom.queue.length).toBe(0);
		expect(isFrameLoopRunning()).toBe(false);
	});
});

describe("off-screen scenes", () => {
	const scene = (clock: Clock, options: SceneOptions = {}) =>
		mount({ clock, ...options }).add(rect.create({ width: 1, height: 1 }));

	it("suspends its own clock without touching paused, and resumes", () => {
		const clock = createClock();
		clock.onTick(() => {});
		scene(clock);
		dom.runFrame(1000);
		dom.runFrame(1016);
		const time = clock.time.peek();
		expect(time).toBeGreaterThan(0);

		dom.reportVisible(0, false);
		expect(clock.paused.peek()).toBe(false);
		dom.runFrame(1032);
		dom.runFrame(1048);
		expect(clock.time.peek()).toBe(time);

		clock.pause(); // the user's pause survives the round trip
		dom.reportVisible(0, true);
		expect(clock.paused.peek()).toBe(true);
		clock.resume();
		dom.runFrame(5000);
		dom.runFrame(5016);
		expect(clock.time.peek()).toBeGreaterThan(time);
		expect(clock.time.peek() - time).toBeLessThan(0.1);
	});

	it("does not paint while hidden, and paints at once when shown", () => {
		const clock = createClock();
		const node = scene(clock);
		dom.runFrame(1000);
		dom.reportVisible(0, false);
		strokes();
		// A change while hidden is taken in but not drawn.
		node.set("width", 2);
		dom.drain(1016);
		expect(strokes()).toBe(0);
		dom.reportVisible(0, true);
		expect(dom.queue.length).toBe(1);
		dom.runFrame(1100);
		expect(strokes()).toBeGreaterThan(0);
	});

	it("pauseWhenHidden false keeps ticking and painting", () => {
		const clock = createClock();
		clock.onTick(() => {});
		const node = scene(clock, { pauseWhenHidden: false });
		dom.runFrame(1000);
		dom.reportVisible(0, false);
		dom.runFrame(1016);
		expect(clock.time.peek()).toBeGreaterThan(0);
		strokes();
		node.set("width", 2);
		dom.runFrame(1032);
		expect(strokes()).toBeGreaterThan(0);
	});

	it("works without IntersectionObserver", () => {
		dom.restore();
		dom = installDom({ width: 100, height: 50, intersection: false });
		const clock = createClock();
		clock.onTick(() => {});
		scene(clock);
		expect(dom.intersections.length).toBe(0);
		dom.runFrame(1000);
		dom.runFrame(1016);
		expect(clock.time.peek()).toBeGreaterThan(0);
	});
});
