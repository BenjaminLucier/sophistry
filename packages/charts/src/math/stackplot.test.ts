import { describe, expect, it } from "vitest";
import { stackedBands } from "./stackplot.js";

describe("stackedBands", () => {
	it("stacks series atop a shared baseline", () => {
		const bands = stackedBands(
			[0, 1],
			[
				[1, 2],
				[3, 4],
			],
			{ baseline: 0 },
		);
		expect(bands).toHaveLength(2);
		expect(bands[0]).toMatchObject({ bottom: [0, 0], top: [1, 2] });
		expect(bands[1]).toMatchObject({ bottom: [1, 2], top: [4, 6] });
	});

	it("starts from a non-zero baseline", () => {
		const bands = stackedBands([0], [[5]], { baseline: 10 });
		expect(bands[0]).toMatchObject({ bottom: [10], top: [15] });
	});

	it("each band's rings shade its own slice", () => {
		const bands = stackedBands([0, 1], [[1, 2]], { baseline: 0 });
		expect(bands[0].rings).toEqual([
			[
				{ x: 0, y: 1 },
				{ x: 1, y: 2 },
				{ x: 1, y: 0 },
				{ x: 0, y: 0 },
				{ x: 0, y: 1 },
			],
		]);
	});
});

describe("stackedBands non-finite values", () => {
	it("treats NaN/Infinity as 0 so upper bands stay finite", () => {
		const bands = stackedBands(
			[0, 1],
			[
				[1, Number.NaN],
				[2, 2],
				[Number.POSITIVE_INFINITY, 1],
			],
		);
		expect(bands[0].top).toEqual([1, 0]);
		expect(bands[2].top).toEqual([3, 3]);
	});

	it("keeps negatives as subtractions from the running total", () => {
		const bands = stackedBands([0], [[3], [-1]]);
		expect(bands[1].top).toEqual([2]);
	});
});

describe("stackedBands offsets", () => {
	it("normalize turns the bands into shares of each x's total", () => {
		const bands = stackedBands(
			[0, 1],
			[
				[1, 3],
				[3, 1],
			],
			{ offset: "normalize" },
		);
		expect(bands[0].top).toEqual([0.25, 0.75]);
		expect(bands[1].bottom).toEqual([0.25, 0.75]);
		expect(bands[1].top).toEqual([1, 1]);
	});

	it("center and wiggle put the stream around zero", () => {
		for (const offset of ["center", "wiggle"] as const) {
			const bands = stackedBands(
				[0, 1, 2],
				[
					[1, 2, 1],
					[2, 3, 2],
				],
				{ offset },
			);
			const low = Math.min(...bands[0].bottom);
			const high = Math.max(...bands[1].top);
			expect(low).toBeLessThan(0);
			expect(high).toBeGreaterThan(0);
		}
	});

	it("order changes which band is at the bottom, not the band order", () => {
		const bands = stackedBands([0], [[1], [2]], { order: "reverse" });
		expect(bands[0]).toMatchObject({ bottom: [2], top: [3] });
		expect(bands[1]).toMatchObject({ bottom: [0], top: [2] });
	});
});
