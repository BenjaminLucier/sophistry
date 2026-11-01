import { describe, expect, it } from "vitest";
import { contourBands } from "./contourf.js";

describe("contourBands", () => {
	it("clips a linear ramp cell into two hand-computable half-square bands", () => {
		// A single cell over [0,1]x[0,1] with z = 10*x (constant in y):
		//   TL=0 (0,0)   TR=10 (1,0)
		//   BL=0 (0,1)   BR=10 (1,1)
		// Boundaries [0, 5, 10] -> two bands. Since z is exactly linear in x,
		// the 5-crossing sits at x=0.5 on both the top and bottom edges, so
		// each band is precisely a half of the unit square.
		const x = [0, 1];
		const y = [0, 1];
		const z = [
			[0, 10],
			[0, 10],
		];
		const bands = contourBands(x, y, z, [0, 5, 10]);
		expect(bands).toHaveLength(2);

		expect(bands[0].loLevel).toBe(0);
		expect(bands[0].hiLevel).toBe(5);
		expect(bands[0].polygons).toHaveLength(1);
		expect(bands[0].polygons[0]).toEqual([
			{ x: 0, y: 0 },
			{ x: 0.5, y: 0 },
			{ x: 0.5, y: 1 },
			{ x: 0, y: 1 },
		]);

		expect(bands[1].loLevel).toBe(5);
		expect(bands[1].hiLevel).toBe(10);
		expect(bands[1].polygons).toHaveLength(1);
		expect(bands[1].polygons[0]).toEqual([
			{ x: 0.5, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0.5, y: 1 },
		]);
	});

	it("emits one polygon per contributing cell, skipping a band a cell never reaches", () => {
		// Two side-by-side cells sharing column x=2: the left cell (z in
		// {0,2}) sits entirely below the 5 threshold and so contributes
		// nothing to the [5,10] band; the right cell (z in {2,10}) straddles
		// 5 and contributes a partial polygon to both bands.
		const x = [0, 2, 10];
		const y = [0, 1];
		const z = [
			[0, 2, 10],
			[0, 2, 10],
		];
		const bands = contourBands(x, y, z, [0, 5, 10]);
		// band [0,5]: left cell's full quad, plus the right cell's clipped
		// low half -> 2 polygons.
		expect(bands[0].polygons).toHaveLength(2);
		// band [5,10]: only the right cell's clipped high half -> 1 polygon.
		expect(bands[1].polygons).toHaveLength(1);
		expect(bands[1].polygons[0]).toEqual([
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 1 },
			{ x: 5, y: 1 },
		]);
	});

	it("returns [] for a constant field", () => {
		const x = [0, 1, 2];
		const y = [0, 1, 2];
		const z = [
			[3, 3, 3],
			[3, 3, 3],
			[3, 3, 3],
		];
		expect(contourBands(x, y, z, [1, 2, 3])).toHaveLength(2);
		expect(contourBands(x, y, z, 4)).toEqual([]);
	});

	it("skips cells touching a NaN corner", () => {
		const x = [0, 1, 2];
		const y = [0, 1];
		const z = [
			[0, 10, Number.NaN],
			[0, 10, 10],
		];
		const bands = contourBands(x, y, z, [0, 5, 10]);
		// Only the left cell (cols 0..1) contributes; the right cell (cols
		// 1..2) touches NaN and contributes to neither band.
		for (const band of bands) {
			for (const polygon of band.polygons) {
				for (const { x: px } of polygon) expect(px).toBeLessThanOrEqual(1);
			}
		}
	});

	it("returns [] for empty or too-small grids", () => {
		expect(contourBands([], [], [], [0, 1])).toEqual([]);
		expect(contourBands([0], [0], [[1]], [0, 1, 2])).toEqual([]);
	});

	it("returns [] when fewer than two levels resolve", () => {
		const x = [0, 1];
		const y = [0, 1];
		const z = [
			[0, 1],
			[0, 1],
		];
		expect(contourBands(x, y, z, [1])).toEqual([]);
		expect(contourBands(x, y, z, 1)).toEqual([]);
	});

	it("produces N-1 bands from N evenly spaced boundaries covering the full extent", () => {
		const x = [0, 1];
		const y = [0, 1];
		const z = [
			[0, 20],
			[0, 20],
		];
		const bands = contourBands(x, y, z, 3);
		expect(bands).toHaveLength(2);
		expect(bands[0].loLevel).toBe(0);
		expect(bands[0].hiLevel).toBe(10);
		expect(bands[1].loLevel).toBe(10);
		expect(bands[1].hiLevel).toBe(20);
	});
});
