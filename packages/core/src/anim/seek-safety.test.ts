import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../reactive";
import { createClock } from "../tween/clock";
import type { Animation } from "./animation";
import { valueTo } from "./move";
import { forever, hold, lagged, parallel, repeat, sequence } from "./sequence";
import { timeline } from "./timeline";

// A regression here is a synchronous infinite loop, which no test timeout can
// interrupt; run this file under `timeout` if you suspect one.

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** Small deterministic PRNG (mulberry32) so a failure reproduces. */
function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SEEKS = [
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	Number.NaN,
	0,
	-1,
	1e308,
	1e17,
];

describe("non-finite seeks and reduced motion", () => {
	it("sequence(forever, hold) under reduced motion terminates and rests", async () => {
		const x = track(0);
		const tl = timeline(
			sequence(forever(valueTo(x, 1, { duration: 1 })), hold(1)),
			{ reducedMotion: "reduce", clock: createClock() },
		);
		await expect(tl.play()).resolves.toBe("done");
		expect(Number.isFinite(tl.time.peek())).toBe(true);
	}, 2000);

	it("seek(Infinity) on an endless animation terminates and stays finite", () => {
		const x = track(0);
		for (const a of [
			forever(valueTo(x, 1, { duration: 1, easing: "linear" })),
			sequence(forever(hold(1)), hold(1)),
			lagged([forever(hold(1)), hold(1)], { lagRatio: 0 }),
		]) {
			const tl = timeline(a, { clock: createClock() });
			tl.seek(Number.POSITIVE_INFINITY);
			expect(Number.isFinite(tl.time.peek())).toBe(true);
			expect(Number.isNaN(x.peek())).toBe(false);
		}
	}, 2000);

	it("a reduced-motion run resolves under fake timers (no setTimeout)", async () => {
		vi.useFakeTimers();
		const tl = timeline(hold(1), {
			reducedMotion: "reduce",
			clock: createClock(),
		});
		await expect(tl.play()).resolves.toBe("done");
	}, 2000);

	it("seek(NaN) is treated as 0", () => {
		const x = track(0);
		const tl = timeline(valueTo(x, 1, { duration: 1, easing: "linear" }), {
			clock: createClock(),
		});
		tl.seek(0.5);
		tl.seek(Number.NaN);
		expect(tl.time.peek()).toBe(0);
		expect(x.peek()).toBe(0);
	});

	it("fuzz: random compositions survive random and non-finite seeks", () => {
		const rand = rng(1234);
		const tracks = Array.from({ length: 4 }, () => track(0));
		const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
		const length = () => pick([0, 0, 0.25, 1, 2.5, Math.PI]);
		const leaf = (): Animation =>
			rand() < 0.3
				? hold(length())
				: valueTo(pick(tracks), rand() * 10, {
						duration: length(),
						easing: "linear",
					});
		const build = (depth: number): Animation => {
			if (depth === 0) return leaf();
			const kids = () =>
				Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
					build(depth - 1),
				);
			switch (Math.floor(rand() * 6)) {
				case 0:
					return sequence(...kids());
				case 1:
					return parallel(...kids());
				case 2:
					return forever(build(depth - 1), {
						start: pick(["continue", "fixed"] as const),
					});
				case 3:
					return repeat(build(depth - 1), pick([0, 0.5, 1, 2, 3.5]), {
						start: pick(["continue", "fixed"] as const),
					});
				case 4:
					return lagged(kids(), {
						lagRatio: pick([0, 0.5, 1, 2]),
					});
				default:
					return lagged(kids(), { lag: pick([0, 0.15, 1]) });
			}
		};
		for (let n = 0; n < 400; n++) {
			for (const t of tracks) t.set(0);
			const a = build(3);
			const tl = timeline(a, {
				clock: createClock(),
				reducedMotion: n % 2 ? "reduce" : "no-preference",
			});
			const times = [
				...SEEKS,
				...Array.from({ length: 6 }, () => rand() * 12 - 1),
			];
			for (const t of times) {
				tl.seek(t);
				expect(Number.isNaN(tl.time.peek())).toBe(false);
				for (const tr of tracks) expect(Number.isNaN(tr.peek())).toBe(false);
			}
			void tl.play();
			tl.abort();
		}
	}, 20_000);
});
