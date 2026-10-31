/**
 * Many `play()` calls in flight at once, on several clocks, through the real
 * shared frame loop. Separate concurrent scripts once seemed to stall; this
 * pins down that every one of them resolves `"done"` and that the loop goes
 * idle afterwards.
 *
 * `requestAnimationFrame` is a hand-pumped queue, so the test counts frames
 * rather than waiting on wall-clock time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "../reactive";
import { createClock, defaultClock } from "../tween/clock";
import { valueTo } from "./move";
import { hold, lagged, parallel, sequence } from "./sequence";
import { play } from "./timeline";

let queue: FrameRequestCallback[] = [];
let now = 0;

beforeEach(() => {
	queue = [];
	now = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		queue.push(callback);
		return queue.length;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

/** Runs one frame 1/60 s after the last. False when nothing asked for one. */
function frame(): boolean {
	const due = queue;
	queue = [];
	if (due.length === 0) return false;
	now += 1000 / 60;
	for (const callback of due) callback(now);
	return true;
}

/** Pumps frames, letting promise callbacks run between them, until `settled()` or `limit` frames. */
async function pump(settled: () => boolean, limit: number): Promise<number> {
	let frames = 0;
	while (!settled() && frames < limit) {
		frame();
		frames++;
		// Resolved `play()`s continue their scripts in microtasks.
		await Promise.resolve();
		await Promise.resolve();
	}
	return frames;
}

describe("concurrent play()", () => {
	it("resolves every one of many plays started at once on different clocks", async () => {
		const clocks = [createClock(), createClock(), createClock(), defaultClock];
		const results: string[] = [];
		const runs = Array.from({ length: 12 }, (_, i) => {
			const x = track(0);
			const y = track(0);
			const clock = clocks[i % clocks.length];
			const duration = 0.2 + (i % 5) * 0.15;
			const anim =
				i % 3 === 0
					? sequence(valueTo(x, 1, { duration }), valueTo(y, 1, { duration }))
					: i % 3 === 1
						? parallel(valueTo(x, 1, { duration }), hold(duration / 2))
						: lagged(
								[valueTo(x, 1, { duration }), valueTo(y, 1, { duration })],
								{
									lagRatio: 0.5,
								},
							);
			return play(anim, { clock }).then((status) => {
				results.push(status);
				return { status, x: x.peek(), y: y.peek(), i };
			});
		});

		// The longest run is 2 × 0.8 s = 1.6 s, about 96 frames.
		await pump(() => results.length === runs.length, 240);
		const settled = await Promise.all(runs);
		expect(settled.map((run) => run.status)).toEqual(
			Array(runs.length).fill("done"),
		);
		for (const run of settled) {
			expect(run.x).toBe(1);
			if (run.i % 3 !== 1) expect(run.y).toBe(1);
		}
		// Nothing left subscribed, so the loop stops asking for frames.
		frame();
		expect(frame()).toBe(false);
	});

	it("resolves concurrent scripts of consecutive awaits, each on its own clock", async () => {
		const finished: number[] = [];
		const scripts = Array.from({ length: 6 }, async (_, i) => {
			const clock = i % 2 === 0 ? createClock() : defaultClock;
			const x = track(0);
			const statuses: string[] = [];
			for (let step = 1; step <= 4; step++)
				statuses.push(
					await play(valueTo(x, step, { duration: 0.1 + i * 0.05 }), {
						clock,
					}),
				);
			finished.push(i);
			return { statuses, x: x.peek() };
		});

		await pump(() => finished.length === scripts.length, 400);
		const done = await Promise.all(scripts);
		for (const script of done) {
			expect(script.statuses).toEqual(["done", "done", "done", "done"]);
			expect(script.x).toBe(4);
		}
	});

	it("a play started from another's completion still runs", async () => {
		const clock = createClock();
		const x = track(0);
		const y = track(0);
		let second: Promise<string> | undefined;
		const first = play(valueTo(x, 1, { duration: 0.2 }), { clock }).then(
			(status) => {
				second = play(valueTo(y, 1, { duration: 0.2 }), { clock });
				return status;
			},
		);
		let secondStatus: string | undefined;
		await pump(() => {
			void second?.then((status) => {
				secondStatus = status;
			});
			return secondStatus !== undefined;
		}, 120);
		expect(await first).toBe("done");
		expect(secondStatus).toBe("done");
		expect(y.peek()).toBe(1);
	});
});
