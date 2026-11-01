import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseColor } from "../color/index.js";
import type { Readable } from "../reactive/track.js";
import { track } from "../reactive/track.js";
import type { Clock } from "../tween/clock.js";
import { createClock } from "../tween/clock.js";
import { resetFrameLoop } from "../tween/frame-loop.js";
import { cssColorInterpolator } from "../tween/interpolators.js";
import { spring, springProgress, springSettleTime } from "../tween/spring.js";
import { compose } from "./animation.js";
import { parallel, sequence } from "./sequence.js";
import { follow, springTo } from "./spring.js";
import { driveTrack } from "./types.js";

beforeEach(() => {
	resetFrameLoop();
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe("springTo", () => {
	it("lasts delay + settle time, known at construction", () => {
		const x = track(0);
		const options = { stiffness: 170, damping: 12, delay: 0.25 };
		const { duration } = springProgress(options);
		expect(springTo(x, 100, options).duration).toBeCloseTo(0.25 + duration, 12);
		expect(duration).toBe(springSettleTime(spring(options), -1, 0, 1e-3));
	});

	it("captures the start on entry and lands exactly on `to`", () => {
		const x = track(0);
		const anim = springTo(x, 100, { damping: 6 });
		x.set(20);
		anim.seek(0);
		expect(x.peek()).toBe(20);
		anim.seek(anim.duration);
		expect(x.peek()).toBe(100);
		anim.seek(anim.duration * 10);
		expect(x.peek()).toBe(100);
	});

	it("overshoots when under-damped", () => {
		const x = track(0);
		const anim = springTo(x, 100, { damping: 4 });
		let peak = 0;
		for (let i = 0; i <= 400; i++) {
			anim.seek((i / 400) * anim.duration);
			peak = Math.max(peak, x.peek());
		}
		expect(peak).toBeGreaterThan(130);
	});

	it("seeks idempotently and independently of order", () => {
		const fresh = track(0);
		const freshAnim = springTo(fresh, 50, { damping: 7, velocity: 2 });
		freshAnim.seek(0.3);
		const expected = fresh.peek();

		const x = track(0);
		const anim = springTo(x, 50, { damping: 7, velocity: 2 });
		anim.seek(0.9);
		anim.seek(0.3);
		expect(x.peek()).toBe(expected);
		anim.seek(0.3);
		expect(x.peek()).toBe(expected);
	});

	it("accepts `to` as a function of the value at entry", () => {
		const x = track(10);
		const anim = springTo(x, (current) => current + 5);
		anim.seek(anim.duration);
		expect(x.peek()).toBe(15);
	});

	it("restore writes the start state and keeps the capture", () => {
		const x = track(0);
		const anim = springTo(x, 100);
		anim.begin?.();
		anim.seek(anim.duration / 2);
		x.set(-999); // a later write must not become the new start
		anim.restore?.();
		expect(x.peek()).toBe(0);
		anim.seek(anim.duration);
		expect(x.peek()).toBe(100);
	});

	it("holds silently through its delay, like driveTrack", () => {
		const x = track(3);
		const anim = springTo(x, 100, { delay: 0.5 });
		anim.seek(0.25);
		expect(x.peek()).toBe(3);
		anim.seek(0.5);
		expect(x.peek()).toBe(3);
	});

	it("sequences: the second spring starts from where the first landed", () => {
		const x = track(0);
		const first = springTo(x, 10);
		const second = springTo(x, (current) => current * 2);
		const both = sequence(first, second);
		expect(both.duration).toBeCloseTo(first.duration + second.duration, 12);
		both.seek(both.duration);
		expect(x.peek()).toBe(20);
		// Scrub back into the first and forward again: still exact.
		both.seek(first.duration / 2);
		expect(x.peek()).not.toBe(20);
		both.seek(both.duration);
		expect(x.peek()).toBe(20);
		both.seek(0);
		expect(x.peek()).toBe(0);
	});

	it("runs in parallel with tweens of other tracks", () => {
		const x = track(0);
		const y = track(0);
		const together = parallel(
			springTo(x, 1, { damping: 20 }),
			driveTrack(y, 1, { duration: 0.2 }),
		);
		const placed = compose([{ animation: together, start: 0.5 }]);
		placed.seek(0.4);
		expect([x.peek(), y.peek()]).toEqual([0, 0]);
		placed.seek(placed.duration);
		expect([x.peek(), y.peek()]).toEqual([1, 1]);
	});

	it("overshoots through a colour and still writes valid CSS", () => {
		const fill = track("#204080");
		const anim = springTo(fill, "#f0f0f0", {
			damping: 2,
			interpolate: cssColorInterpolator(),
		});
		const plain = track(0);
		const progress = springTo(plain, 1, { damping: 2 });
		// Find the peak overshoot of progress, then check the colour there.
		let peakTime = 0;
		let peak = 0;
		for (let i = 0; i <= 1000; i++) {
			const t = (i / 1000) * anim.duration;
			progress.seek(t);
			if (plain.peek() > peak) {
				peak = plain.peek();
				peakTime = t;
			}
		}
		expect(peak).toBeGreaterThan(1.5);
		anim.seek(peakTime);
		const css = fill.peek();
		expect(css).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
		const color = parseColor(css);
		for (const channel of [color.r, color.g, color.b]) {
			expect(channel).toBeGreaterThanOrEqual(0);
			expect(channel).toBeLessThanOrEqual(255);
		}
		expect(color.r).toBe(255);
		anim.seek(anim.duration);
		expect(fill.peek()).toBe("#f0f0f0");
	});

	it("overshoots through a colour via auto's d3 fallback too", () => {
		const fill = track("#204080");
		const anim = springTo(fill, "#f0f0f0", { damping: 2 });
		for (let i = 0; i <= 200; i++) {
			anim.seek((i / 200) * anim.duration);
			expect(fill.peek()).not.toMatch(/NaN|-/);
		}
	});
});

/** Wraps a clock so tests can see how many subscriptions it holds. */
function countingClock(): { clock: Clock; active: () => number } {
	const inner = createClock();
	let active = 0;
	const clock: Clock = {
		...inner,
		onTick(listener) {
			active++;
			const stop = inner.onTick(listener);
			let stopped = false;
			return () => {
				if (stopped) return;
				stopped = true;
				active--;
				stop();
			};
		},
	};
	return { clock, active: () => active };
}

/** Steps the clock `seconds` forward in steps of `dt`, recording the target. */
function run<T>(
	clock: Clock,
	target: Readable<T>,
	seconds: number,
	dt = 1 / 120,
): T[] {
	const seen: T[] = [];
	const steps = Math.round(seconds / dt);
	for (let i = 0; i < steps; i++) {
		clock.advance(dt);
		seen.push(target.peek());
	}
	return seen;
}

describe("follow", () => {
	it("converges on the source and then lands on it exactly", () => {
		const { clock } = countingClock();
		const source = track(0);
		const x = track(0);
		follow(x, source, { damping: 12 }, { clock });
		source.set(100);
		run(clock, x, 3);
		expect(x.peek()).toBe(100);
	});

	it("subscribes to the clock only while moving", () => {
		const { clock, active } = countingClock();
		const source = track(5);
		const x = track(5);
		const stop = follow(x, source, {}, { clock });
		expect(active()).toBe(0);
		source.set(50);
		expect(active()).toBe(1);
		// Several changes before the next step: one subscription, one retarget.
		source.set(60);
		source.set(70);
		expect(active()).toBe(1);
		run(clock, x, 3);
		expect(active()).toBe(0);
		expect(x.peek()).toBe(70);
		source.set(0);
		expect(active()).toBe(1);
		stop();
		expect(active()).toBe(0);
		// Stopped: further changes do nothing.
		source.set(1);
		expect(active()).toBe(0);
	});

	it("starts moving at construction when the target is away from the source", () => {
		const { clock, active } = countingClock();
		const x = track(0);
		follow(x, track(10), {}, { clock });
		expect(active()).toBe(1);
		run(clock, x, 3);
		expect(x.peek()).toBe(10);
		expect(active()).toBe(0);
	});

	it("follows the exact closed form between retargets, whatever the frame rate", () => {
		const options = { stiffness: 150, damping: 9 };
		const coarse = countingClock().clock;
		const fine = countingClock().clock;
		const source = track(0);
		const a = track(0);
		const b = track(0);
		follow(a, source, options, { clock: coarse });
		follow(b, source, options, { clock: fine });
		source.set(1);
		// One step to pick up the change, then the same total time.
		coarse.advance(0.01);
		fine.advance(0.01);
		run(coarse, a, 0.4, 0.1);
		run(fine, b, 0.4, 0.001);
		expect(a.peek()).toBeCloseTo(b.peek(), 9);
	});

	it("preserves velocity across a retarget mid-flight", () => {
		const { clock } = countingClock();
		const source = track(0);
		const x = track(0);
		follow(x, source, { stiffness: 120, damping: 8 }, { clock });
		const dt = 1e-3;
		source.set(100);
		const before = run(clock, x, 0.15, dt);
		source.set(-40);
		const after = run(clock, x, 0.01, dt);
		// The retarget step writes the position along the old path; second-order
		// one-sided differences on each side of it give the velocity there.
		const n = before.length;
		const at = after[0] ?? 0;
		const p1 = before[n - 1] ?? 0;
		const p2 = before[n - 2] ?? 0;
		const n1 = after[1] ?? 0;
		const n2 = after[2] ?? 0;
		const velocityBefore = (3 * at - 4 * p1 + p2) / (2 * dt);
		const velocityAfter = (-3 * at + 4 * n1 - n2) / (2 * dt);
		expect(Math.abs(velocityBefore)).toBeGreaterThan(100);
		expect(Math.abs(velocityAfter - velocityBefore)).toBeLessThan(
			0.01 * Math.abs(velocityBefore),
		);
		run(clock, x, 3);
		expect(x.peek()).toBe(-40);
	});

	it("springs points per component", () => {
		const { clock } = countingClock();
		const source = track({ x: 0, y: 0, label: "a" });
		const marker = track({ x: 0, y: 0, label: "a" });
		follow(marker, source, { damping: 20 }, { clock });
		source.set({ x: 100, y: -50, label: "b" });
		run(clock, marker, 0.2);
		const mid = marker.peek();
		// Critically damped from rest: both components cover the same fraction.
		expect(mid.x / 100).toBeCloseTo(mid.y / -50, 12);
		expect(mid.label).toBe("b");
		run(clock, marker, 3);
		expect(marker.peek()).toEqual({ x: 100, y: -50, label: "b" });
	});

	it("keeps each component's own velocity when a point retargets", () => {
		const { clock } = countingClock();
		const source = track({ x: 0, y: 0 });
		const marker = track({ x: 0, y: 0 });
		follow(marker, source, { stiffness: 120, damping: 8 }, { clock });
		const dt = 1e-3;
		source.set({ x: 100, y: 0 });
		const before = run(clock, marker, 0.1, dt);
		// y starts moving; x must keep its momentum.
		source.set({ x: 100, y: 80 });
		const after = run(clock, marker, 0.003, dt);
		const n = before.length;
		const velocityBefore =
			(3 * (after[0]?.x ?? 0) -
				4 * (before[n - 1]?.x ?? 0) +
				(before[n - 2]?.x ?? 0)) /
			(2 * dt);
		const velocityAfter =
			(-3 * (after[0]?.x ?? 0) + 4 * (after[1]?.x ?? 0) - (after[2]?.x ?? 0)) /
			(2 * dt);
		expect(Math.abs(velocityAfter - velocityBefore)).toBeLessThan(
			0.01 * Math.abs(velocityBefore),
		);
		expect(after[2]?.y ?? 0).toBeGreaterThan(0);
	});

	it("springs 3D points and number arrays per component", () => {
		const { clock } = countingClock();
		const position = track({ x: 0, y: 0, z: 0 });
		const goal = track({ x: 0, y: 0, z: 0 });
		follow(position, goal, {}, { clock });
		goal.set({ x: 1, y: 2, z: 3 });
		const weights = track([0, 0]);
		const weightGoal = track([0, 0]);
		follow(weights, weightGoal, {}, { clock });
		weightGoal.set([10, 20]);
		run(clock, position, 0.1);
		expect(position.peek().z).toBeCloseTo(3 * position.peek().x, 12);
		expect(weights.peek()[1]).toBeCloseTo(2 * (weights.peek()[0] ?? 0), 12);
		run(clock, position, 3);
		expect(position.peek()).toEqual({ x: 1, y: 2, z: 3 });
		expect(weights.peek()).toEqual([10, 20]);
	});

	it("springs colours in progress space, carrying progress velocity", () => {
		const { clock, active } = countingClock();
		const source = track("#000000");
		const fill = track("#000000");
		follow(
			fill,
			source,
			{ damping: 3 },
			{
				clock,
				interpolate: cssColorInterpolator(),
			},
		);
		source.set("#808080");
		const first = run(clock, fill, 0.15);
		source.set("#ff0000");
		const second = run(clock, fill, 0.5);
		for (const css of [...first, ...second]) {
			const color = parseColor(css);
			for (const channel of [color.r, color.g, color.b]) {
				expect(channel).toBeGreaterThanOrEqual(0);
				expect(channel).toBeLessThanOrEqual(255);
			}
		}
		// No jump at the retarget: the colour moves on from where it was.
		const last = parseColor(first[first.length - 1] ?? "");
		const next = parseColor(second[0] ?? "");
		expect(Math.abs(next.g - last.g)).toBeLessThan(10);
		run(clock, fill, 5);
		expect(fill.peek()).toBe("#ff0000");
		expect(active()).toBe(0);
	});

	it("falls back to progress space when the shape changes", () => {
		const { clock } = countingClock();
		const source = track<number[]>([0, 0]);
		const values = track<number[]>([0, 0]);
		follow(values, source, {}, { clock });
		source.set([5, 5]);
		run(clock, values, 0.1);
		source.set([1, 2, 3]);
		run(clock, values, 5);
		expect(values.peek()).toEqual([1, 2, 3]);
	});

	it("rejects an undamped spring", () => {
		expect(() =>
			follow(track(0), track(1), { damping: 0 }, { clock: createClock() }),
		).toThrow(RangeError);
	});
});
