/**
 * The frame loop's guarantees: phases run tick → commit → paint, a write in a
 * tick is committed and painted in that same frame, requests collapse, the
 * loop sleeps when nothing is awake, and `watch` coalesces into the commit
 * phase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derive, track } from "../reactive";
import { createClock } from "./clock";
import {
	currentFramePhase,
	isFrameLoopRunning,
	onFrame,
	requestFrame,
	resetFrameLoop,
	stepFrame,
	watch,
} from "./frame-loop";

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
afterEach(() => vi.unstubAllGlobals());

const runFrame = (now: number) => {
	const callbacks = queue;
	queue = [];
	for (const callback of callbacks) callback(now);
};

/** A stand-in scene: marks itself dirty from a track and commits on request. */
function fakeScene(source: {
	peek(): number;
	subscribe(f: () => void): () => void;
}) {
	const committed: number[] = [];
	const painted: number[] = [];
	let value = source.peek();
	const paint = () => painted.push(value);
	const commit = () => {
		value = source.peek();
		committed.push(value);
		requestFrame("paint", paint);
	};
	const stop = source.subscribe(() => requestFrame("commit", commit));
	return { committed, painted, stop };
}

describe("phases", () => {
	it("runs tick, commit and paint in that order, whatever the registration order", () => {
		const order: string[] = [];
		onFrame("paint", () => order.push("paint"));
		onFrame("commit", () => order.push("commit"));
		onFrame("tick", () => order.push("tick"));
		runFrame(0);
		expect(order).toEqual(["tick", "commit", "paint"]);
	});

	it("reports the phase now running", () => {
		const seen: (string | null)[] = [];
		onFrame("tick", () => seen.push(currentFramePhase()));
		onFrame("paint", () => seen.push(currentFramePhase()));
		runFrame(0);
		expect(seen).toEqual(["tick", "paint"]);
		expect(currentFramePhase()).toBeNull();
	});

	it("hands every participant the frame timestamp", () => {
		const seen: number[] = [];
		onFrame("tick", (now) => seen.push(now));
		onFrame("paint", (now) => seen.push(now), { awake: false });
		runFrame(1234);
		expect(seen).toEqual([1234, 1234]);
	});
});

describe("tracks through the loop", () => {
	it("a write during a clock tick is committed and painted in that same frame", () => {
		const clock = createClock();
		const t = track(0);
		const scene = fakeScene(t);
		const stop = clock.onTick(() => t.set(t.peek() + 1));
		runFrame(1000); // primes the clock (dt 0)
		expect(scene.committed).toEqual([]);
		runFrame(1016);
		expect(scene.committed).toEqual([1]);
		expect(scene.painted).toEqual([1]);
		stop();
		scene.stop();
	});

	it("several writes in one tick cost one commit, which sees the last value", () => {
		const t = track(0);
		const scene = fakeScene(t);
		const off = onFrame("tick", () => {
			t.set(1);
			t.set(2);
			t.set(3);
		});
		runFrame(0);
		expect(scene.committed).toEqual([3]);
		expect(scene.painted).toEqual([3]);
		off();
	});

	it("two tick participants' writes accumulate (read-after-write) and commit once", () => {
		const t = track(0);
		const scene = fakeScene(t);
		const a = onFrame("tick", () => t.set(t.peek() + 1));
		const b = onFrame("tick", () => t.set(t.peek() + 1));
		runFrame(0);
		expect(scene.committed).toEqual([2]);
		a();
		b();
	});

	it("a write outside any frame (an event handler) wakes the idle loop for one frame", () => {
		const t = track(0);
		const scene = fakeScene(t);
		expect(isFrameLoopRunning()).toBe(false);
		t.set(7);
		expect(t.peek()).toBe(7);
		expect(scene.committed).toEqual([]); // nothing runs synchronously
		expect(isFrameLoopRunning()).toBe(true);
		runFrame(16);
		expect(scene.committed).toEqual([7]);
		expect(scene.painted).toEqual([7]);
		expect(queue.length).toBe(0); // and the loop went back to sleep
	});
});

describe("requestFrame", () => {
	it("collapses repeated requests for one function", () => {
		const run = vi.fn();
		requestFrame("commit", run);
		requestFrame("commit", run);
		runFrame(0);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("a request for a phase already past waits for the next frame", () => {
		const seen: string[] = [];
		const late = () => seen.push("tick");
		onFrame(
			"paint",
			() => {
				if (seen.length === 0) requestFrame("tick", late);
			},
			{ awake: false },
		);
		requestFrame();
		runFrame(0);
		expect(seen).toEqual([]);
		expect(queue.length).toBe(1);
		runFrame(16);
		expect(seen).toEqual(["tick"]);
	});

	it("a request for the running phase runs later in it, bounded", () => {
		let count = 0;
		const again = () => {
			count++;
			requestFrame("commit", again);
		};
		requestFrame("commit", again);
		runFrame(0);
		expect(count).toBe(16); // the drain cap; the rest goes to the next frame
		expect(queue.length).toBe(1);
	});

	it("can be withdrawn, and the loop then sleeps", () => {
		const run = vi.fn();
		const cancel = requestFrame("paint", run);
		expect(isFrameLoopRunning()).toBe(true);
		cancel();
		expect(isFrameLoopRunning()).toBe(false);
		runFrame(0); // the stale callback, had it not been cancelled
		expect(run).not.toHaveBeenCalled();
	});

	it("bare requestFrame() runs passive participants for exactly one frame", () => {
		const paint = vi.fn();
		onFrame("paint", paint, { awake: false });
		expect(isFrameLoopRunning()).toBe(false);
		requestFrame();
		runFrame(0);
		expect(paint).toHaveBeenCalledTimes(1);
		expect(queue.length).toBe(0);
	});
});

describe("sleeping", () => {
	it("an awake participant keeps the loop running; unregistering lets it sleep", () => {
		const off = onFrame("tick", () => {});
		runFrame(0);
		expect(queue.length).toBe(1);
		off();
		expect(isFrameLoopRunning()).toBe(false);
	});

	it("a passive participant never starts the loop", () => {
		onFrame("commit", () => {}, { awake: false });
		expect(isFrameLoopRunning()).toBe(false);
	});

	it("every callback runs even when one throws; the first error is rethrown", () => {
		const later = vi.fn();
		onFrame("tick", () => {
			throw new Error("first");
		});
		onFrame("paint", later);
		expect(() => runFrame(0)).toThrow("first");
		expect(later).toHaveBeenCalled();
		expect(queue.length).toBe(1); // still scheduled
	});

	it("schedules nothing without requestAnimationFrame", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		expect(() => onFrame("tick", () => {})).not.toThrow();
		expect(isFrameLoopRunning()).toBe(false);
	});

	it("resets participants' timestamps when the page visibility changes", () => {
		const reset = vi.fn();
		const listeners: (() => void)[] = [];
		vi.stubGlobal("document", {
			addEventListener: (_: string, listener: () => void) =>
				listeners.push(listener),
		});
		onFrame("tick", () => {}, { reset });
		for (const listener of listeners) listener();
		expect(reset).toHaveBeenCalledTimes(1);
	});
});

describe("stepFrame", () => {
	it("runs a frame synchronously, without a real requestAnimationFrame", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		const clock = createClock();
		const t = track(0);
		const scene = fakeScene(t);
		clock.onTick(() => t.set(clock.time.peek()));
		stepFrame(1000);
		stepFrame(1050);
		expect(clock.time.peek()).toBeCloseTo(0.05, 9);
		expect(scene.committed).toEqual([clock.time.peek()]);
	});

	it("tick: false commits and paints what was written by hand without advancing clocks", () => {
		const clock = createClock();
		clock.onTick(() => {});
		const t = track(0);
		const scene = fakeScene(t);
		stepFrame(0);
		t.set(5);
		stepFrame(1000, { tick: false });
		expect(clock.time.peek()).toBe(0);
		expect(scene.painted).toEqual([5]);
	});

	it("throws from inside a frame", () => {
		let failure: unknown;
		onFrame("commit", () => {
			try {
				stepFrame(0);
			} catch (error) {
				failure = error;
			}
		});
		runFrame(0);
		expect(String(failure)).toContain("inside a frame");
	});
});

describe("watch", () => {
	it("coalesces changes into one run in the commit phase, with the latest value", () => {
		const t = track(0);
		const run = vi.fn();
		const phases: (string | null)[] = [];
		watch(t, (value) => {
			run(value);
			phases.push(currentFramePhase());
		});
		t.set(1);
		t.set(2);
		expect(run).not.toHaveBeenCalled();
		runFrame(0);
		expect(run).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith(2);
		expect(phases).toEqual(["commit"]);
	});

	it("skips a run when the value came back to what it last saw", () => {
		const t = track(0);
		const run = vi.fn();
		watch(t, run);
		t.set(1);
		t.set(0);
		runFrame(0);
		expect(run).not.toHaveBeenCalled();
	});

	it("follows derived values, recomputing once", () => {
		const a = track(1);
		const compute = vi.fn((value: number) => value * 2);
		const doubled = derive(a, compute);
		const run = vi.fn();
		watch(doubled, run);
		compute.mockClear();
		a.set(2);
		a.set(3);
		runFrame(0);
		expect(run).toHaveBeenCalledWith(6);
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("a run that writes a watched track is seen by a scene in the same commit", () => {
		const input = track(0);
		const output = track(0);
		const scene = fakeScene(output);
		watch(input, (value) => output.set(value * 10));
		input.set(4);
		runFrame(0);
		expect(scene.committed).toEqual([40]);
		expect(scene.painted).toEqual([40]);
	});

	it("unsubscribing drops a pending run and stops further ones", () => {
		const t = track(0);
		const run = vi.fn();
		const stop = watch(t, run);
		t.set(1);
		stop();
		runFrame(0);
		t.set(2);
		runFrame(16);
		expect(run).not.toHaveBeenCalled();
		expect(queue.length).toBe(0);
	});
});
