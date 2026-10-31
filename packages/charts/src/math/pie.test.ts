import { describe, expect, it } from "vitest";
import { pieGrow, pieSlices, pieSweep, sweepWedge } from "./pie";

describe("pieSlices", () => {
	it("sweeps a full turn across three values", () => {
		const slices = pieSlices([1, 2, 3]);
		const totalSweep = slices.reduce(
			(sum, slice) => sum + (slice.endAngle - slice.startAngle),
			0,
		);
		expect(Math.abs(totalSweep)).toBeCloseTo(2 * Math.PI);
	});

	it("keeps a zero-value entry as a zero-sweep slice, not dropped", () => {
		const slices = pieSlices([1, 0, 1]);
		expect(slices).toHaveLength(3);
		expect(slices[1].index).toBe(1);
		expect(slices[1].endAngle - slices[1].startAngle).toBeCloseTo(0);
		expect(slices[1].fraction).toBeCloseTo(0);
		// index alignment: the third input value is still slice index 2.
		expect(slices[2].index).toBe(2);
	});

	it("returns [] when every value is zero", () => {
		expect(pieSlices([0, 0, 0])).toEqual([]);
	});

	it("returns [] for empty input", () => {
		expect(pieSlices([])).toEqual([]);
	});

	it("clamps a negative value to 0 instead of throwing", () => {
		expect(() => pieSlices([1, -5, 2])).not.toThrow();
		const slices = pieSlices([1, -5, 2]);
		expect(slices[1].value).toBe(0);
		expect(slices[1].endAngle - slices[1].startAngle).toBeCloseTo(0);
	});

	it("sweeps counter-clockwise when clockwise is false", () => {
		const clockwise = pieSlices([1, 1], { clockwise: true });
		const counterClockwise = pieSlices([1, 1], { clockwise: false });
		expect(clockwise[0].endAngle - clockwise[0].startAngle).toBeLessThan(0);
		expect(
			counterClockwise[0].endAngle - counterClockwise[0].startAngle,
		).toBeGreaterThan(0);
	});

	it("honours a custom startAngle", () => {
		const slices = pieSlices([1, 1, 1], { startAngle: 0 });
		expect(slices[0].startAngle).toBeCloseTo(0);
	});

	it("defaults startAngle to Math.PI / 2 (12 o'clock on a y-up stage)", () => {
		const slices = pieSlices([1, 1]);
		expect(slices[0].startAngle).toBeCloseTo(Math.PI / 2);
	});

	it("sums fractions to 1 when not all-zero", () => {
		const slices = pieSlices([3, 1, 4, 1, 5]);
		const totalFraction = slices.reduce(
			(sum, slice) => sum + slice.fraction,
			0,
		);
		expect(totalFraction).toBeCloseTo(1);
	});
});

describe("pieSweep", () => {
	it("uncovers the slices one after another, in data order", () => {
		const slices = pieSlices([1, 1, 2]);
		expect(pieSweep(slices, 0)).toEqual([0, 0, 0]);
		expect(pieSweep(slices, 0.125)).toEqual([0.5, 0, 0]);
		expect(pieSweep(slices, 0.5)).toEqual([1, 1, 0]);
		expect(pieSweep(slices, 0.75)).toEqual([1, 1, 0.5]);
		expect(pieSweep(slices, 1)).toEqual([1, 1, 1]);
	});

	it("is a pure function of progress, so it scrubs backwards", () => {
		const slices = pieSlices([3, 1, 4, 1, 5]);
		const forward = [0, 0.2, 0.6, 1].map((p) => pieSweep(slices, p));
		const back = [1, 0.6, 0.2, 0].map((p) => pieSweep(slices, p));
		expect(back.reverse()).toEqual(forward);
	});
});

describe("pieGrow", () => {
	it("scales every slice together from the first slice's start", () => {
		const slices = pieSlices([1, 1, 2]);
		const origin = slices[0].startAngle;
		const half = pieGrow(slices, 0.5);
		const sweeps = half.map((s) => s.endAngle - s.startAngle);
		const full = slices.map((s) => s.endAngle - s.startAngle);
		sweeps.forEach((sweep, i) => {
			expect(sweep).toBeCloseTo(full[i] / 2);
		});
		expect(half[0].startAngle).toBeCloseTo(origin);
		// Consecutive: each starts where the one before ends.
		expect(half[1].startAngle).toBeCloseTo(half[0].endAngle);
		expect(half[2].startAngle).toBeCloseTo(half[1].endAngle);
		expect(half[2].endAngle).toBeCloseTo(origin - Math.PI);
	});

	it("is the slices themselves at 1 and a point at 0", () => {
		const slices = pieSlices([3, 1]);
		pieGrow(slices, 1).forEach((s, i) => {
			expect(s.startAngle).toBeCloseTo(slices[i].startAngle);
			expect(s.endAngle).toBeCloseTo(slices[i].endAngle);
		});
		for (const s of pieGrow(slices, 0)) expect(s.endAngle).toBe(s.startAngle);
	});
});

describe("sweepWedge", () => {
	it("is a wedge from the centre turning clockwise from 12 o'clock", () => {
		const wedge = sweepWedge(0.25, { radius: 2, center: { x: 1, y: 1 } }) ?? [];
		expect(wedge[0]).toEqual({ x: 1, y: 1 });
		expect(wedge[1].x).toBeCloseTo(1);
		expect(wedge[1].y).toBeCloseTo(3);
		const last = wedge[wedge.length - 1];
		expect(last.x).toBeCloseTo(3);
		expect(last.y).toBeCloseTo(1);
	});

	it("turns the other way when counter-clockwise", () => {
		const wedge = sweepWedge(0.25, { radius: 1, clockwise: false }) ?? [];
		expect(wedge[wedge.length - 1].x).toBeCloseTo(-1);
	});

	it("clips everything before it starts and nothing once it is done", () => {
		expect(sweepWedge(0, { radius: 1 })).toEqual([{ x: 0, y: 0 }]);
		expect(sweepWedge(1, { radius: 1 })).toBeUndefined();
	});
});
