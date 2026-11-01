import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Polyline } from "../geometry/index.js";
import { track } from "../reactive/index.js";
import { createClock } from "../tween/clock.js";
import {
	applyComplexFunction,
	applyFunction,
	homotopy,
	phaseFlow,
} from "./movement.js";
import { timeline } from "./timeline.js";

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const square: Polyline = [
	{ x: 0.5, y: -0.5 },
	{ x: 1.5, y: -0.5 },
	{ x: 1.5, y: 0.5 },
	{ x: 0.5, y: 0.5 },
	{ x: 0.5, y: -0.5 },
];
const linear = { duration: 1, easing: "linear" as const };

describe("homotopy", () => {
	it("flows the points through h(p, t), splitting edges so they can bend", () => {
		const points = track(square);
		const run = timeline(
			homotopy(points, (p, t) => ({ x: p.x, y: p.y + t * p.x * p.x }), linear),
			{ clock: createClock() },
		);
		run.seek(1);
		const end = points.peek();
		expect(end.length).toBeGreaterThan(square.length);
		for (const p of end) {
			const original = p.y - p.x * p.x;
			expect(Math.abs(original)).toBeLessThanOrEqual(0.5 + 1e-9);
		}
		run.seek(0);
		expect(points.peek()).toBe(square);
	});

	it("keeps several rings several", () => {
		const points = track<Polyline[]>([square, square]);
		const run = timeline(
			homotopy(points, (p) => p, linear),
			{
				clock: createClock(),
			},
		);
		run.seek(0.5);
		expect(points.peek()).toHaveLength(2);
	});
});

describe("applyFunction", () => {
	it("sends every point to its image and leaves it there", () => {
		const points = track(square);
		const f = (p: { x: number; y: number }) => ({ x: 2 * p.x, y: p.y + 1 });
		const run = timeline(
			applyFunction(points, f, { ...linear, segmentLength: 0 }),
			{
				clock: createClock(),
			},
		);
		run.seek(0.5);
		expect(points.peek()[0]).toEqual({ x: 0.75, y: 0 });
		run.seek(1);
		expect(points.peek()).toEqual(square.map(f));
	});
});

describe("applyComplexFunction", () => {
	it("maps through f(z) and turns along arg f(1) by default", () => {
		const points = track<Polyline>([{ x: 1, y: 0 }]);
		// z ↦ i·z: a quarter turn, so the path is a quarter arc about the origin.
		const run = timeline(
			applyComplexFunction(points, ({ re, im }) => ({ re: -im, im: re }), {
				...linear,
				segmentLength: 0,
			}),
			{ clock: createClock() },
		);
		run.seek(0.5);
		const [mid] = points.peek();
		expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(1, 9);
		expect(Math.atan2(mid.y, mid.x)).toBeCloseTo(Math.PI / 4, 9);
		run.seek(1);
		expect(points.peek()[0].x).toBeCloseTo(0, 12);
		expect(points.peek()[0].y).toBeCloseTo(1, 12);
	});
});

describe("phaseFlow", () => {
	it("carries each point along the field for virtualTime, whatever the duration", () => {
		// Rotation at unit speed: after virtualTime π/2 every point has turned a quarter.
		const points = track<Polyline>([{ x: 1, y: 0 }]);
		const run = timeline(
			phaseFlow(points, ({ x, y }) => ({ x: -y, y: x }), {
				duration: 2,
				virtualTime: Math.PI / 2,
				segmentLength: 0,
			}),
			{ clock: createClock() },
		);
		run.seek(1);
		const [mid] = points.peek();
		expect(Math.atan2(mid.y, mid.x)).toBeCloseTo(Math.PI / 4, 4);
		expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(1, 4);
		run.seek(2);
		expect(points.peek()[0].x).toBeCloseTo(0, 6);
		expect(points.peek()[0].y).toBeCloseTo(1, 6);
		run.seek(0);
		expect(points.peek()[0]).toEqual({ x: 1, y: 0 });
	});

	it("leaves a point that blows up where it last was", () => {
		const points = track<Polyline>([{ x: 1, y: 0 }]);
		const run = timeline(
			phaseFlow(points, ({ x }) => ({ x: x > 3 ? Number.NaN : 1, y: 0 }), {
				virtualTime: 10,
				segmentLength: 0,
				easing: "linear",
			}),
			{ clock: createClock() },
		);
		run.seek(1);
		expect(Number.isFinite(points.peek()[0].x)).toBe(true);
	});
});
