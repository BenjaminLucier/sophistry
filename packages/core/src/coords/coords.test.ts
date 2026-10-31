/**
 * The coordinate-system helpers: `crossingValue`, `phaseProgress`,
 * `createPhases` and `createCartesianCoords` (immutable, made from plain
 * values).
 */

import { describe, expect, it } from "vitest";
import type { Range } from "../geometry";
import { track } from "../reactive";
import type { CartesianOptions } from "./coords";
import {
	createCartesianCoords,
	createPhases,
	crossingValue,
	phaseProgress,
} from "./coords";

describe("crossingValue", () => {
	it("is zero when zero is inside the range", () => {
		expect(crossingValue([-3, 8])).toBe(0);
	});

	it("clamps to the nearest endpoint when zero is outside the range", () => {
		expect(crossingValue([3, 8])).toBe(3);
		expect(crossingValue([-8, -3])).toBe(-3);
	});

	it("handles a reversed range (max first)", () => {
		expect(crossingValue([8, 3])).toBe(3);
		expect(crossingValue([-3, -8])).toBe(-3);
	});

	it("handles a degenerate single-point range", () => {
		expect(crossingValue([5, 5])).toBe(5);
		expect(crossingValue([0, 0])).toBe(0);
	});
});

describe("phaseProgress", () => {
	it("phase 0 runs first: full budget once progress reaches 1/count", () => {
		expect(phaseProgress(0, 0, 4)).toBe(0);
		expect(phaseProgress(0.25, 0, 4)).toBe(1);
		expect(phaseProgress(1, 0, 4)).toBe(1);
	});

	it("later phases stay at 0 until earlier ones finish", () => {
		expect(phaseProgress(0.1, 1, 4)).toBe(0);
		expect(phaseProgress(0.25, 1, 4)).toBe(0);
	});

	it("a phase ramps linearly through its own slice", () => {
		// count=2, index=1: phase spans progress in [0.5, 1].
		expect(phaseProgress(0.5, 1, 2)).toBe(0);
		expect(phaseProgress(0.75, 1, 2)).toBeCloseTo(0.5);
		expect(phaseProgress(1, 1, 2)).toBe(1);
	});

	it("clamps below 0 and above 1 (no overshoot / undershoot)", () => {
		expect(phaseProgress(-1, 0, 4)).toBe(0);
		expect(phaseProgress(2, 0, 4)).toBe(1);
	});
});

describe("createPhases", () => {
	it("derives each phase from the progress track, treating undefined as 1", () => {
		const progress = track<number | undefined>(undefined);
		const phase = createPhases(progress, 2);
		expect(phase(0).peek()).toBe(1);
		expect(phase(1).peek()).toBe(1);
		progress.set(0.25);
		expect(phase(0).peek()).toBeCloseTo(0.5);
		expect(phase(1).peek()).toBe(0);
		// One readable per phase, so children binding to it share it.
		expect(phase(0)).toBe(phase(0));
	});
});

function cartesian(options: Partial<CartesianOptions> = {}) {
	return createCartesianCoords({
		xRange: [0, 10],
		yRange: [0, 10],
		width: 10,
		height: 10,
		center: { x: 0, y: 0 },
		...options,
	});
}

describe("createCartesianCoords", () => {
	it("coordsToPoint places the range midpoint at `center`", () => {
		expect(cartesian().coordsToPoint(5, 5)).toEqual({ x: 0, y: 0 });
	});

	it("coordsToPoint defaults y to 0 when omitted", () => {
		const coords = cartesian({ yRange: [-5, 5] });
		expect(coords.coordsToPoint(5)).toEqual(coords.coordsToPoint(5, 0));
	});

	it("coordsToPoint / pointToCoords round-trip for typical values", () => {
		const coords = cartesian({
			xRange: [-4, 4],
			yRange: [-2, 6],
			width: 8,
			height: 4,
			center: { x: 1, y: -1 },
		});
		for (const [x, y] of [
			[0, 0],
			[-4, -2],
			[4, 6],
			[1.5, 2.25],
			[-3.9, 5.9],
		] as const) {
			const back = coords.pointToCoords(coords.coordsToPoint(x, y));
			expect(back.x).toBeCloseTo(x);
			expect(back.y).toBeCloseTo(y);
		}
	});

	it("coordsToPoint / pointToCoords round-trip with a non-1 zoom-like scale (large width/height)", () => {
		const coords = cartesian({
			xRange: [0, 1],
			yRange: [0, 1],
			width: 1000,
			height: 500,
			center: { x: 100, y: 200 },
		});
		const back = coords.pointToCoords(coords.coordsToPoint(0.3, 0.7));
		expect(back.x).toBeCloseTo(0.3);
		expect(back.y).toBeCloseTo(0.7);
	});

	it("coordsToPoint / pointToCoords round-trip for a negative domain", () => {
		const coords = cartesian({
			xRange: [-100, -10],
			yRange: [-50, -5],
			width: 20,
			height: 10,
		});
		const back = coords.pointToCoords(coords.coordsToPoint(-55, -20));
		expect(back.x).toBeCloseTo(-55);
		expect(back.y).toBeCloseTo(-20);
	});

	it("pointToCoords does not divide by zero when width/height are 0 (degenerate plot area)", () => {
		const coords = cartesian({ width: 0, height: 0, center: { x: 3, y: 4 } });
		const back = coords.pointToCoords({ x: 3, y: 4 });
		expect(Number.isFinite(back.x)).toBe(true);
		expect(Number.isFinite(back.y)).toBe(true);
	});

	it("area() is centred on `center` with the given width/height", () => {
		const coords = cartesian({ width: 8, height: 4, center: { x: 2, y: 3 } });
		expect(coords.area()).toEqual({ minX: -2, minY: 1, maxX: 6, maxY: 5 });
	});

	it("crossing() reports the axis-crossing data coordinate per range", () => {
		const coords = cartesian({ xRange: [3, 8], yRange: [-5, 5] });
		expect(coords.crossing()).toEqual({ x: 3, y: 0 });
	});

	it("values outside the range are not clamped by coordsToPoint", () => {
		const coords = cartesian();
		const inside = coords.coordsToPoint(10, 10); // range max -> area's max edge (5, 5)
		const outside = coords.coordsToPoint(20, 20); // twice the range max -> overshoots the area
		expect(inside).toEqual({ x: 5, y: 5 });
		expect(outside.x).toBeGreaterThan(inside.x);
		expect(outside.y).toBeGreaterThan(inside.y);
	});

	it("clamps per axis when asked", () => {
		const coords = cartesian({ xClamp: true });
		expect(coords.coordsToPoint(20, 20)).toEqual({ x: 5, y: 15 });
	});

	it("respects a log xScale for coordsToPoint/pointToCoords", () => {
		const coords = cartesian({ xRange: [1, 100], xScale: "log" });
		const back = coords.pointToCoords(coords.coordsToPoint(10, 5));
		expect(back.x).toBeCloseTo(10);
		expect(back.y).toBeCloseTo(5);
	});

	it("is immutable: reports the ranges it was made from, and hands out copies", () => {
		const xRange: Range = [0, 4];
		const coords = cartesian({ xRange });
		expect(coords.xRange()).toBe(xRange);
		expect(Object.isFrozen(coords)).toBe(true);
		const area = coords.area();
		area.minX = 99;
		expect(coords.area().minX).toBe(-5);
	});
});
