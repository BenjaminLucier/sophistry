import { describe, expect, it } from "vitest";
import { contourLines } from "./contour.js";

describe("contourLines", () => {
	it("finds the single crossing segment on a hand-computable 2x2 cell", () => {
		// x=[0,1], y=[0,1]; z[row][col] at (x[col], y[row]):
		//   TL=z[0][0]=0 (0,0)   TR=z[0][1]=1 (1,0)
		//   BL=z[1][0]=1 (0,1)   BR=z[1][1]=2 (1,1)
		// Level 0.5 crosses the top edge (TL 0 -> TR 1) at x=0.5, y=0,
		// and the left edge (TL 0 -> BL 1) at x=0, y=0.5.
		const x = [0, 1];
		const y = [0, 1];
		const z = [
			[0, 1],
			[1, 2],
		];
		const lines = contourLines(x, y, z, [0.5]);
		expect(lines).toHaveLength(1);
		expect(lines[0].level).toBe(0.5);
		expect(lines[0].points).toEqual([
			{ x: 0.5, y: 0 },
			{ x: 0, y: 0.5 },
		]);
	});

	it("resolves the saddle case via the cell-mean tie-break", () => {
		// Checkerboard corners: TL=1, TR=0, BR=1, BL=0. Mean is 0.5, matching
		// level 0.5 and TL/BR (both >= level) — so the "above" region is read as
		// TL-center-BR connected, isolating TR and BL as two separate pieces.
		const x = [0, 1];
		const y = [0, 1];
		const z = [
			[1, 0],
			[0, 1],
		];
		const lines = contourLines(x, y, z, [0.5]);
		expect(lines).toHaveLength(2);
		const sorted = lines
			.map((l) => l.points)
			.sort((a, b) => a[0].x - b[0].x || a[0].y - b[0].y);
		expect(sorted).toEqual([
			[
				{ x: 0.5, y: 0 },
				{ x: 1, y: 0.5 },
			],
			[
				{ x: 0.5, y: 1 },
				{ x: 0, y: 0.5 },
			],
		]);
	});

	it("stitches multiple cells at the same level into one connected polyline", () => {
		// A 1-row ramp repeated over 2 rows so the 0.5-level line runs straight
		// across x=[0.5, 1.5] at y=0.5 for both cells, columns 0..1 and 1..2.
		const x = [0, 1, 2];
		const y = [0, 1];
		const z = [
			[0, 1, 0],
			[0, 1, 0],
		];
		const lines = contourLines(x, y, z, [0.5]);
		// Two separate crossings (rising edge near col 0..1, falling edge near
		// col 1..2), each spanning the full column range at a single level.
		expect(lines).toHaveLength(2);
		for (const line of lines) {
			expect(line.points).toHaveLength(2);
			expect(line.points[0].y).toBeCloseTo(0);
			expect(line.points[1].y).toBeCloseTo(1);
		}
	});

	it("returns nothing for a constant field", () => {
		const x = [0, 1, 2];
		const y = [0, 1, 2];
		const z = [
			[5, 5, 5],
			[5, 5, 5],
			[5, 5, 5],
		];
		expect(contourLines(x, y, z, [5])).toEqual([]);
		expect(contourLines(x, y, z, 4)).toEqual([]);
	});

	it("skips cells touching a NaN corner", () => {
		const x = [0, 1, 2];
		const y = [0, 1];
		const z = [
			[0, 1, Number.NaN],
			[1, 2, 3],
		];
		const lines = contourLines(x, y, z, [1.5]);
		// Only the left cell (cols 0..1) is untouched by NaN; the right cell
		// (cols 1..2) touches it and contributes nothing.
		for (const line of lines) {
			for (const { x: px } of line.points) expect(px).toBeLessThanOrEqual(1);
		}
	});

	it("handles a single-cell grid", () => {
		const x = [0, 1];
		const y = [0, 1];
		const z = [
			[0, 0],
			[1, 1],
		];
		const lines = contourLines(x, y, z, [0.5]);
		expect(lines).toHaveLength(1);
		// Right edge (TR->BR) crosses first, then the left edge (TL->BL).
		expect(lines[0].points).toEqual([
			{ x: 1, y: 0.5 },
			{ x: 0, y: 0.5 },
		]);
	});

	it("returns [] for empty or too-small grids", () => {
		expect(contourLines([], [], [], [1])).toEqual([]);
		expect(contourLines([0], [0], [[1]], [0.5])).toEqual([]);
	});

	it("computes N evenly spaced levels exclusive of the data extent", () => {
		const x = [0, 1];
		const y = [0, 1];
		const z = [
			[0, 10],
			[0, 10],
		];
		// min=0, max=10, count=1 -> single level at the midpoint, 5.
		const lines = contourLines(x, y, z, 1);
		expect(lines).toHaveLength(1);
		expect(lines[0].level).toBe(5);
	});
});
