import { describe, expect, it } from "vitest";
import { clamp, lerp, lerpPoint, lerpPoint3, remap } from "./interpolate";

describe("lerp", () => {
	it("t=0 returns a, t=1 returns b", () => {
		expect(lerp(3, 7, 0)).toBe(3);
		expect(lerp(3, 7, 1)).toBe(7);
	});

	it("is exact at the midpoint", () => {
		expect(lerp(0, 1, 0.5)).toBe(0.5);
	});

	it("extrapolates for t outside [0,1]", () => {
		expect(lerp(0, 10, -1)).toBe(-10);
		expect(lerp(0, 10, 2)).toBe(20);
	});

	it("handles negative ranges", () => {
		expect(lerp(-10, 10, 0.5)).toBe(0);
	});
});

describe("lerpPoint", () => {
	it("t=0 is a, t=1 is b, t=0.5 is the midpoint", () => {
		const a = { x: 0, y: 0 };
		const b = { x: 10, y: 20 };
		expect(lerpPoint(a, b, 0)).toEqual(a);
		expect(lerpPoint(a, b, 1)).toEqual(b);
		expect(lerpPoint(a, b, 0.5)).toEqual({ x: 5, y: 10 });
	});

	it("returns a fresh object each call", () => {
		const a = { x: 0, y: 0 };
		const b = { x: 10, y: 10 };
		expect(lerpPoint(a, b, 0.5)).not.toBe(lerpPoint(a, b, 0.5));
	});
});

describe("lerpPoint3", () => {
	it("t=0 is a, t=1 is b, t=0.5 is the midpoint", () => {
		const a = { x: 0, y: 0, z: 0 };
		const b = { x: 10, y: 20, z: 30 };
		expect(lerpPoint3(a, b, 0)).toEqual(a);
		expect(lerpPoint3(a, b, 1)).toEqual(b);
		expect(lerpPoint3(a, b, 0.5)).toEqual({ x: 5, y: 10, z: 15 });
	});
});

describe("clamp", () => {
	it("defaults to [0,1]", () => {
		expect(clamp(-1)).toBe(0);
		expect(clamp(2)).toBe(1);
		expect(clamp(0.5)).toBe(0.5);
	});

	it("respects custom bounds", () => {
		expect(clamp(-5, -10, 10)).toBe(-5);
		expect(clamp(-20, -10, 10)).toBe(-10);
		expect(clamp(20, -10, 10)).toBe(10);
	});

	it("boundary values pass through unchanged", () => {
		expect(clamp(0, 0, 1)).toBe(0);
		expect(clamp(1, 0, 1)).toBe(1);
	});
});

describe("remap", () => {
	it("maps a value linearly between two ranges", () => {
		expect(remap(5, 0, 10, 0, 100)).toBe(50);
	});

	it("does not clamp outside the source range", () => {
		expect(remap(20, 0, 10, 0, 100)).toBe(200);
		expect(remap(-10, 0, 10, 0, 100)).toBe(-100);
	});

	it("degenerate source range returns toLow", () => {
		expect(remap(5, 3, 3, 0, 100)).toBe(0);
	});

	it("supports reversed target ranges", () => {
		expect(remap(5, 0, 10, 100, 0)).toBe(50);
		expect(remap(0, 0, 10, 100, 0)).toBe(100);
	});
});
