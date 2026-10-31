import { describe, expect, it, vi } from "vitest";
import { moveTo, valueTo } from "../anim/move";
import { sequence } from "../anim/sequence";
import { timeline } from "../anim/timeline";
import { track } from "../reactive";
import { createClock } from "./clock";
import { lensTarget, propTarget, storeTarget } from "./target";

const linear = { easing: "linear" } as const;

describe("Animatable targets with real presets", () => {
	it("a track satisfies Animatable", () => {
		const t = track(0);
		const tl = timeline(valueTo(t, 10, linear), { clock: createClock() });
		tl.seek(0.5);
		expect(t.peek()).toBe(5);
	});

	it("valueTo drives a track, reads-after-writes inside a step, and restores on rewind", () => {
		const t = track(2);
		const tl = timeline(
			sequence(
				valueTo(t, 4, linear),
				// Relative step: its start is captured right after the first one wrote.
				valueTo(t, (v) => v + 10, linear),
			),
			{ clock: createClock() },
		);
		tl.seek(1.5);
		expect(t.peek()).toBe(9); // 4 + 10 * 0.5
		tl.seek(0.5);
		expect(t.peek()).toBe(3);
		tl.seek(0);
		expect(t.peek()).toBe(2);
	});

	it("function-valued tracks are stored, not called", () => {
		const a = () => 1;
		const b = () => 2;
		const t = track<() => number>(a);
		t.set(b);
		expect(t.peek()).toBe(b);
	});

	it("moveTo drives a point inside a plain object tree, leaving siblings alone", () => {
		const state = {
			points: [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
				{ x: 2, y: 2 },
			],
		};
		const first = state.points[0];
		const tl = timeline(
			moveTo(storeTarget(state, ["points", 1]), { x: 5, y: 3 }, linear),
			{ clock: createClock() },
		);
		tl.seek(0.5);
		expect(state.points[1]).toEqual({ x: 3, y: 2 });
		tl.seek(1);
		expect(state.points[1]).toEqual({ x: 5, y: 3 });
		tl.seek(0);
		expect(state.points[1]).toEqual({ x: 1, y: 1 });
		expect(state.points[0]).toBe(first);
	});

	it("a deep numeric leaf works with relative presets", () => {
		const state = { points: [{ x: 1, y: 0 }] };
		const x = storeTarget<number>(state, ["points", 0, "x"]);
		const tl = timeline(
			sequence(
				valueTo(x, (v) => v + 2, linear),
				valueTo(x, (v) => v * 2, linear),
			),
			{ clock: createClock() },
		);
		tl.seek(2);
		expect(state.points[0]?.x).toBe(6);
		tl.seek(1);
		expect(state.points[0]?.x).toBe(3);
	});

	it("storeTarget walks the path on every access, so replaced parents are followed", () => {
		const state = { p: { x: 1, y: 1 } };
		const parent = storeTarget<{ x: number; y: number }>(state, ["p"]);
		const child = storeTarget<number>(state, ["p", "x"]);
		parent.set({ x: 5, y: 2 });
		expect(child.peek()).toBe(5);
		child.set(8);
		expect(parent.peek()).toEqual({ x: 8, y: 2 });
	});

	it("storeTarget rejects an empty path", () => {
		expect(() => storeTarget({ a: 1 }, [])).toThrow(TypeError);
	});

	it("propTarget animates a plain object property (not reactive)", () => {
		const body = { x: 0, label: "a" };
		const tl = timeline(
			valueTo(propTarget(body, "x"), (v) => v + 4, linear),
			{
				clock: createClock(),
			},
		);
		tl.seek(1);
		expect(body.x).toBe(4);
		tl.seek(0);
		expect(body.x).toBe(0);
		expect(body.label).toBe("a");
	});

	it("lensTarget wraps any getter/setter and reads back its own writes", () => {
		let source = 1;
		const lens = lensTarget(
			() => source,
			(value) => {
				source = value;
			},
		);
		lens.set(3);
		expect(lens.peek()).toBe(3);
		source = 7; // an outside write is seen at once: there is no shadow
		expect(lens.peek()).toBe(7);
	});

	it("a lens over a track notifies the track's subscribers", () => {
		const t = track(0);
		const onStale = vi.fn();
		t.subscribe(onStale);
		const doubled = lensTarget(
			() => t.peek() * 2,
			(value) => t.set(value / 2),
		);
		timeline(valueTo(doubled, 10, linear), { clock: createClock() }).seek(1);
		expect(t.peek()).toBe(5);
		expect(onStale).toHaveBeenCalled();
	});

	it("a setter that throws propagates and changes nothing", () => {
		const source = 1;
		const lens = lensTarget(
			() => source,
			() => {
				throw new Error("boom");
			},
		);
		expect(() => lens.set(9)).toThrow("boom");
		expect(lens.peek()).toBe(1);
	});
});
