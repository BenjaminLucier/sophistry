import { describe, expect, it } from "vitest";
import { stemPoints } from "./stem.js";

describe("stemPoints", () => {
	it("drops from the baseline to each point", () => {
		expect(stemPoints([0, 1], [3, -2], { baseline: 0 })).toEqual([
			{
				index: 0,
				drop: [
					{ x: 0, y: 0 },
					{ x: 0, y: 3 },
				],
				marker: { x: 0, y: 3 },
			},
			{
				index: 1,
				drop: [
					{ x: 1, y: 0 },
					{ x: 1, y: -2 },
				],
				marker: { x: 1, y: -2 },
			},
		]);
	});

	it("skips non-finite pairs", () => {
		expect(stemPoints([0, 1], [Number.NaN, 2])).toHaveLength(1);
	});
});
