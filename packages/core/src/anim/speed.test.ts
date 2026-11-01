import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../reactive/index.js";
import { createClock } from "../tween/clock.js";
import { moveBy, valueTo } from "./move.js";
import { forever, sequence } from "./sequence.js";
import { changeSpeed } from "./speed.js";
import { timeline } from "./timeline.js";

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const linear = { duration: 2, easing: "linear" as const };

describe("changeSpeed", () => {
	it("a constant factor scales the duration and the schedule", () => {
		const x = track(0);
		const fast = changeSpeed(valueTo(x, 10, linear), 4);
		expect(fast.duration).toBeCloseTo(0.5, 12);
		const run = timeline(fast, { clock: createClock() });
		run.seek(0.25);
		expect(x.peek()).toBeCloseTo(5, 9);
		run.seek(0.5);
		expect(x.peek()).toBe(10);
	});

	it("a varying speed slows through its window and still ends on target", () => {
		const x = track(0);
		// Half speed through the whole middle fifth (0.4..0.6, flat between).
		const anim = changeSpeed(valueTo(x, 10, linear), {
			0: 1,
			0.4: 1,
			0.40001: 0.5,
			0.6: 0.5,
			0.60001: 1,
			1: 1,
		});
		// 0.8 of it at speed 1 plus 0.2 at half speed: 1.6 s + 0.8 s.
		expect(anim.duration).toBeCloseTo(2.4, 2);
		const run = timeline(anim, { clock: createClock() });
		run.seek(0.8);
		expect(x.peek()).toBeCloseTo(4, 2);
		run.seek(1.2); // 0.4 s into the slow stretch: 0.2 s of inner time.
		expect(x.peek()).toBeCloseTo(5, 2);
		run.seek(anim.duration);
		expect(x.peek()).toBe(10);
	});

	it("keys left out count as speed 1", () => {
		const x = track(0);
		const anim = changeSpeed(valueTo(x, 1, linear), { 0.5: 2 });
		// Speed ramps 1 → 2 → 1: strictly shorter than the written 2 s.
		expect(anim.duration).toBeLessThan(2);
		expect(anim.duration).toBeGreaterThan(1);
	});

	it("passes begin and restore through, so a relative move inside still scrubs", () => {
		const p = track({ x: 0, y: 0 });
		const anim = sequence(
			changeSpeed(moveBy(p, { x: 1, y: 0 }, linear), 2),
			changeSpeed(moveBy(p, { x: 1, y: 0 }, linear), { 0.5: 0.5 }),
		);
		const run = timeline(anim, { clock: createClock() });
		run.seek(anim.duration);
		expect(p.peek().x).toBeCloseTo(2, 9);
		run.seek(0.5);
		expect(p.peek().x).toBeCloseTo(0.5, 9);
		run.seek(0);
		expect(p.peek().x).toBe(0);
		run.seek(anim.duration);
		expect(p.peek().x).toBeCloseTo(2, 9);
	});

	it("scales an endless animation by a constant, and refuses a varying speed for one", () => {
		const x = track(0);
		const loop = forever(valueTo(x, 1, { duration: 1, easing: "linear" }));
		const fast = changeSpeed(loop, 2);
		expect(fast.duration).toBe(Number.POSITIVE_INFINITY);
		expect(() => changeSpeed(loop, { 0.5: 2 })).toThrow(RangeError);
	});
});
