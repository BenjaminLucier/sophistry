/**
 * How a reduced-motion jump is shown: the `onReducedJump` hook a run calls
 * just before it lands on its end state. (A scene passes its own hook to the
 * runs it starts; the dissolve itself is tested with the renderer.)
 */

import { describe, expect, it } from "vitest";
import { track } from "../reactive";
import { createClock } from "../tween/clock";
import { valueTo } from "./move";
import { play, timeline } from "./timeline";

describe("onReducedJump", () => {
	it("runs once, before the tracks move, when a reduced run jumps", async () => {
		const a = track(0);
		const seen: number[] = [];
		const result = await play(valueTo(a, 1, { duration: 1 }), {
			clock: createClock(),
			reducedMotion: "reduce",
			onReducedJump: () => seen.push(a.peek()),
		});
		expect(result).toBe("done");
		expect(seen).toEqual([0]);
		expect(a.peek()).toBe(1);
	});

	it("is not called when motion plays, nor for seek, nor for a run already at rest", async () => {
		const a = track(0);
		let calls = 0;
		const clock = createClock();
		const onReducedJump = () => {
			calls += 1;
		};
		const run = play(valueTo(a, 1, { duration: 1 }), {
			clock,
			reducedMotion: "no-preference",
			onReducedJump,
		});
		clock.advance(1);
		await run;
		const tl = timeline(valueTo(a, 2, { duration: 1 }), {
			clock,
			reducedMotion: "reduce",
			onReducedJump,
		});
		tl.seek(0.5);
		expect(calls).toBe(0);
		await tl.play();
		expect(calls).toBe(1);
		// A zero-length run is at rest before it starts: nothing to show.
		await play(valueTo(a, 5, { duration: 0 }), {
			clock,
			reducedMotion: "reduce",
			onReducedJump,
		});
		expect(calls).toBe(1);
		calls = 0;
		const essential = play(valueTo(a, 3, { duration: 1 }), {
			clock,
			reducedMotion: "reduce",
			motion: "essential",
			onReducedJump,
		});
		clock.advance(1);
		await essential;
		expect(calls).toBe(0);
	});
});
