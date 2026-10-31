import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Polyline } from "../geometry";
import { track } from "../reactive";
import { createClock } from "../tween/clock";
import {
	applyWave,
	blink,
	focusOn,
	passingFlash,
	showPassingFlash,
} from "./indication";
import { timeline } from "./timeline";

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe("blink", () => {
	it("is shown, then hidden, per blink, and shown again at the end", () => {
		const opacity = track(0.8);
		const anim = blink(opacity, { blinks: 2, timeOn: 0.25, timeOff: 0.25 });
		expect(anim.duration).toBeCloseTo(1, 12);
		const run = timeline(anim, { clock: createClock() });
		const at = (t: number) => {
			run.seek(t);
			return opacity.peek();
		};
		expect(at(0.1)).toBe(0.8);
		expect(at(0.35)).toBe(0);
		expect(at(0.6)).toBe(0.8);
		expect(at(0.85)).toBe(0);
		expect(at(1)).toBe(0.8);
	});

	it("can end hidden", () => {
		const opacity = track(1);
		const run = timeline(blink(opacity, { hideAtEnd: true }), {
			clock: createClock(),
		});
		run.seek(1);
		expect(opacity.peek()).toBe(0);
	});
});

describe("focusOn", () => {
	it("closes in while fading up, then vanishes and resets its radius", () => {
		const radius = track(8);
		const opacity = track(0);
		const run = timeline(focusOn(radius, opacity, { easing: "linear" }), {
			clock: createClock(),
		});
		run.seek(1);
		expect(radius.peek()).toBeCloseTo(4, 9);
		expect(opacity.peek()).toBeCloseTo(0.1, 9);
		run.seek(2);
		expect(opacity.peek()).toBe(0);
		expect(radius.peek()).toBe(8);
	});
});

describe("passingFlash", () => {
	it("shows nothing at rest and one sliver in between", () => {
		expect(passingFlash(10, 0).visible).toBe(false);
		expect(passingFlash(10, 1).visible).toBe(false);
		expect(passingFlash(0, 0.5).visible).toBe(false);
		const mid = passingFlash(10, 0.5, 0.1);
		expect(mid.visible).toBe(true);
		// A 1-unit sliver, one per period, the period longer than the path.
		expect(mid.dash).toEqual([1, 11]);
		// Its head is at 0.5 × (10 + 1) along: the dash starts there minus its length.
		expect(mid.dashOffset).toBeCloseTo(1 - 5.5, 12);
	});

	it("showPassingFlash runs its track 0 to 1", () => {
		const flash = track(0);
		const run = timeline(showPassingFlash(flash, { easing: "linear" }), {
			clock: createClock(),
		});
		run.seek(0.25);
		expect(flash.peek()).toBeCloseTo(0.25, 9);
		run.seek(1);
		expect(flash.peek()).toBe(1);
	});
});

describe("applyWave", () => {
	const line: Polyline = [
		{ x: -2, y: 0 },
		{ x: 2, y: 0 },
	];

	it("pushes points up as the wave passes, splitting long edges so they bend", () => {
		const points = track(line);
		const run = timeline(applyWave(points, { amplitude: 0.5 }), {
			clock: createClock(),
		});
		run.seek(1);
		const mid = points.peek();
		expect(mid.length).toBeGreaterThan(2);
		const top = Math.max(...mid.map((p) => p.y));
		expect(top).toBeGreaterThan(0.2);
		expect(top).toBeLessThanOrEqual(0.5 + 1e-9);
		// Only sideways: every x stays on the line.
		for (const p of mid) expect(Math.abs(p.x)).toBeLessThanOrEqual(2);
	});

	it("puts the original points back, at both ends", () => {
		const points = track(line);
		const run = timeline(applyWave(points), { clock: createClock() });
		run.seek(1.3);
		run.seek(2);
		expect(points.peek()).toBe(line);
		run.seek(0);
		expect(points.peek()).toBe(line);
	});

	it("waves several rings and keeps them several", () => {
		const rings: Polyline[] = [line, line.map((p) => ({ x: p.x, y: p.y + 1 }))];
		const points = track(rings);
		const run = timeline(applyWave(points, { direction: { x: 1, y: 0 } }), {
			clock: createClock(),
		});
		run.seek(1);
		expect(points.peek()).toHaveLength(2);
		// Pushed right, travelling down: y values never move.
		for (const ring of points.peek())
			for (const p of ring) expect([0, 1]).toContain(p.y);
	});
});
