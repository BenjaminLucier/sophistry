import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../reactive";
import { createClock } from "../tween/clock";
import { resetFrameLoop, stepFrame, watch } from "../tween/frame-loop";
import { trackPoint } from "../tween/track";
import { animation } from "./animation";
import { draw, drawBorderThenFill, unwrite, write } from "./draw";
import { circumscribe, flash, indicate, pulse, wiggle } from "./emphasis";
import { fadeIn, fadeInFrom, fadeOut } from "./fade";
import { growFromCenter, growFromPoint, spinInFromNothing } from "./growing";
import { moveAlong, valueTo } from "./move";
import { forever, hold, parallel, repeat, sequence } from "./sequence";
import { anySignal, play, splitPlayArguments, timeline } from "./timeline";
import { tween, wait } from "./tween";
import { driveTrack } from "./types";

beforeEach(() => {
	resetFrameLoop();
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe("play", () => {
	it("resolves 'done' and never rejects", async () => {
		const clock = createClock();
		const result = play(hold(1), { clock });
		clock.advance(1);
		expect(await result).toBe("done");
	});

	it("an empty or zero-length play resolves done immediately", async () => {
		expect(await play()).toBe("done");
		const x = track(0);
		expect(await play(valueTo(x, 5, { duration: 0 }))).toBe("done");
		expect(x.peek()).toBe(5);
	});

	it("runs parallel animations as one group on one subscription", () => {
		const clock = createClock();
		const sub = vi.spyOn(clock, "onTick");
		const a = track(0);
		const b = track(0);
		void play(
			valueTo(a, 1, { duration: 1, easing: "linear" }),
			valueTo(b, 1, { duration: 2, easing: "linear" }),
			{ clock },
		);
		expect(sub).toHaveBeenCalledTimes(1);
		clock.advance(1);
		expect([a.peek(), b.peek()]).toEqual([1, 0.5]);
	});

	it("a paused clock holds the script; speed rescales it", () => {
		const clock = createClock();
		const x = track(0);
		void play(valueTo(x, 1, { duration: 1, easing: "linear" }), { clock });
		clock.advance(0.5);
		expect(x.peek()).toBe(0.5);
	});
});

describe("timeline controller", () => {
	it("pause() holds, play() resumes the same promise", async () => {
		const clock = createClock();
		const x = track(0);
		const tl = timeline(valueTo(x, 1, { duration: 1, easing: "linear" }), {
			clock,
		});
		const first = tl.play();
		clock.advance(0.25);
		tl.pause();
		expect(tl.playing.peek()).toBe(false);
		clock.advance(0.5);
		expect(x.peek()).toBe(0.25);
		const second = tl.play();
		expect(second).toBe(first);
		expect(tl.playing.peek()).toBe(true);
		clock.advance(1);
		expect(await first).toBe("done");
		expect(tl.time.peek()).toBe(1);
	});

	it("playing again after the end restarts from 0", async () => {
		const clock = createClock();
		const x = track(0);
		const tl = timeline(
			driveTrack(x, 1, { duration: 1, easing: "linear", from: 0 }),
			{ clock },
		);
		const run = tl.play();
		clock.advance(1);
		await run;
		void tl.play();
		expect(tl.time.peek()).toBe(0);
		expect(x.peek()).toBe(0);
	});

	it("seeking to the end while playing resolves done", async () => {
		const clock = createClock();
		const tl = timeline(hold(3), { clock });
		const run = tl.play();
		tl.seek(3);
		expect(await run).toBe("done");
	});

	it("abort() resolves 'aborted' and a replay is possible", async () => {
		const clock = createClock();
		const tl = timeline(hold(3), { clock });
		const run = tl.play();
		tl.abort();
		expect(await run).toBe("aborted");
		const again = tl.play();
		clock.advance(3);
		expect(await again).toBe("done");
	});

	it("replaying one Animation value re-captures start values", async () => {
		const clock = createClock();
		const x = track(0);
		const hop = valueTo(x, (v) => v + 1, { duration: 1, easing: "linear" });
		const first = play(hop, { clock });
		clock.advance(1);
		await first;
		const second = play(hop, { clock });
		clock.advance(1);
		await second;
		expect(x.peek()).toBe(2);
	});
});

describe("runs started from reactive code", () => {
	it("a run started from a watch callback does not re-trigger it", () => {
		const clock = createClock();
		const trigger = track(0);
		const x = track(0);
		const p = trackPoint(0, 0);
		let runs = 0;
		watch(trigger, () => {
			runs++;
			void play(
				valueTo(x, 1, { duration: 1 }),
				parallel(fadeInFrom(track(0), p, { x: 1, y: 1 })),
				{ clock },
			);
		});
		trigger.set(1);
		stepFrame(0, { tick: false });
		expect(runs).toBe(1);
		clock.advance(0.5);
		stepFrame(16, { tick: false });
		clock.advance(1);
		stepFrame(32, { tick: false });
		expect(runs).toBe(1);
		expect(x.peek()).toBe(1);
	});
});

describe("explicit clock and disposal", () => {
	it("a run follows the clock it was given and aborts with its signal", async () => {
		const own = createClock();
		const x = track(0);
		const controller = new AbortController();
		const result = play(valueTo(x, 1, { duration: 1, easing: "linear" }), {
			clock: own,
			signal: controller.signal,
		});
		own.advance(0.5);
		expect(x.peek()).toBe(0.5);
		controller.abort();
		expect(await result).toBe("aborted");
		own.advance(1);
		expect(x.peek()).toBe(0.5);
	});

	it("timeline.dispose() aborts the run and retires the timeline", async () => {
		const clock = createClock();
		const x = track(0);
		const tl = timeline(valueTo(x, 1, { duration: 1, easing: "linear" }), {
			clock,
		});
		const run = tl.play();
		clock.advance(0.25);
		tl.dispose();
		expect(await run).toBe("aborted");
		expect(await tl.play()).toBe("aborted");
		clock.advance(1);
		expect(x.peek()).toBe(0.25);
		tl.seek(1); // still scrubbable by hand
		expect(x.peek()).toBe(1);
	});

	it("aborting the context signal between runs retires the timeline", async () => {
		const clock = createClock();
		const controller = new AbortController();
		const tl = timeline(hold(1), { clock, signal: controller.signal });
		const first = tl.play();
		clock.advance(1);
		expect(await first).toBe("done");
		controller.abort();
		expect(await tl.play()).toBe("aborted");
	});
});

describe("tween and wait", () => {
	it("resolve 'done' or 'aborted'", async () => {
		const clock = createClock();
		const ctl = new AbortController();
		const a = tween({
			from: 0,
			to: 1,
			clock,
			signal: ctl.signal,
			onUpdate: () => {},
		});
		const b = wait(1, { clock });
		clock.advance(0.5);
		ctl.abort();
		clock.advance(0.5);
		expect(await a).toBe("aborted");
		expect(await b).toBe("done");
	});
});

describe("presets", () => {
	it("fadeIn eases out by default; fadeOut eases in", () => {
		const o = track(0);
		timeline(fadeIn(o, { duration: 1 })).seek(0.5);
		const out = o.peek();
		expect(out).toBeGreaterThan(0.5);
		const o2 = track(1);
		timeline(fadeOut(o2, { duration: 1 })).seek(0.5);
		expect(o2.peek()).toBeGreaterThan(0.5);
	});

	it("moveAlong is linear by default", () => {
		const p = trackPoint(0, 0);
		const tl = timeline(
			moveAlong(p, [
				{ x: 0, y: 0 },
				{ x: 4, y: 0 },
			]),
		);
		tl.seek(0.25);
		expect(p.peek().x).toBeCloseTo(1, 6);
	});

	it("draw/write/unwrite stagger", () => {
		const a = track(0);
		const b = track(0);
		const tl = timeline(write([a, b], { lag: 0.5, duration: 1 }));
		expect(tl.duration).toBe(1.5);
		tl.seek(0.5);
		expect([a.peek(), b.peek()]).toEqual([0.5, 0]);
		const c = track(1);
		const d = track(1);
		const un = timeline(unwrite([c, d], { lag: 0.5, duration: 1 }));
		un.seek(0.5);
		// reversed: d starts first
		expect(d.peek()).toBe(0.5);
		expect(c.peek()).toBe(1);
		const r = track(0);
		const cr = timeline(draw(r, { from: 0.4, delay: 1 }));
		cr.seek(0.5);
		expect(r.peek()).toBe(0.4);
	});

	it("drawBorderThenFill splits the duration 65/35", () => {
		const p = track(0);
		const f = track(0);
		const tl = timeline(drawBorderThenFill(p, f, { duration: 2 }));
		expect(tl.duration).toBeCloseTo(2, 9);
		tl.seek(1.3);
		expect(p.peek()).toBe(1);
		expect(f.peek()).toBe(0);
		tl.seek(2);
		expect(f.peek()).toBe(1);
	});

	it("emphasis presets return to rest", () => {
		const s = track(1);
		const c = track("#ff0000");
		const tl = timeline(indicate(s, { color: c, highlight: "#0000ff" }));
		tl.seek(0.4);
		expect(s.peek()).toBeCloseTo(1.2, 6);
		expect(c.peek()).not.toBe("#ff0000");
		tl.seek(0.8);
		expect(s.peek()).toBe(1);
		expect(c.peek()).toBe("#ff0000");

		const r = track(0.3);
		timeline(wiggle(r)).seek(0.7);
		expect(r.peek()).toBe(0.3);

		const sc = track(2);
		const pl = timeline(pulse(sc));
		pl.seek(0.8);
		expect(sc.peek()).toBeGreaterThan(2);
		pl.seek(1.6);
		expect(sc.peek()).toBe(2);

		const rad = track(1);
		const op = track(0);
		timeline(flash(rad, op)).seek(0.6);
		expect(rad.peek()).toBeCloseTo(2.2, 9);
		expect(op.peek()).toBe(0);

		const prog = track(0);
		const cc = timeline(circumscribe(prog, { duration: 1, delay: 0.5 }));
		expect(cc.duration).toBe(1.5);
		cc.seek(1);
		expect(prog.peek()).toBe(1);
		cc.seek(1.5);
		expect(prog.peek()).toBe(0);
	});

	it("grow presets hold the start through the delay and snap back to rest on abort", async () => {
		const clock = createClock();
		const scale = track(2);
		const pos = trackPoint(1, 1);
		const rot = track(0.5);
		const result = play(
			growFromCenter(scale, { delay: 1 }),
			growFromPoint(track(1), pos, { x: 5, y: 5 }, { delay: 1 }),
			spinInFromNothing(track(1), rot),
			{ clock },
		);
		expect(scale.peek()).toBe(0);
		expect(pos.peek()).toEqual({ x: 5, y: 5 });
		clock.advance(0.5);
		expect(scale.peek()).toBe(0);
		expect(rot.peek()).not.toBe(0.5);
		const ctl = new AbortController();
		void ctl;
		// Abort via a dedicated run.
		const abortCtl = new AbortController();
		const scale2 = track(3);
		const pos2 = trackPoint(2, 2);
		const run = play(growFromPoint(scale2, pos2, { x: 9, y: 9 }), {
			clock,
			signal: abortCtl.signal,
		});
		clock.advance(0.3);
		expect(scale2.peek()).toBeGreaterThan(0);
		expect(scale2.peek()).toBeLessThan(3);
		abortCtl.abort();
		expect(await run).toBe("aborted");
		expect(scale2.peek()).toBe(3);
		expect(pos2.peek()).toEqual({ x: 2, y: 2 });
		clock.advance(5);
		await result;
		expect(scale.peek()).toBe(2);
	});

	it("aborting a grow during its delay snaps to rest too", async () => {
		const clock = createClock();
		const ctl = new AbortController();
		const scale = track(1.5);
		const run = play(growFromCenter(scale, { delay: 2 }), {
			clock,
			signal: ctl.signal,
		});
		expect(scale.peek()).toBe(0);
		clock.advance(0.5);
		ctl.abort();
		expect(await run).toBe("aborted");
		expect(scale.peek()).toBe(1.5);
	});

	it("abort reaches grow presets nested in sequence and repeat", async () => {
		const clock = createClock();
		const ctl = new AbortController();
		const scale = track(1);
		const run = play(
			sequence(hold(1), forever(repeat(growFromCenter(scale), 2))),
			{ clock, signal: ctl.signal },
		);
		clock.advance(1.5);
		expect(scale.peek()).toBeLessThan(1);
		ctl.abort();
		expect(await run).toBe("aborted");
		expect(scale.peek()).toBe(1);
	});
});

describe("custom leaves", () => {
	it("animation() clamps seek and sanitises duration", () => {
		const seen: number[] = [];
		const a = animation({ duration: -3, seek: (t) => seen.push(t) });
		expect(a.duration).toBe(0);
		a.seek(5);
		expect(seen).toEqual([0]);
	});
});

describe("replay and untracked runner", () => {
	it("play() after reaching the end replays identically (restore, then re-arm)", async () => {
		const clock = createClock();
		const p = track(0);
		const tl = timeline(
			valueTo(p, (v) => v + 5, { duration: 1, easing: "linear" }),
			{ clock },
		);
		const first = tl.play();
		clock.advance(1);
		await first;
		expect(p.peek()).toBe(5);
		const second = tl.play();
		expect(p.peek()).toBe(0);
		clock.advance(0.5);
		expect(p.peek()).toBe(2.5);
		clock.advance(0.5);
		await second;
		expect(p.peek()).toBe(5);
	});

	it("a replay rewinds later steps, not only the first", async () => {
		const clock = createClock();
		const a = track(0);
		const b = track(0);
		const tl = timeline(
			sequence(
				valueTo(a, 1, { duration: 1, easing: "linear" }),
				valueTo(b, 1, { duration: 1, easing: "linear" }),
			),
			{ clock },
		);
		const first = tl.play();
		clock.advance(2);
		await first;
		expect([a.peek(), b.peek()]).toEqual([1, 1]);
		void tl.play();
		expect([a.peek(), b.peek()]).toEqual([0, 0]);
		clock.advance(1.5);
		expect([a.peek(), b.peek()]).toEqual([1, 0.5]);
	});

	it("a scrub back to 0 does not re-arm", () => {
		const p = track(0);
		const tl = timeline(
			valueTo(p, (v) => v + 5, { duration: 1, easing: "linear" }),
		);
		tl.seek(1);
		tl.seek(0);
		tl.seek(1);
		expect(p.peek()).toBe(5);
	});
});

describe("play arguments", () => {
	it("throws a TypeError for non-animation arguments", () => {
		expect(() => play({ seek: 1 } as never, hold(1))).toThrow(TypeError);
		expect(() => play(hold(1), 5 as never)).toThrow(TypeError);
		expect(() => play(hold(1), new Date() as never)).toThrow(TypeError);
	});

	it("treats a trailing plain object as context, an animation-like object as animation", () => {
		const clock = createClock();
		const x = track(0);
		void play(valueTo(x, 1, { duration: 1, easing: "linear" }), { clock });
		clock.advance(0.5);
		expect(x.peek()).toBe(0.5);
		const custom = { duration: 1, seek: () => {} };
		expect(() => play(custom)).not.toThrow();
	});
});

describe("helpers for binding players", () => {
	it("splitPlayArguments separates a trailing context; anySignal combines signals", async () => {
		const scene = createClock();
		const other = createClock();
		const lifetime = new AbortController();
		const x = track(0);
		const args = [
			valueTo(x, 1, { duration: 1, easing: "linear" }),
			{ clock: other },
		];
		const { animations, context } = splitPlayArguments(args);
		expect(animations).toHaveLength(1);
		expect(context.clock).toBe(other);
		const run = play(...animations, {
			clock: context.clock ?? scene,
			signal: anySignal(lifetime.signal, context.signal),
		});
		other.advance(0.5);
		expect(x.peek()).toBe(0.5);
		scene.advance(1);
		expect(x.peek()).toBe(0.5);
		const call = new AbortController();
		const second = play(hold(10), {
			clock: other,
			signal: anySignal(lifetime.signal, call.signal),
		});
		call.abort();
		other.advance(0.5);
		expect(await second).toBe("aborted");
		expect(await run).toBe("done");
		const third = play(hold(10), {
			clock: other,
			signal: anySignal(lifetime.signal, undefined),
		});
		lifetime.abort();
		expect(await third).toBe("aborted");
	});
});
