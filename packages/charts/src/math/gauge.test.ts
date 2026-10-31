import { describe, expect, it } from "vitest";
import {
	GAUGE_END_ANGLE,
	GAUGE_START_ANGLE,
	gaugeAngle,
	gaugeBandIndex,
	gaugeBands,
	gaugeFraction,
} from "./gauge";

describe("gaugeFraction", () => {
	it("maps min..max onto 0..1", () => {
		expect(gaugeFraction(0, 0, 100)).toBe(0);
		expect(gaugeFraction(25, 0, 100)).toBe(0.25);
		expect(gaugeFraction(100, 0, 100)).toBe(1);
		expect(gaugeFraction(15, 10, 20)).toBe(0.5);
	});

	it("clamps values outside the range", () => {
		expect(gaugeFraction(150, 0, 100)).toBe(1);
		expect(gaugeFraction(-20, 0, 100)).toBe(0);
	});

	it("reads a non-finite value or a degenerate range as 0", () => {
		expect(gaugeFraction(Number.NaN, 0, 100)).toBe(0);
		expect(gaugeFraction(5, 10, 10)).toBe(0);
		expect(gaugeFraction(5, 10, 0)).toBe(0);
	});
});

describe("gaugeAngle", () => {
	it("defaults to a 240° arc opening downward, symmetric about 12 o'clock", () => {
		expect(GAUGE_START_ANGLE - GAUGE_END_ANGLE).toBeCloseTo((4 * Math.PI) / 3);
		expect(gaugeAngle(0.5)).toBeCloseTo(Math.PI / 2);
		// Both ends sit below the centre, mirrored about the vertical.
		expect(Math.sin(gaugeAngle(0))).toBeCloseTo(-0.5);
		expect(Math.sin(gaugeAngle(1))).toBeCloseTo(-0.5);
		expect(Math.cos(gaugeAngle(0))).toBeCloseTo(-Math.cos(gaugeAngle(1)));
	});

	it("sweeps clockwise: the angle decreases as the fraction grows", () => {
		expect(gaugeAngle(0.25)).toBeLessThan(gaugeAngle(0));
		expect(gaugeAngle(1)).toBeLessThan(gaugeAngle(0.75));
		// The left end is on the left.
		expect(Math.cos(gaugeAngle(0))).toBeLessThan(0);
	});

	it("honours custom angles", () => {
		expect(gaugeAngle(0.5, Math.PI, 0)).toBeCloseTo(Math.PI / 2);
	});
});

describe("gaugeBands", () => {
	it("runs each band from the previous threshold", () => {
		const spans = gaugeBands([{ to: 60 }, { to: 85 }, { to: 100 }], 0, 100);
		expect(spans.map((s) => [s.from, s.to])).toEqual([
			[0, 60],
			[60, 85],
			[85, 100],
		]);
		expect(spans[1].startFraction).toBeCloseTo(0.6);
		expect(spans[1].endFraction).toBeCloseTo(0.85);
	});

	it("clamps to the range, with Infinity meaning to the end", () => {
		const spans = gaugeBands(
			[{ to: -5 }, { to: 50 }, { to: Infinity }],
			0,
			100,
		);
		expect(spans.map((s) => [s.from, s.to])).toEqual([
			[0, 0],
			[0, 50],
			[50, 100],
		]);
	});

	it("keeps out-of-order and NaN bands as zero width", () => {
		const spans = gaugeBands(
			[{ to: 50 }, { to: 30 }, { to: Number.NaN }],
			0,
			100,
		);
		expect(spans).toHaveLength(3);
		expect(spans[1].to - spans[1].from).toBe(0);
		expect(spans[2].to - spans[2].from).toBe(0);
	});

	it("returns [] for a degenerate range", () => {
		expect(gaugeBands([{ to: 1 }], 5, 5)).toEqual([]);
	});
});

describe("gaugeBandIndex", () => {
	const spans = gaugeBands([{ to: 60 }, { to: 85 }, { to: 100 }], 0, 100);

	it("finds the band a value falls in, thresholds closing their band", () => {
		expect(gaugeBandIndex(0, spans)).toBe(0);
		expect(gaugeBandIndex(60, spans)).toBe(0);
		expect(gaugeBandIndex(60.1, spans)).toBe(1);
		expect(gaugeBandIndex(99, spans)).toBe(2);
	});

	it("clamps below the range into the first band; above every band is -1", () => {
		expect(gaugeBandIndex(-10, spans)).toBe(0);
		const partial = gaugeBands([{ to: 50 }], 0, 100);
		expect(gaugeBandIndex(70, partial)).toBe(-1);
		expect(gaugeBandIndex(Number.NaN, spans)).toBe(-1);
	});
});
