import { describe, expect, it, vi } from "vitest";
import { derive, track } from "../reactive/index.js";
import { isTrack, trackPoint } from "./track.js";

describe("track as an animation cell", () => {
	it("read-after-write: peek() sees a write immediately", () => {
		const t = track(1);
		t.set(2);
		expect(t.peek()).toBe(2);
	});

	it("holding a function as the value works via set()", () => {
		const first = () => 1;
		const second = () => 2;
		const t = track<() => number>(first);
		expect(t.peek()).toBe(first);
		t.set(second);
		expect(t.peek()).toBe(second);
	});

	it("subscribers are told on change, not on an equal write (default equals)", () => {
		const t = track(1);
		const onStale = vi.fn();
		t.subscribe(onStale);
		t.set(1);
		expect(onStale).not.toHaveBeenCalled();
		t.set(2);
		expect(onStale).toHaveBeenCalledTimes(1);
	});

	it("equals:false notifies even on an `Object.is` value", () => {
		const t = track(1, { equals: false });
		const onStale = vi.fn();
		t.subscribe(onStale);
		t.set(1);
		expect(onStale).toHaveBeenCalledTimes(1);
	});
});

describe("trackPoint", () => {
	it("creates a track holding {x,y}", () => {
		const p = trackPoint(1, 2);
		expect(p.peek()).toEqual({ x: 1, y: 2 });
	});

	it("supports set() with a new point", () => {
		const p = trackPoint(0, 0);
		p.set({ x: 5, y: 6 });
		expect(p.peek()).toEqual({ x: 5, y: 6 });
	});
});

describe("isTrack", () => {
	it("is true for track() and trackPoint()", () => {
		expect(isTrack(track(1))).toBe(true);
		expect(isTrack(trackPoint(1, 2))).toBe(true);
	});

	it("is false for read-only Readables, functions and plain values", () => {
		expect(isTrack(derive(track(1), (value) => value))).toBe(false);
		expect(isTrack(Object.assign(() => 1, { set: () => {} }))).toBe(false);
		expect(isTrack(5)).toBe(false);
		expect(isTrack({})).toBe(false);
		expect(isTrack(null)).toBe(false);
		expect(isTrack(undefined)).toBe(false);
	});
});
