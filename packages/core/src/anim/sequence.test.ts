import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../reactive/index.js";
import { createClock } from "../tween/clock.js";
import { trackPoint } from "../tween/track.js";
import { animation, compose } from "./animation.js";
import { fadeInFrom } from "./fade.js";
import { growFromCenter, growFromPoint, spinInFromNothing } from "./growing.js";
import { moveBy, moveTo, valueTo } from "./move.js";
import {
	forever,
	hold,
	lagged,
	parallel,
	repeat,
	sequence,
} from "./sequence.js";
import { play, timeline } from "./timeline.js";
import { driveProgress, driveTrack } from "./types.js";

// The clock starts a rAF loop on subscribe; tests drive time by hand instead.
beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const lin = { easing: "linear" } as const;

describe("durations", () => {
	it("sequence is the sum, parallel the max, lagged offset + longest", () => {
		const a = hold(1);
		const b = hold(2.5);
		expect(sequence(a, b).duration).toBe(3.5);
		expect(parallel(a, b).duration).toBe(2.5);
		expect(lagged([a, b], { lag: 0.5 }).duration).toBe(3);
		expect(lagged([a, b, a], { lag: 2 }).duration).toBe(5);
		expect(repeat(b, 3).duration).toBe(7.5);
		expect(forever(b).duration).toBe(Number.POSITIVE_INFINITY);
		expect(valueTo(track(0), 1, { delay: 0.25, duration: 2 }).duration).toBe(
			2.25,
		);
	});

	it("lagRatio offsets each child by a fraction of the previous duration", () => {
		const log: [number, number][] = [];
		const probe = (id: number, d: number) =>
			animation({ duration: d, seek: (t) => log.push([id, t]) });
		const anim = lagged([probe(0, 2), probe(1, 2), probe(2, 4)], {
			lagRatio: 0.5,
		});
		// Starts at 0, 1, 2; the last lasts 4 -> total 6.
		expect(anim.duration).toBe(6);
		const tl = timeline(anim);
		tl.seek(1.5);
		expect(log).toContainEqual([1, 0.5]);
		expect(log.some(([id]) => id === 2)).toBe(false);
	});
});

describe("drift-free sequencing", () => {
	it("lands every boundary exactly regardless of the step size", () => {
		const clock = createClock();
		const x = track(0);
		const seen: number[] = [];
		const anim = sequence(
			valueTo(x, 10, { duration: 0.3, ...lin }),
			valueTo(x, 20, { duration: 0.3, ...lin }),
			valueTo(x, 30, { duration: 0.3, ...lin }),
		);
		expect(anim.duration).toBeCloseTo(0.9, 12);
		const done = play(anim, { clock });
		// 0.07 does not divide 0.3: every boundary falls inside a frame.
		for (let i = 0; i < 14; i++) {
			clock.advance(0.07);
			seen.push(x.peek());
		}
		// 0.28 s elapsed
		expect(seen[3]).toBeCloseTo((0.28 / 0.3) * 10, 9);
		// 0.35 s: second step is 0.05/0.3 through, so leftover of frame 5 counted.
		expect(seen[4]).toBeCloseTo(10 + (0.05 / 0.3) * 10, 9);
		// 0.84 s: third step 0.24/0.3 through.
		expect(seen[11]).toBeCloseTo(20 + (0.24 / 0.3) * 10, 9);
		return done.then(() => undefined).catch(() => undefined);
	});

	it("finishes at exactly the summed duration with the exact end value", async () => {
		const clock = createClock();
		const x = track(0);
		const result = play(
			sequence(
				valueTo(x, 1, { duration: 0.1, ...lin }),
				valueTo(x, 2, { duration: 0.2, ...lin }),
				valueTo(x, 3, { duration: 0.3, ...lin }),
			),
			{ clock },
		);
		let steps = 0;
		while (x.peek() !== 3 && steps < 100) {
			clock.advance(0.05);
			steps++;
		}
		expect(await result).toBe("done");
		expect(x.peek()).toBe(3);
		// 0.6 s at 0.05 s per step.
		expect(steps).toBe(12);
	});

	it("a lagged branch does not drift over many children", () => {
		const clock = createClock();
		const tracks = Array.from({ length: 10 }, () => track(0));
		void play(
			lagged(
				tracks.map((t) => valueTo(t, 1, { duration: 1, ...lin })),
				{ lag: 0.1 },
			),
			{ clock },
		);
		clock.advance(0.7);
		expect(tracks[0]?.peek()).toBeCloseTo(0.7, 9);
		expect(tracks[6]?.peek()).toBeCloseTo(0.1, 9);
		expect(tracks[7]?.peek()).toBe(0);
	});
});

describe("advance fast-forwards a whole nested play", () => {
	it("one advance() finishes a nested script and resolves done", async () => {
		const clock = createClock();
		const a = track(0);
		const p = trackPoint(0, 0);
		const result = play(
			sequence(
				valueTo(a, 1, { duration: 2 }),
				parallel(
					moveBy(p, { x: 1, y: 0 }, { duration: 1 }),
					repeat(valueTo(a, 5, { duration: 0.5 }), 3),
				),
				hold(1),
			),
			{ clock },
		);
		clock.advance(10);
		expect(await result).toBe("done");
		expect(p.peek()).toEqual({ x: 1, y: 0 });
		expect(a.peek()).toBe(5);
	});
});

describe("seeking", () => {
	it("restores start values, including a relative moveBy, when seeked backwards", () => {
		const p = trackPoint(1, 1);
		const tl = timeline(
			sequence(
				moveBy(p, { x: 2, y: 0 }, { duration: 1, ...lin }),
				moveBy(p, { x: 0, y: 3 }, { duration: 1, ...lin }),
			),
		);
		tl.seek(2);
		expect(p.peek()).toEqual({ x: 3, y: 4 });
		tl.seek(1.5);
		expect(p.peek()).toEqual({ x: 3, y: 2.5 });
		tl.seek(0.5);
		expect(p.peek()).toEqual({ x: 2, y: 1 });
		tl.seek(0);
		expect(p.peek()).toEqual({ x: 1, y: 1 });
		// And forwards again: recaptured from the restored value.
		tl.seek(2);
		expect(p.peek()).toEqual({ x: 3, y: 4 });
	});

	it("a later relative step captures what the earlier one left, even when skipped over", () => {
		const x = track(0);
		const tl = timeline(
			sequence(
				valueTo(x, (v) => v + 1, { duration: 1, ...lin }),
				valueTo(x, (v) => v + 10, { duration: 1, ...lin }),
			),
		);
		tl.seek(2);
		expect(x.peek()).toBe(11);
	});

	it("a finished child does not clobber a still-running one on the same track", () => {
		const x = track(0);
		const tl = timeline(
			parallel(
				valueTo(x, 1, { duration: 1, ...lin }),
				valueTo(x, 100, { duration: 4, ...lin }),
			),
		);
		tl.seek(2);
		expect(x.peek()).toBe(50);
		tl.seek(3);
		expect(x.peek()).toBe(75);
	});

	it("delay is a leading offset inside the duration", () => {
		const x = track(0);
		const anim = valueTo(x, 10, { delay: 1, duration: 2, ...lin });
		const tl = timeline(anim);
		tl.seek(0.5);
		expect(x.peek()).toBe(0);
		tl.seek(2);
		expect(x.peek()).toBe(5);
		tl.seek(0.5);
		expect(x.peek()).toBe(0);
	});

	it("scrubbing time() is reactive and clamps to the duration", () => {
		const tl = timeline(hold(2));
		tl.seek(5);
		expect(tl.time.peek()).toBe(2);
		tl.seek(-1);
		expect(tl.time.peek()).toBe(0);
		expect(tl.duration).toBe(2);
	});

	it("repeat re-enters each cycle, so relative moves accumulate", () => {
		const p = trackPoint(0, 0);
		const tl = timeline(
			repeat(moveBy(p, { x: 1, y: 0 }, { duration: 1, ...lin }), 3),
		);
		tl.seek(2.5);
		expect(p.peek().x).toBeCloseTo(2.5, 9);
		tl.seek(3);
		expect(p.peek().x).toBe(3);
	});

	it("a forever loop of A to B to A has no jump at the cycle seam", () => {
		const clock = createClock();
		const x = track(1);
		void play(
			forever(
				sequence(
					valueTo(x, 2, { duration: 1, ...lin }),
					valueTo(x, 0, { duration: 1, ...lin }),
				),
			),
			{ clock },
		);
		const seen: number[] = [];
		for (let i = 0; i < 12; i++) {
			clock.advance(0.35);
			seen.push(x.peek());
		}
		// Cycle 1 begins from 0 (where cycle 0 ended), not from the original 1.
		for (let i = 1; i < seen.length; i++) {
			expect(Math.abs((seen[i] ?? 0) - (seen[i - 1] ?? 0))).toBeLessThan(0.75);
		}
	});

	it("a seek over many cycles replays them", () => {
		const x = track(0);
		const tl = timeline(
			repeat(
				valueTo(x, (v) => v + 1, { duration: 1 }),
				100,
			),
		);
		tl.seek(50.5);
		expect(x.peek()).toBeGreaterThan(50);
		expect(x.peek()).toBeLessThan(51);
		tl.seek(100);
		expect(x.peek()).toBe(100);
	});
});

describe("abort propagation", () => {
	it("aborting resolves 'aborted' and calls abort() on active leaves only", async () => {
		const clock = createClock();
		const ctl = new AbortController();
		const log: string[] = [];
		const leaf = (name: string, d: number) =>
			animation({
				duration: d,
				seek: () => {},
				abort: () => log.push(name),
			});
		const result = play(
			sequence(
				leaf("first", 1),
				repeat(sequence(leaf("a", 1), leaf("b", 1)), 5),
				leaf("last", 1),
			),
			{ clock, signal: ctl.signal },
		);
		clock.advance(2.5); // inside repeat cycle 1, in "b"... a: 1..2, b: 2..3
		ctl.abort();
		expect(await result).toBe("aborted");
		expect(log).toEqual(["b"]);
		// Nothing runs after abort.
		clock.advance(10);
		expect(log).toEqual(["b"]);
	});

	it("forever stops only when aborted", async () => {
		const clock = createClock();
		const ctl = new AbortController();
		const x = track(0);
		const result = play(
			forever(
				sequence(
					valueTo(x, 1, { duration: 1, ...lin }),
					valueTo(x, 0, { duration: 1, ...lin }),
				),
			),
			{ clock, signal: ctl.signal },
		);
		clock.advance(1000.25);
		expect(x.peek()).toBeCloseTo(0.25, 6);
		ctl.abort();
		expect(await result).toBe("aborted");
	});

	it("an already-aborted signal resolves 'aborted' without touching anything", async () => {
		const ctl = new AbortController();
		ctl.abort();
		const x = track(0);
		expect(await play(valueTo(x, 1), { signal: ctl.signal })).toBe("aborted");
		expect(x.peek()).toBe(0);
	});
});

describe("driveProgress / driveTrack leaves", () => {
	it("driveProgress passes eased and raw progress and runs begin once", () => {
		const calls: [number, number][] = [];
		let begins = 0;
		const anim = driveProgress((t, raw) => calls.push([t, raw]), {
			duration: 2,
			easing: (t) => t * t,
			begin: () => {
				begins++;
			},
		});
		const tl = timeline(anim);
		tl.seek(1);
		tl.seek(1);
		expect(calls.at(-1)).toEqual([0.25, 0.5]);
		expect(begins).toBe(1);
	});

	it("driveTrack resolves a function target against the value at entry", () => {
		const x = track(2);
		const tl = timeline(driveTrack(x, (v) => v * 10, { duration: 1, ...lin }));
		tl.seek(1);
		expect(x.peek()).toBe(20);
	});

	it("moveTo ends exactly on its target", () => {
		const p = trackPoint(0, 0);
		const tl = timeline(moveTo(p, { x: 3, y: -1 }));
		tl.seek(1);
		expect(p.peek()).toEqual({ x: 3, y: -1 });
	});
});

describe("restore versus re-arm", () => {
	const reentry = (
		build: (s: ReturnType<typeof track<number>>) => ReturnType<typeof parallel>,
	) => {
		const s = track(1);
		const tl = timeline(sequence(hold(1), build(s)));
		const seen: number[] = [];
		for (const t of [2, 0.5, 1.5, 2]) {
			tl.seek(t);
			seen.push(s.peek());
		}
		return seen;
	};

	it("scrubbing back past a from-style leaf and forward keeps its rest value", () => {
		expect(reentry((s) => growFromCenter(s, lin))[3]).toBe(1);
		expect(reentry((s) => spinInFromNothing(s, track(0), lin))[3]).toBe(1);
		const seen = reentry((s) => growFromCenter(s, lin));
		expect(seen).toEqual([1, 0, 0.5, 1]);
	});

	it("covers growFromPoint, growFromEdge and fadeInFrom", () => {
		const scale = track(1);
		const pos = trackPoint(2, 3);
		const tl = timeline(
			sequence(hold(1), growFromPoint(scale, pos, { x: 0, y: 0 }, lin)),
		);
		for (const t of [2, 0.5, 1.5, 2]) tl.seek(t);
		expect([scale.peek(), pos.peek()]).toEqual([1, { x: 2, y: 3 }]);

		const o = track(0.8);
		const p = trackPoint(1, 1);
		const tf = timeline(
			sequence(hold(1), fadeInFrom(o, p, { x: 5, y: 0 }, lin)),
		);
		for (const t of [2, 0.5, 1.5, 2]) tf.seek(t);
		expect(p.peek()).toEqual({ x: 1, y: 1 });
		expect(o.peek()).toBe(1);
	});

	it("a fresh repeat cycle still recaptures", () => {
		const x = track(0);
		void timeline(
			repeat(
				valueTo(x, (v) => v + 5, { duration: 1, easing: "linear" }),
				2,
			),
		).seek(2);
		expect(x.peek()).toBe(10);
	});

	it("restoring before a zero-length leaf writes its start, not its end", () => {
		const x = track(0);
		const tl = timeline(sequence(hold(1), valueTo(x, 5, { duration: 0 })));
		tl.seek(2);
		expect(x.peek()).toBe(5);
		tl.seek(0.5);
		expect(x.peek()).toBe(0);
		tl.seek(2);
		expect(x.peek()).toBe(5);
	});

	it("a custom leaf without restore is still re-armed on re-entry", () => {
		let begins = 0;
		const custom = animation({
			duration: 1,
			begin: () => begins++,
			seek: () => {},
		});
		const tl = timeline(sequence(hold(1), custom));
		tl.seek(1.5);
		tl.seek(0.5);
		tl.seek(1.5);
		expect(begins).toBe(2);
	});
});

describe("fractional repeat", () => {
	it("ends part-way through the last cycle", () => {
		const x = track(0);
		const tl = timeline(
			repeat(driveTrack(x, 10, { duration: 1, from: 0, ...lin }), 1.5),
		);
		expect(tl.duration).toBe(1.5);
		tl.seek(1.25);
		expect(x.peek()).toBeCloseTo(2.5);
		tl.seek(1.5);
		expect(x.peek()).toBeCloseTo(5);
	});

	it("a whole count still ends on a full cycle", () => {
		const x = track(0);
		const tl = timeline(repeat(valueTo(x, 10, { duration: 1, ...lin }), 3));
		tl.seek(3);
		expect(x.peek()).toBe(10);
	});
});

describe("lagged with infinite children", () => {
	it("lagRatio 0 never produces NaN", () => {
		const a = forever(hold(1));
		const l = lagged([a, hold(1)], { lagRatio: 0 });
		expect(l.duration).toBe(Number.POSITIVE_INFINITY);
		const x = track(0);
		const tl = timeline(
			lagged([forever(hold(1)), valueTo(x, 1, { duration: 1, ...lin })], {
				lagRatio: 0,
			}),
		);
		tl.seek(0.5);
		expect(x.peek()).toBe(0.5);
	});
});

describe("large composites", () => {
	it("a steady-state step touches only the active children (start-time index)", () => {
		const n = 2000;
		let reads = 0;
		const children = Array.from({ length: n }, (_, i) => ({
			// Counting reads of `start` shows how many children a seek visits.
			get start() {
				reads++;
				return i;
			},
			animation: animation({ duration: 1, seek: () => {} }),
		}));
		const composite = compose(children);
		composite.seek(0);
		reads = 0;
		for (let k = 1; k <= 100; k++) composite.seek(k * 0.25);
		// About two children are active per step; an O(n) walk would read 2000.
		expect(reads / 100).toBeLessThan(20);
	});

	it("a backward seek reopens finished children and rewinds crossed ones", () => {
		const tracks = Array.from({ length: 6 }, () => track(0));
		const make = () =>
			lagged(
				tracks.map((t) => valueTo(t, 1, { duration: 2, easing: "linear" })),
				{ lag: 0.5 },
			);
		const scrubbed = timeline(make());
		for (const t of [4.5, 1.2, 3.3, 0.1, 2.75]) scrubbed.seek(t);
		const values = tracks.map((t) => t.peek());
		for (const t of tracks) t.set(0);
		timeline(make()).seek(2.75);
		expect(tracks.map((t) => t.peek())).toEqual(
			values.map((value) => expect.closeTo(value, 9)),
		);
	});

	it("enters many children in start order without per-seek sorting", () => {
		const tracks = Array.from({ length: 200 }, () => track(0));
		const tl = timeline(
			lagged(
				tracks.map((t) => valueTo(t, 1, { duration: 1, ...lin })),
				{ lag: 0.01 },
			),
		);
		tl.seek(0.5);
		expect(tracks[0]?.peek()).toBe(0.5);
		expect(tracks[50]?.peek()).toBeCloseTo(0);
		tl.seek(10);
		expect(tracks.every((t) => t.peek() === 1)).toBe(true);
		tl.seek(0);
		expect(tracks.every((t) => t.peek() === 0)).toBe(true);
	});
});

describe("repeat / forever start option", () => {
	const hop = (p: ReturnType<typeof trackPoint>) =>
		moveBy(p, { x: 1, y: 0 }, { duration: 1, ...lin });

	it("continue (default) accumulates relative moves across cycles", () => {
		const p = trackPoint(0, 0);
		const tl = timeline(repeat(hop(p), 3, { start: "continue" }));
		tl.seek(3);
		expect(p.peek().x).toBe(3);
		// Scrubbing back across a boundary re-samples cycle 1 from the start
		// captured for cycle 2 (x = 2): the documented offset of "continue".
		tl.seek(1.5);
		expect(p.peek().x).toBeCloseTo(2.5, 9);
	});

	it("fixed repeats the same move every cycle", () => {
		const p = trackPoint(0, 0);
		const tl = timeline(repeat(hop(p), 3, { start: "fixed" }));
		tl.seek(0.5);
		expect(p.peek().x).toBeCloseTo(0.5, 9);
		tl.seek(1.5);
		expect(p.peek().x).toBeCloseTo(0.5, 9); // cycle 1 restarts from 0
		tl.seek(2.25);
		expect(p.peek().x).toBeCloseTo(0.25, 9);
		tl.seek(3);
		expect(p.peek().x).toBe(1);
	});

	it("fixed is exact when scrubbing back and forth across cycles", () => {
		const p = trackPoint(2, 0);
		const tl = timeline(
			repeat(
				sequence(hop(p), moveBy(p, { x: 0, y: 4 }, { duration: 1, ...lin })),
				3,
				{ start: "fixed" },
			),
		);
		const expected = (t: number) => {
			const local = t % 2;
			return local <= 1 ? { x: 2 + local, y: 0 } : { x: 3, y: 4 * (local - 1) };
		};
		for (const t of [5.5, 0.25, 3.75, 2.5, 1.0, 5.9, 4.1, 0, 2.0, 3.0]) {
			tl.seek(t);
			const want = expected(t);
			expect(p.peek().x).toBeCloseTo(want.x, 9);
			expect(p.peek().y).toBeCloseTo(want.y, 9);
		}
		tl.seek(0);
		expect(p.peek()).toEqual({ x: 2, y: 0 });
	});

	it("fixed applies to forever and keeps cycles identical over time", () => {
		const clock = createClock();
		const p = trackPoint(0, 0);
		void play(forever(hop(p), { start: "fixed" }), { clock });
		clock.advance(0.5);
		expect(p.peek().x).toBeCloseTo(0.5, 9);
		clock.advance(5);
		expect(p.peek().x).toBeCloseTo(0.5, 9);
	});

	it("continue forever still accumulates", () => {
		const clock = createClock();
		const p = trackPoint(0, 0);
		void play(forever(hop(p)), { clock });
		clock.advance(0.5);
		clock.advance(5);
		expect(p.peek().x).toBeCloseTo(5.5, 9);
	});

	it("a timeline replay restores a fixed repeat and runs it identically", async () => {
		const clock = createClock();
		const p = trackPoint(0, 0);
		const tl = timeline(repeat(hop(p), 2, { start: "fixed" }), { clock });
		const first = tl.play();
		clock.advance(2);
		await first;
		expect(p.peek().x).toBe(1);
		void tl.play();
		expect(p.peek().x).toBe(0);
		clock.advance(0.5);
		expect(p.peek().x).toBeCloseTo(0.5, 9);
	});
});

describe("compose: finished children are not rewritten", () => {
	it("a later nested sibling is not clobbered by an earlier finished leaf on a big jump", () => {
		const x = track(0);
		const tl = timeline(
			sequence(
				valueTo(x, 1, { duration: 1, ...lin }),
				sequence(valueTo(x, 2, { duration: 1, ...lin })),
				hold(1),
				hold(1),
			),
		);
		tl.seek(4);
		expect(x.peek()).toBe(2);
	});
});

describe("seek is path independent (randomized)", () => {
	/** Small deterministic PRNG so failures reproduce from the seed. */
	const rng = (seed: number) => () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};

	/**
	 * Random nested sequence/parallel/lagged over shared tracks. Parallel children
	 * get disjoint tracks: two overlapping animations of one track are resolved
	 * by "a finished child is not rewritten", which depends on history by design.
	 */
	const build = (seed: number, tracks: ReturnType<typeof track<number>>[]) => {
		const next = rng(seed);
		const dur = () => 0.5 + Math.floor(next() * 4) * 0.5;
		const make = (depth: number, avail: number[]): ReturnType<typeof hold> => {
			const kind =
				depth <= 0 || avail.length === 0 ? 0 : 1 + Math.floor(next() * 4);
			if (avail.length === 0) return hold(dur());
			const count = 2 + Math.floor(next() * 2);
			const split = () =>
				Array.from({ length: count }, (_, i) =>
					make(
						depth - 1,
						avail.filter((_, k) => k % count === i),
					),
				);
			switch (kind) {
				case 1:
					return sequence(
						...Array.from({ length: count }, () => make(depth - 1, avail)),
					);
				case 2:
					return parallel(...split());
				case 3:
					return lagged(split(), { lag: 0.25 * (1 + Math.floor(next() * 3)) });
				default: {
					const t = tracks[
						avail[Math.floor(next() * avail.length)] ?? 0
					] as (typeof tracks)[number];
					const opts = {
						duration: dur(),
						delay: next() < 0.2 ? 0.5 : 0,
						...lin,
					};
					const v = Math.round(next() * 10);
					return next() < 0.5
						? valueTo(t, v, opts)
						: valueTo(t, (from) => from + v, opts);
				}
			}
		};
		return make(
			3,
			tracks.map((_, i) => i),
		);
	};

	it("any seek sequence ends where one fresh seek to the same time does", () => {
		for (let seed = 1; seed <= 300; seed++) {
			const a = [track(0), track(0), track(0)];
			const b = [track(0), track(0), track(0)];
			const scrubbed = timeline(build(seed, a));
			const fresh = timeline(build(seed, b));
			const next = rng(seed * 7919);
			const total = scrubbed.duration;
			let target = 0;
			for (let i = 0; i < 12; i++) {
				// Mostly forward hops with the odd rewind, including big jumps.
				target =
					next() < 0.3
						? next() * total
						: Math.min(total, target + next() * total);
				scrubbed.seek(target);
			}
			fresh.seek(target);
			a.forEach((t, k) => {
				expect(t.peek(), `seed ${seed} track ${k}`).toBeCloseTo(
					b[k]?.peek() ?? 0,
					6,
				);
			});
		}
	});
});

describe("compose: a jump across many children", () => {
	it("touches each child of a large lagged O(1) times", () => {
		const n = 1000;
		const seeks = new Array<number>(n).fill(0);
		const placed = Array.from({ length: n }, (_, i) => ({
			animation: animation({
				duration: 1,
				begin: () => {},
				seek: () => {
					seeks[i] = (seeks[i] ?? 0) + 1;
				},
			}),
			// `lagged`'s default spacing: about seven children overlap at once.
			start: i * 0.15,
		}));
		// Counts element reads, so a walk over every child per entering batch shows.
		let reads = 0;
		const children = new Proxy(placed, {
			get(target, key, receiver) {
				if (typeof key === "string" && /^\d+$/.test(key)) reads++;
				return Reflect.get(target, key, receiver);
			},
		});
		const composite = compose(children);
		reads = 0;
		composite.seek(composite.duration);
		// Each child is advanced once per overlapping later batch, then finished.
		expect(Math.max(...seeks)).toBeLessThanOrEqual(9);
		// Walking every child per entering batch would be n² = 10⁶ reads.
		expect(reads).toBeLessThan(30 * n);
		seeks.fill(0);
		composite.seek(0);
		composite.seek(composite.duration / 2);
		expect(Math.max(...seeks)).toBeLessThanOrEqual(11);
	});
});
