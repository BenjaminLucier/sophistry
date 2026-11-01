import { describe, expect, it } from "vitest";
import {
	clamp,
	lerp,
	lerpPoint,
	lerpPoint3,
	pathAlongArc,
	progressIn,
	remap,
} from "./lerp.js";

describe("lerp", () => {
	it("interpolates between two numbers", () => {
		expect(lerp(0, 10, 0)).toBe(0);
		expect(lerp(0, 10, 1)).toBe(10);
		expect(lerp(0, 10, 0.5)).toBe(5);
	});

	it("extrapolates outside [0, 1]", () => {
		expect(lerp(0, 10, 2)).toBe(20);
		expect(lerp(0, 10, -1)).toBe(-10);
	});
});

describe("lerpPoint", () => {
	it("interpolates x/y independently", () => {
		expect(lerpPoint({ x: 0, y: 10 }, { x: 10, y: 0 }, 0.5)).toEqual({
			x: 5,
			y: 5,
		});
	});
});

describe("lerpPoint3", () => {
	it("interpolates x/y/z independently", () => {
		expect(
			lerpPoint3({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }, 0.5),
		).toEqual({ x: 5, y: 10, z: 15 });
	});
});

describe("clamp", () => {
	it("defaults to the unit interval", () => {
		expect(clamp(1.5)).toBe(1);
		expect(clamp(-0.5)).toBe(0);
		expect(clamp(0.5)).toBe(0.5);
	});

	it("respects explicit bounds", () => {
		expect(clamp(15, 0, 10)).toBe(10);
		expect(clamp(-5, 0, 10)).toBe(0);
		expect(clamp(5, 0, 10)).toBe(5);
	});
});

describe("remap", () => {
	it("maps between ranges", () => {
		expect(remap(5, 0, 10, 0, 1)).toBe(0.5);
		expect(remap(0, 0, 10, -1, 1)).toBe(-1);
		expect(remap(10, 0, 10, -1, 1)).toBe(1);
	});

	it("does not clamp outside the source range", () => {
		expect(remap(20, 0, 10, 0, 1)).toBe(2);
	});

	it("answers toLow for a degenerate source span", () => {
		expect(remap(5, 3, 3, 0, 1)).toBe(0);
	});
});

describe("lerp endpoint exactness", () => {
	it("returns b exactly at t = 1 even when rounding would miss", () => {
		expect(lerp(1e16, 1, 1)).toBe(1);
		expect(lerp(0.1, 0.7, 1)).toBe(0.7);
	});
});

describe("progressIn", () => {
	it("is 0 before the window, 1 after, linear inside", () => {
		expect(progressIn(0.2, 0.4, 0.6)).toBe(0);
		expect(progressIn(0.4, 0.4, 0.6)).toBe(0);
		expect(progressIn(0.5, 0.4, 0.6)).toBeCloseTo(0.5, 12);
		expect(progressIn(0.6, 0.4, 0.6)).toBe(1);
		expect(progressIn(2, 0.4, 0.6)).toBe(1);
	});

	it("steps at start for an empty or reversed window, and reads NaN as 0", () => {
		expect(progressIn(0.49, 0.5, 0.5)).toBe(0);
		expect(progressIn(0.5, 0.5, 0.5)).toBe(1);
		expect(progressIn(0.55, 0.6, 0.4)).toBe(0);
		expect(progressIn(0.7, 0.6, 0.4)).toBe(1);
		expect(progressIn(Number.NaN, 0, 1)).toBe(0);
	});
});

describe("pathAlongArc", () => {
	it("is straight below the threshold", () => {
		const path = pathAlongArc(0);
		expect(path({ x: 0, y: 0 }, { x: 2, y: 2 }, 0.5)).toEqual({ x: 1, y: 1 });
	});

	it("a half turn goes round a half circle on the chord, counter-clockwise for positive", () => {
		const ccw = pathAlongArc(Math.PI);
		const mid = ccw({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.5);
		expect(mid.x).toBeCloseTo(0, 12);
		expect(mid.y).toBeCloseTo(-1, 12);
		const cw = pathAlongArc(-Math.PI)({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.5);
		expect(cw.y).toBeCloseTo(1, 12);
	});

	it("starts and ends on its endpoints and keeps a constant radius", () => {
		const path = pathAlongArc(Math.PI / 3);
		const a = { x: 0.3, y: -1 };
		const b = { x: 2, y: 0.7 };
		const start = path(a, b, 0);
		const end = path(a, b, 1);
		expect(start.x).toBeCloseTo(a.x, 12);
		expect(end.x).toBeCloseTo(b.x, 12);
		expect(end.y).toBeCloseTo(b.y, 12);
		// Equal radius: every sample is as far from the arc's centre as the start.
		const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		const h = { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 };
		const lift = 1 / Math.tan(Math.PI / 6);
		centre.x -= h.y * lift;
		centre.y += h.x * lift;
		const r = Math.hypot(a.x - centre.x, a.y - centre.y);
		for (const t of [0.1, 0.4, 0.8]) {
			const p = path(a, b, t);
			expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(r, 12);
		}
	});
});
