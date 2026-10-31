import { describe, expect, it } from "vitest";
import type { VectorFn } from "./field";
import { fieldJitter, rk4Step, streamline, streamlineBothWays } from "./field";
import type { Bounds, Point } from "./path/types";

function expectPointClose(a: Point, b: Point, digits = 6) {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
}

describe("rk4Step", () => {
	it("a zero field leaves the point unchanged", () => {
		const zero: VectorFn = () => ({ x: 0, y: 0 });
		const p = rk4Step(zero, { x: 3, y: 4 }, 0.1);
		expectPointClose(p as Point, { x: 3, y: 4 });
	});

	it("a constant field moves the point by field*dt", () => {
		const constant: VectorFn = () => ({ x: 1, y: 0 });
		const p = rk4Step(constant, { x: 0, y: 0 }, 0.5);
		expectPointClose(p as Point, { x: 0.5, y: 0 });
	});

	it("returns null when the field is non-finite at the start", () => {
		const bad: VectorFn = () => ({ x: Number.NaN, y: 0 });
		expect(rk4Step(bad, { x: 0, y: 0 }, 0.1)).toBeNull();
	});

	it("integrates a rotational field approximately along a circle for a small step", () => {
		// f(x,y) = (-y, x): pure rotation, speed = radius.
		const rotational: VectorFn = ({ x, y }) => ({ x: -y, y: x });
		const start = { x: 1, y: 0 };
		const next = rk4Step(rotational, start, 0.01) as Point;
		const radiusBefore = Math.hypot(start.x, start.y);
		const radiusAfter = Math.hypot(next.x, next.y);
		// RK4 error is O(h^5); radius should be preserved to a tight tolerance.
		expect(Math.abs(radiusAfter - radiusBefore)).toBeLessThan(1e-6);
	});
});

describe("streamline", () => {
	const rotational: VectorFn = ({ x, y }) => ({ x: -y, y: x });

	it("a non-finite start returns an empty polyline", () => {
		expect(
			streamline(rotational, { x: Number.NaN, y: 0 }, { dt: 0.1, steps: 10 }),
		).toEqual([]);
	});

	it("zero or non-finite dt returns just the start point", () => {
		expect(
			streamline(rotational, { x: 1, y: 0 }, { dt: 0, steps: 10 }),
		).toEqual([{ x: 1, y: 0 }]);
	});

	it("takes at most steps+1 points", () => {
		const line = streamline(
			rotational,
			{ x: 1, y: 0 },
			{ dt: 0.05, steps: 20 },
		);
		expect(line.length).toBeLessThanOrEqual(21);
	});

	it("stops when leaving the given bounds", () => {
		const constant: VectorFn = () => ({ x: 1, y: 0 });
		const bounds: Bounds = { minX: 0, minY: -1, maxX: 0.25, maxY: 1 };
		const line = streamline(
			constant,
			{ x: 0, y: 0 },
			{
				dt: 0.1,
				steps: 100,
				bounds,
			},
		);
		for (const p of line) {
			expect(p.x).toBeLessThanOrEqual(0.25 + 1e-9);
		}
		expect(line.length).toBeLessThan(101);
	});

	it("stops at a fixed point (speed below minSpeed)", () => {
		const fixedPointField: VectorFn = ({ x, y }) => ({ x: -x, y: -y });
		const line = streamline(
			fixedPointField,
			{ x: 0, y: 0 },
			{
				dt: 0.1,
				steps: 50,
			},
		);
		// starting exactly at the fixed point: speed is 0 immediately.
		expect(line.length).toBe(1);
	});

	it("backward integrates against the flow", () => {
		const constant: VectorFn = () => ({ x: 1, y: 0 });
		const forward = streamline(constant, { x: 0, y: 0 }, { dt: 0.1, steps: 5 });
		const backward = streamline(
			constant,
			{ x: 0, y: 0 },
			{
				dt: 0.1,
				steps: 5,
				backward: true,
			},
		);
		expect(forward[forward.length - 1].x).toBeGreaterThan(0);
		expect(backward[backward.length - 1].x).toBeLessThan(0);
	});

	it("negative steps is clamped to zero (only the seed returned)", () => {
		const constant: VectorFn = () => ({ x: 1, y: 0 });
		expect(
			streamline(constant, { x: 0, y: 0 }, { dt: 0.1, steps: -5 }),
		).toEqual([{ x: 0, y: 0 }]);
	});
});

describe("streamlineBothWays", () => {
	it("joins backward (reversed, seed dropped) with forward", () => {
		const constant: VectorFn = () => ({ x: 1, y: 0 });
		const both = streamlineBothWays(
			constant,
			{ x: 0, y: 0 },
			{
				dt: 0.1,
				steps: 3,
			},
		);
		// monotonically increasing x across the whole line
		for (let i = 1; i < both.length; i++) {
			expect(both[i].x).toBeGreaterThan(both[i - 1].x);
		}
	});
});

describe("fieldJitter", () => {
	it("is deterministic for the same index and salt", () => {
		expect(fieldJitter(5, 2)).toBe(fieldJitter(5, 2));
	});

	it("stays within [-1, 1)", () => {
		for (let i = 0; i < 200; i++) {
			const v = fieldJitter(i, i * 7);
			expect(v).toBeGreaterThanOrEqual(-1);
			expect(v).toBeLessThan(1);
		}
	});

	it("different indices generally produce different values", () => {
		const values = new Set<number>();
		for (let i = 0; i < 20; i++) values.add(fieldJitter(i));
		expect(values.size).toBeGreaterThan(15);
	});
});

describe("streamlineBothWays with negative dt", () => {
	it("still lists the oldest point first", () => {
		const f: VectorFn = () => ({ x: 1, y: 0 });
		const line = streamlineBothWays(f, { x: 0, y: 0 }, { dt: -0.1, steps: 5 });
		expect(line[0].x).toBeLessThan(0);
		expect(line[line.length - 1].x).toBeGreaterThan(0);
		for (let i = 1; i < line.length; i++)
			expect(line[i].x).toBeGreaterThan(line[i - 1].x);
	});
});
