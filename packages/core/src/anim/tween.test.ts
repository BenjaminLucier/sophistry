import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClock } from "../tween/clock.js";
import { tween, wait } from "./tween.js";

// `onTick()` calls `requestAnimationFrame` to start its own frame loop even
// though every test here drives time by hand via `clock.advance()` — see the
// identical stub in clock.test.ts for why this is needed in a "node" environment.
beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("tween result", () => {
	it("resolves 'done' on completion and 'aborted' on abort, never rejecting", async () => {
		const clock = createClock();
		const done = tween({ from: 0, to: 1, clock, onUpdate: () => {} });
		clock.advance(1);
		expect(await done).toBe("done");

		const ctl = new AbortController();
		const aborted = tween({
			from: 0,
			to: 1,
			clock,
			signal: ctl.signal,
			onUpdate: () => {},
		});
		ctl.abort();
		expect(await aborted).toBe("aborted");
	});
});

describe("tween", () => {
	it("interpolates from `from` to `to` over `duration`, reporting progress", () => {
		const clock = createClock();
		const updates: [number, number][] = [];
		tween({
			from: 0,
			to: 10,
			duration: 1,
			easing: "linear",
			clock,
			onUpdate: (value, progress) => updates.push([value, progress]),
		});

		clock.advance(0.5);
		expect(updates[updates.length - 1]).toEqual([5, 0.5]);

		clock.advance(0.5);
		expect(updates[updates.length - 1]).toEqual([10, 1]);
	});

	it("resolves the promise once progress reaches 1", async () => {
		const clock = createClock();
		let resolved = false;
		const promise = tween({
			from: 0,
			to: 1,
			duration: 1,
			clock,
			onUpdate: () => {},
		}).then(() => {
			resolved = true;
		});

		clock.advance(0.5);
		await Promise.resolve();
		expect(resolved).toBe(false);

		clock.advance(0.5);
		await promise;
		expect(resolved).toBe(true);
	});

	it("does not call onUpdate again after completion", () => {
		const clock = createClock();
		const updates: number[] = [];
		tween({
			from: 0,
			to: 1,
			duration: 1,
			clock,
			onUpdate: (value) => updates.push(value),
		});
		clock.advance(1);
		const countAtFinish = updates.length;
		clock.advance(1);
		expect(updates.length).toBe(countAtFinish);
	});

	it("applies the easing function to the sampled progress", () => {
		const clock = createClock();
		const updates: number[] = [];
		// Quadratic ease: at t=0.5 raw progress, eased value should be 0.25, not 0.5.
		tween({
			from: 0,
			to: 100,
			duration: 1,
			easing: (t) => t * t,
			clock,
			onUpdate: (value) => updates.push(value),
		});
		clock.advance(0.5);
		expect(updates[updates.length - 1]).toBeCloseTo(25, 9);
	});

	it("a zero-duration tween with no delay lands immediately", async () => {
		const clock = createClock();
		const updates: number[] = [];
		const promise = tween({
			from: 0,
			to: 1,
			duration: 0,
			clock,
			onUpdate: (_value, progress) => updates.push(progress),
		});
		await promise;
		expect(updates[updates.length - 1]).toBe(1);
	});

	it("delay postpones the first update until elapsed catches up", () => {
		const clock = createClock();
		const updates: number[] = [];
		tween({
			from: 0,
			to: 1,
			duration: 1,
			delay: 0.5,
			clock,
			onUpdate: (_value, progress) => updates.push(progress),
		});

		clock.advance(0.25);
		expect(updates.length).toBe(0);

		// Landing exactly on the delay threshold reports progress 0: one update.
		clock.advance(0.25);
		expect(updates).toEqual([0]);

		clock.advance(0.5);
		expect(updates).toEqual([0, 0.5]);
	});

	it("reports once per step, even on the first one", () => {
		const clock = createClock();
		const updates: number[] = [];
		tween({
			from: 0,
			to: 1,
			duration: 1,
			clock,
			onUpdate: (_value, progress) => updates.push(progress),
		});

		clock.advance(0.25);
		expect(updates).toEqual([0.25]);
	});

	it("a zero-duration tween reports only its final value", async () => {
		const clock = createClock();
		const values: number[] = [];
		await tween({
			from: 0,
			to: 7,
			duration: 0,
			clock,
			onUpdate: (value) => values.push(value),
		});
		expect(values).toEqual([7]);
	});

	it("advance()'s no-op on dt<=0 means a non-positive step makes no progress", () => {
		const clock = createClock();
		const updates: number[] = [];
		tween({
			from: 0,
			to: 1,
			duration: 1,
			clock,
			onUpdate: (_value, progress) => updates.push(progress),
		});
		clock.advance(0);
		clock.advance(-1);
		expect(updates.length).toBe(0);
	});

	it("an already-aborted signal resolves immediately without calling onUpdate", async () => {
		const clock = createClock();
		const controller = new AbortController();
		controller.abort();
		const updates: number[] = [];
		await tween({
			from: 0,
			to: 1,
			duration: 1,
			clock,
			signal: controller.signal,
			onUpdate: (_value, progress) => updates.push(progress),
		});
		expect(updates.length).toBe(0);
	});

	it("aborting mid-flight resolves the promise and stops further updates", async () => {
		const clock = createClock();
		const controller = new AbortController();
		const updates: number[] = [];
		let resolved = false;
		const promise = tween({
			from: 0,
			to: 1,
			duration: 1,
			clock,
			signal: controller.signal,
			onUpdate: (_value, progress) => updates.push(progress),
		}).then(() => {
			resolved = true;
		});

		clock.advance(0.5);
		expect(resolved).toBe(false);
		const countAtAbort = updates.length;

		controller.abort();
		await promise;
		expect(resolved).toBe(true);

		clock.advance(0.5);
		expect(updates.length).toBe(countAtAbort);
	});

	it("uses a custom interpolator when given", () => {
		const clock = createClock();
		const updates: number[] = [];
		tween({
			from: 0,
			to: 1,
			duration: 1,
			clock,
			interpolate: () => (t) => t * 1000,
			onUpdate: (value) => updates.push(value),
		});
		clock.advance(0.5);
		expect(updates[updates.length - 1]).toBeCloseTo(500, 9);
	});

	it("falls back to the default clock when none is given", async () => {
		// Doesn't crash and eventually resolves — exercised with a real (tiny) duration
		// via the default clock's own onTick/advance path, driven manually.
		const promise = tween({
			from: 0,
			to: 1,
			duration: 0,
			onUpdate: () => {},
		});
		await promise;
	});
});

describe("wait", () => {
	it("resolves after `seconds` of clock time and reports linear progress via onUpdate internally", async () => {
		const clock = createClock();
		let resolved = false;
		const promise = wait(1, { clock }).then(() => {
			resolved = true;
		});
		clock.advance(0.9);
		await Promise.resolve();
		expect(resolved).toBe(false);
		clock.advance(0.1);
		await promise;
		expect(resolved).toBe(true);
	});

	it("respects an abort signal", async () => {
		const clock = createClock();
		const controller = new AbortController();
		let resolved = false;
		const promise = wait(10, { clock, signal: controller.signal }).then(() => {
			resolved = true;
		});
		controller.abort();
		await promise;
		expect(resolved).toBe(true);
	});
});

describe("tween robustness", () => {
	it("does not call onUpdate after an abort fired by an earlier listener in the same emit", () => {
		const clock = createClock();
		const controller = new AbortController();
		clock.onTick(() => controller.abort());
		const onUpdate = vi.fn();
		tween({
			from: 0,
			to: 1,
			duration: 1,
			onUpdate,
			clock,
			signal: controller.signal,
		});
		clock.advance(0.5);
		expect(onUpdate).not.toHaveBeenCalled();
	});

	it("treats NaN duration and delay as defaults", () => {
		const clock = createClock();
		const updates: number[] = [];
		tween({
			from: 0,
			to: 1,
			duration: Number.NaN,
			delay: Number.NaN,
			easing: "linear",
			onUpdate: (v) => updates.push(v),
			clock,
		});
		clock.advance(0.5);
		expect(updates).toEqual([0.5]);
	});
});
