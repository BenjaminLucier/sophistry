import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../reactive";
import { createClock } from "../tween/clock";
import { resetFrameLoop } from "../tween/frame-loop";
import {
	prefersReducedMotion,
	resetReducedMotion,
} from "../tween/reduced-motion";
import { trackPoint } from "../tween/track";
import { fadeIn } from "./fade";
import { moveBy, valueTo } from "./move";
import { forever, hold, parallel, sequence } from "./sequence";
import { play, timeline } from "./timeline";
import { wait } from "./tween";

const lin = { easing: "linear" } as const;

/** A controllable `matchMedia` for the reduced-motion query, on a stub `window`. */
function mockMedia(initial: boolean) {
	const listeners = new Set<(e: { matches: boolean }) => void>();
	const query = {
		matches: initial,
		addEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
			listeners.add(fn),
		removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
			listeners.delete(fn),
	};
	const matchMedia = vi.fn(() => query);
	vi.stubGlobal("window", { matchMedia });
	return {
		set(matches: boolean) {
			query.matches = matches;
			for (const fn of listeners) fn({ matches });
		},
		listeners,
		matchMedia,
	};
}

beforeEach(() => {
	resetFrameLoop();
	resetReducedMotion();
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
	resetReducedMotion();
});

describe("prefersReducedMotion", () => {
	it("follows the media query live and notifies subscribers", () => {
		const media = mockMedia(false);
		expect(prefersReducedMotion.peek()).toBe(false);
		const onStale = vi.fn();
		const stop = prefersReducedMotion.subscribe(onStale);
		media.set(true);
		expect(onStale).toHaveBeenCalledTimes(1);
		expect(prefersReducedMotion.peek()).toBe(true);
		media.set(false);
		expect(prefersReducedMotion.peek()).toBe(false);
		stop();
	});

	it("reads an initial true", () => {
		mockMedia(true);
		expect(prefersReducedMotion.peek()).toBe(true);
	});

	it("is false without matchMedia", () => {
		vi.stubGlobal("window", {});
		expect(prefersReducedMotion.peek()).toBe(false);
	});

	it("does not touch matchMedia until first read", () => {
		const media = mockMedia(true);
		createClock();
		expect(media.matchMedia).not.toHaveBeenCalled();
		expect(createClock().reducedMotion.peek()).toBe(true);
		expect(media.matchMedia).toHaveBeenCalledTimes(1);
	});
});

describe("clock modes", () => {
	it("auto follows the system, forced modes do not", () => {
		const media = mockMedia(true);
		const clock = createClock();
		expect(clock.reducedMotion.peek()).toBe(true);
		clock.setReducedMotion("no-preference");
		expect(clock.reducedMotion.peek()).toBe(false);
		media.set(false);
		clock.setReducedMotion("reduce");
		expect(clock.reducedMotion.peek()).toBe(true);
		expect(createClock({ reducedMotion: "reduce" }).reducedMotion.peek()).toBe(
			true,
		);
	});
});

describe("timeline under reduced motion", () => {
	it("play jumps to the end state and resolves done", async () => {
		mockMedia(true);
		const clock = createClock();
		const a = track(0);
		const p = trackPoint(0, 0);
		const result = await play(sequence(fadeIn(a), moveBy(p, { x: 2, y: 0 })), {
			clock,
		});
		expect(result).toBe("done");
		expect(a.peek()).toBe(1);
		expect(p.peek().x).toBe(2);
	});

	it("does nothing special without the preference", () => {
		mockMedia(false);
		const clock = createClock();
		const a = track(0);
		void play(valueTo(a, 1, { duration: 1, ...lin }), { clock });
		expect(a.peek()).toBe(0);
		clock.advance(0.5);
		expect(a.peek()).toBeCloseTo(0.5, 9);
	});

	it("forever holds its start; finite siblings rest at their end", async () => {
		mockMedia(true);
		const clock = createClock();
		const a = track(0);
		const s = track(1);
		const result = await play(
			sequence(
				valueTo(a, 1, { duration: 1, ...lin }),
				forever(valueTo(s, 5, { duration: 1, ...lin })),
			),
			{ clock },
		);
		expect(result).toBe("done");
		expect(a.peek()).toBe(1);
		expect(s.peek()).toBe(1);
	});

	it("a pure forever stays at its start and does not subscribe the clock", () => {
		mockMedia(true);
		const clock = createClock();
		const s = track(1);
		void play(forever(valueTo(s, 5, { duration: 1, ...lin })), { clock });
		clock.advance(3);
		expect(s.peek()).toBe(1);
	});

	it("motion: essential still plays", () => {
		mockMedia(true);
		const clock = createClock();
		const a = track(0);
		void play(valueTo(a, 1, { duration: 1, ...lin }), {
			clock,
			motion: "essential",
		});
		clock.advance(0.5);
		expect(a.peek()).toBeCloseTo(0.5, 9);
	});

	it("a context mode overrides the clock", () => {
		mockMedia(false);
		const clock = createClock();
		const a = track(0);
		void play(valueTo(a, 1, { duration: 1 }), {
			clock,
			reducedMotion: "reduce",
		});
		expect(a.peek()).toBe(1);
	});

	it("flipping the preference mid-run finishes the run on the next step", async () => {
		const media = mockMedia(false);
		const clock = createClock();
		const a = track(0);
		const run = play(valueTo(a, 10, { duration: 10, ...lin }), { clock });
		clock.advance(1);
		expect(a.peek()).toBe(1);
		media.set(true);
		clock.advance(0.1);
		expect(await run).toBe("done");
		expect(a.peek()).toBe(10);
	});

	it("explicit seek is untouched by the preference (scrubbing is user-driven)", () => {
		mockMedia(true);
		const a = track(0);
		const tl = timeline(valueTo(a, 10, { duration: 1, ...lin }), {
			clock: createClock(),
		});
		tl.seek(0.5);
		expect(a.peek()).toBe(5);
	});

	it("parallel of finite animations rests at the longest", async () => {
		mockMedia(true);
		const a = track(0);
		const b = track(0);
		await play(
			parallel(valueTo(a, 1), valueTo(b, 2, { duration: 3 }), hold(2)),
			{
				clock: createClock(),
			},
		);
		expect([a.peek(), b.peek()]).toEqual([1, 2]);
	});

	it("wait() keeps real time under reduced motion", () => {
		mockMedia(true);
		const clock = createClock();
		let done = false;
		void wait(1, { clock }).then(() => {
			done = true;
		});
		expect(done).toBe(false);
		clock.advance(1);
	});
});

describe("a Readable reducedMotion (what a scene passes)", () => {
	it("governs the run instead of the clock, read live", async () => {
		mockMedia(false);
		const clock = createClock();
		const reduced = track(true);
		const a = track(0);
		expect(
			await play(valueTo(a, 1, { duration: 1, ...lin }), {
				clock,
				reducedMotion: reduced,
			}),
		).toBe("done");
		expect(a.peek()).toBe(1);
		reduced.set(false);
		const b = track(0);
		const run = play(valueTo(b, 10, { duration: 10, ...lin }), {
			clock,
			reducedMotion: reduced,
		});
		clock.advance(1);
		expect(b.peek()).toBe(1);
		reduced.set(true);
		clock.advance(0.1);
		expect(await run).toBe("done");
		expect(b.peek()).toBe(10);
	});

	it("defers to the clock's mode when none is given", async () => {
		mockMedia(false);
		const clock = createClock({ reducedMotion: "reduce" });
		const a = track(0);
		await play(valueTo(a, 1, { duration: 1 }), { clock });
		expect(a.peek()).toBe(1);
	});
});
