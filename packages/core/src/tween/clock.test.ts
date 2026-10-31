import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClock, defaultClock, watchClockVisibility } from "./clock";
import { isFrameLoopRunning, resetFrameLoop } from "./frame-loop";

// This module is DOM-free in intent but `onTick()` calls `requestAnimationFrame`
// to drive its own frame loop; the vitest environment here is "node", which has no
// rAF. We stub it so `onTick()` doesn't throw — the loop itself never actually
// runs in these tests, since every assertion drives time by hand via `advance()`.
beforeEach(() => {
	resetFrameLoop();
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createClock", () => {
	it("starts at time 0, unpaused, speed 1", () => {
		const clock = createClock();
		expect(clock.time.peek()).toBe(0);
		expect(clock.paused.peek()).toBe(false);
		expect(clock.speed.peek()).toBe(1);
	});

	it("advance() moves time forward by exactly dt", () => {
		const clock = createClock();
		clock.advance(0.5);
		expect(clock.time.peek()).toBeCloseTo(0.5, 9);
		clock.advance(0.25);
		expect(clock.time.peek()).toBeCloseTo(0.75, 9);
	});

	it("advance() with dt<=0 is a no-op", () => {
		const clock = createClock();
		clock.advance(0);
		expect(clock.time.peek()).toBe(0);
		clock.advance(-1);
		expect(clock.time.peek()).toBe(0);
	});

	it("advance() works even while paused", () => {
		const clock = createClock();
		clock.pause();
		clock.advance(1);
		expect(clock.time.peek()).toBeCloseTo(1, 9);
		expect(clock.paused.peek()).toBe(true);
	});

	it("pause/resume/toggle flip the paused flag", () => {
		const clock = createClock();
		clock.pause();
		expect(clock.paused.peek()).toBe(true);
		clock.resume();
		expect(clock.paused.peek()).toBe(false);
		clock.toggle();
		expect(clock.paused.peek()).toBe(true);
		clock.toggle();
		expect(clock.paused.peek()).toBe(false);
	});

	it("setSpeed clamps to non-negative", () => {
		const clock = createClock();
		clock.setSpeed(-5);
		expect(clock.speed.peek()).toBe(0);
		clock.setSpeed(2);
		expect(clock.speed.peek()).toBe(2);
	});

	it("subscribe delivers dt and the running total to listeners on advance()", () => {
		const clock = createClock();
		const calls: [number, number][] = [];
		const unsubscribe = clock.onTick((dt, time) => calls.push([dt, time]));
		clock.advance(0.5);
		clock.advance(0.25);
		unsubscribe();
		expect(calls).toEqual([
			[0.5, 0.5],
			[0.25, 0.75],
		]);
	});

	it("unsubscribe stops further notifications", () => {
		const clock = createClock();
		const calls: number[] = [];
		const unsubscribe = clock.onTick((dt) => calls.push(dt));
		clock.advance(1);
		unsubscribe();
		clock.advance(1);
		expect(calls).toEqual([1]);
	});

	it("a listener that unsubscribes itself mid-emit doesn't break the others", () => {
		const clock = createClock();
		const calls: string[] = [];
		let unsubA: () => void;
		const unsubB = clock.onTick(() => {
			calls.push("b");
		});
		unsubA = clock.onTick(() => {
			calls.push("a");
			unsubA();
		});
		clock.advance(1);
		calls.length = 0;
		clock.advance(1);
		// "a" unsubscribed itself after the first advance, so only "b" remains.
		expect(calls).toEqual(["b"]);
		unsubB();
	});

	it("multiple independent clocks don't share state", () => {
		const a = createClock();
		const b = createClock();
		a.advance(1);
		expect(a.time.peek()).toBeCloseTo(1, 9);
		expect(b.time.peek()).toBe(0);
	});

	it("setSpeed multiplies advance()'d time — advance() itself is unaffected by speed (it's a raw delta)", () => {
		// `advance()` hands `dt` straight to `emit`, unscaled; `speed` only enters
		// through `tick`'s `raw * speed()`. This documents that split rather than
		// asserting something false about `advance`.
		const clock = createClock();
		clock.setSpeed(2);
		clock.advance(1);
		expect(clock.time.peek()).toBeCloseTo(1, 9);
	});
});

describe("tick / requestAnimationFrame frame loop", () => {
	// `tick` is normally driven by `requestAnimationFrame`; here we capture the
	// callback rAF was given and invoke it ourselves with hand-picked `now`
	// values, so `dt` is computed exactly the way real playback computes it.
	let scheduled: FrameRequestCallback[] = [];

	beforeEach(() => {
		resetFrameLoop();
		scheduled = [];
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
			scheduled.push(cb);
			return scheduled.length;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
	});

	const runNextFrame = (now: number) => {
		const cb = scheduled.shift();
		expect(cb).toBeDefined();
		cb?.(now);
	};

	it("subscribe() schedules a frame, and the first tick reports dt=0 (no previous `last`)", () => {
		const clock = createClock();
		const calls: [number, number][] = [];
		clock.onTick((dt, time) => calls.push([dt, time]));
		expect(scheduled.length).toBe(1);

		runNextFrame(1000);
		// First tick has no previous `last`, so `raw` is defined as 0 and no
		// listener emission happens (`emit` only fires when dt > 0) — but the loop
		// reschedules itself for the next frame regardless.
		expect(calls.length).toBe(0);
		expect(scheduled.length).toBe(1);
	});

	it("tick(now) computes dt from consecutive calls, in seconds", () => {
		const clock = createClock();
		const calls: [number, number][] = [];
		clock.onTick((dt, time) => calls.push([dt, time]));

		// Gaps below MAX_FRAME (1/15s ≈ 66.7ms) so the clamp branch (tested
		// separately below) doesn't kick in and mask the raw computation.
		runNextFrame(1000); // primes `last`, dt=0
		runNextFrame(1016); // 16ms later
		expect(calls.length).toBe(1);
		expect(calls[0][0]).toBeCloseTo(0.016, 9);
		expect(calls[0][1]).toBeCloseTo(0.016, 9);

		runNextFrame(1049); // 33ms later
		expect(calls.length).toBe(2);
		expect(calls[1][0]).toBeCloseTo(0.033, 9);
		expect(calls[1][1]).toBeCloseTo(0.049, 9);
	});

	it("clamps a huge gap between frames to MAX_FRAME (1/15s) instead of passing it through raw", () => {
		const clock = createClock();
		const calls: number[] = [];
		clock.onTick((dt) => calls.push(dt));

		runNextFrame(1); // primes `last`, dt=0
		runNextFrame(10_001); // a 10s gap — e.g. a backgrounded tab
		expect(calls.length).toBe(1);
		expect(calls[0]).toBeCloseTo(1 / 15, 9);
		expect(calls[0]).toBeLessThan(10);
	});

	it("speed() scales dt computed by tick, not just advance()", () => {
		const clock = createClock();
		clock.setSpeed(2);
		const calls: number[] = [];
		clock.onTick((dt) => calls.push(dt));

		runNextFrame(1);
		runNextFrame(11); // 10ms real time * speed 2 = 0.02s
		expect(calls[0]).toBeCloseTo(0.02, 9);
	});

	it("a paused clock emits nothing and requests no frames", () => {
		const clock = createClock();
		clock.pause();
		const calls: number[] = [];
		clock.onTick((dt) => calls.push(dt));

		expect(scheduled.length).toBe(0);
		expect(calls.length).toBe(0);
	});

	it("the last listener unsubscribing stops scheduling further frames", () => {
		const clock = createClock();
		const unsubscribe = clock.onTick(() => {});
		expect(scheduled.length).toBe(1);

		runNextFrame(0); // dt=0, but the loop still reschedules while listeners exist
		expect(scheduled.length).toBe(1);

		unsubscribe();
		runNextFrame(16); // this tick observes listeners.size === 0 and stops the loop
		expect(scheduled.length).toBe(0);
	});

	it("subscribing again after the loop stopped starts a fresh frame loop with `last` reset", () => {
		const clock = createClock();
		const calls: number[] = [];
		const unsubscribe = clock.onTick((dt) => calls.push(dt));
		runNextFrame(1000);
		runNextFrame(1016);
		expect(calls).toEqual([0.016]);
		unsubscribe();
		runNextFrame(1200); // stops the loop (listeners empty)
		expect(scheduled.length).toBe(0);

		// A fresh onTick restarts the loop; `last` was reset to 0, so the very
		// next tick reports dt=0 again rather than measuring against frame 1200.
		clock.onTick((dt) => calls.push(dt));
		expect(scheduled.length).toBe(1);
		runNextFrame(1500);
		runNextFrame(1516);
		expect(calls).toEqual([0.016, 0.016]);
	});
});

describe("frame loop sharing, suspension", () => {
	let queue: FrameRequestCallback[] = [];
	beforeEach(() => {
		resetFrameLoop();
		queue = [];
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
			queue.push(cb);
			return queue.length;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
	});
	const runFrame = (now: number) => {
		const cbs = queue;
		queue = [];
		for (const cb of cbs) cb(now);
	};

	it("two clocks share one requestAnimationFrame callback per frame", () => {
		const a = createClock();
		const b = createClock();
		const seen: string[] = [];
		a.onTick(() => seen.push("a"));
		b.onTick(() => seen.push("b"));
		expect(queue.length).toBe(1);
		runFrame(1);
		expect(queue.length).toBe(1);
		runFrame(17);
		expect(seen).toEqual(["a", "b"]);
		expect(queue.length).toBe(1);
	});

	it("the loop is idle with no subscribers and stops once the last leaves", () => {
		const clock = createClock();
		expect(queue.length).toBe(0);
		const off = clock.onTick(() => {});
		expect(isFrameLoopRunning()).toBe(true);
		off();
		expect(isFrameLoopRunning()).toBe(false);
		runFrame(1); // the stale callback, had it not been cancelled
		expect(queue.length).toBe(0);
	});

	it("a suspended clock does not tick, leaves the loop, and keeps paused() untouched", () => {
		const clock = createClock();
		const dts: number[] = [];
		clock.onTick((dt) => dts.push(dt));
		const gate = watchClockVisibility(clock);
		expect(gate).not.toBeNull();
		runFrame(1);
		runFrame(17);
		expect(dts.length).toBe(1);

		gate?.setVisible(false);
		expect(clock.paused.peek()).toBe(false);
		expect(isFrameLoopRunning()).toBe(false);
		clock.pause();
		clock.resume();
		gate?.setVisible(true);
		expect(clock.paused.peek()).toBe(false);
		expect(isFrameLoopRunning()).toBe(true);
		runFrame(100_000); // first frame after resume: no giant dt
		runFrame(100_016);
		expect(dts.length).toBe(2);
		expect(dts[1]).toBeCloseTo(0.016, 9);
	});

	it("a user-paused clock leaves the loop and rejoins on resume without a big dt", () => {
		const clock = createClock();
		const dts: number[] = [];
		clock.onTick((dt) => dts.push(dt));
		runFrame(1);
		runFrame(17);
		expect(dts.length).toBe(1);

		clock.pause();
		expect(clock.paused.peek()).toBe(true);
		expect(isFrameLoopRunning()).toBe(false);

		clock.resume();
		expect(isFrameLoopRunning()).toBe(true);
		runFrame(60_000); // first frame after resume primes the timestamp
		runFrame(60_016);
		expect(dts.length).toBe(2);
		expect(dts[1]).toBeCloseTo(0.016, 9);
	});

	it("pausing with no subscribers, then subscribing, does not join the loop until resumed", () => {
		const clock = createClock();
		clock.pause();
		clock.onTick(() => {});
		expect(isFrameLoopRunning()).toBe(false);
		clock.toggle();
		expect(isFrameLoopRunning()).toBe(true);
	});

	it("a clock shared by two stages runs while either is visible", () => {
		const clock = createClock();
		clock.onTick(() => {});
		const one = watchClockVisibility(clock);
		const two = watchClockVisibility(clock);
		one?.setVisible(false);
		expect(isFrameLoopRunning()).toBe(true);
		two?.setVisible(false);
		expect(isFrameLoopRunning()).toBe(false);
		one?.dispose();
		two?.dispose();
		expect(isFrameLoopRunning()).toBe(true);
	});

	it("defaultClock cannot be suspended by a stage", () => {
		expect(watchClockVisibility(defaultClock)).toBeNull();
	});

	it("advance() still works while suspended", () => {
		const clock = createClock();
		watchClockVisibility(clock)?.setVisible(false);
		clock.advance(0.5);
		expect(clock.time.peek()).toBeCloseTo(0.5, 9);
	});

	it("without requestAnimationFrame, subscribing is safe and schedules nothing", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		const clock = createClock();
		expect(() => clock.onTick(() => {})).not.toThrow();
		clock.advance(1);
		expect(clock.time.peek()).toBe(1);
	});
});

describe("readables", () => {
	it("time, paused and speed notify their subscribers", () => {
		const clock = createClock();
		const seen: string[] = [];
		clock.time.subscribe(() => seen.push("time"));
		clock.paused.subscribe(() => seen.push("paused"));
		clock.speed.subscribe(() => seen.push("speed"));
		clock.advance(0.5);
		clock.pause();
		clock.setSpeed(2);
		clock.setSpeed(2); // unchanged: no notification
		expect(seen).toEqual(["time", "paused", "speed"]);
	});

	it("cannot be written through", () => {
		const clock = createClock();
		expect("set" in clock.time).toBe(false);
	});

	it("reducedMotion follows the forced mode and notifies on change", () => {
		const clock = createClock({ reducedMotion: "reduce" });
		expect(clock.reducedMotion.peek()).toBe(true);
		const onStale = vi.fn();
		clock.reducedMotion.subscribe(onStale);
		clock.setReducedMotion("no-preference");
		expect(onStale).toHaveBeenCalled();
		expect(clock.reducedMotion.peek()).toBe(false);
		// "auto" follows the system, which reads as no preference without matchMedia.
		clock.setReducedMotion("auto");
		expect(clock.reducedMotion.peek()).toBe(false);
	});
});
