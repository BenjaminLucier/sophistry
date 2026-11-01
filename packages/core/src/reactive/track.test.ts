import { describe, expect, it, vi } from "vitest";
import { derive, isReadable, track } from "./track.js";

describe("track", () => {
	it("reads what was written and notifies on change only", () => {
		const t = track(1);
		const onStale = vi.fn();
		t.subscribe(onStale);
		t.set(1);
		expect(onStale).not.toHaveBeenCalled();
		t.set(2);
		expect(t.peek()).toBe(2);
		expect(onStale).toHaveBeenCalledTimes(1);
	});

	it("honours equals: false and custom comparators", () => {
		const always = track(0, { equals: false });
		const loose = track({ x: 1 }, { equals: (a, b) => a.x === b.x });
		const a = vi.fn();
		const b = vi.fn();
		always.subscribe(a);
		loose.subscribe(b);
		always.set(0);
		loose.set({ x: 1 });
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).not.toHaveBeenCalled();
	});

	it("stops notifying after unsubscribe, even mid-notification", () => {
		const t = track(0);
		const later = vi.fn();
		let stopLater = () => {};
		t.subscribe(() => stopLater());
		stopLater = t.subscribe(later);
		t.set(1);
		expect(later).not.toHaveBeenCalled();
	});
});

describe("derive", () => {
	it("recomputes lazily, once per change of input", () => {
		const t = track(1);
		const compute = vi.fn((value: number) => value * 2);
		const doubled = derive(t, compute);
		expect(compute).not.toHaveBeenCalled();
		expect(doubled.peek()).toBe(2);
		expect(doubled.peek()).toBe(2);
		expect(compute).toHaveBeenCalledTimes(1);
		t.set(2);
		t.set(3);
		expect(doubled.peek()).toBe(6);
		expect(compute).toHaveBeenCalledTimes(2);
	});

	it("combines several sources without glitches", () => {
		const a = track(1);
		const left = derive(a, (v) => v + 1);
		const right = derive(a, (v) => v * 10);
		const sum = derive([left, right], (l, r) => l + r);
		expect(sum.peek()).toBe(12);
		a.set(2);
		expect(sum.peek()).toBe(23);
	});

	it("subscribes through to its sources", () => {
		const a = track(1);
		const b = track(2);
		const onStale = vi.fn();
		const stop = derive([a, b], (x, y) => x + y).subscribe(onStale);
		a.set(5);
		b.set(6);
		expect(onStale).toHaveBeenCalledTimes(2);
		stop();
		a.set(7);
		expect(onStale).toHaveBeenCalledTimes(2);
	});
});

describe("isReadable", () => {
	it("recognises tracks, derivations and duck-typed readables", () => {
		expect(isReadable(track(0))).toBe(true);
		expect(isReadable(derive(track(0), (v) => v))).toBe(true);
		expect(isReadable({ peek: () => 1, subscribe: () => () => {} })).toBe(true);
		expect(isReadable({ x: 1 })).toBe(false);
		expect(isReadable(null)).toBe(false);
		expect(isReadable(() => 1)).toBe(false);
	});
});
