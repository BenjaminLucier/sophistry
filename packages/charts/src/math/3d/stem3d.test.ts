import { describe, expect, it } from "vitest";
import { stemPoints3 } from "./stem3d.js";

describe("stemPoints3", () => {
	it("drops along y (height) from the baseline to each point", () => {
		expect(stemPoints3([0, 1], [5, -4], [2, 3], { baseline: 0 })).toEqual([
			{
				index: 0,
				drop: [
					{ x: 0, y: 0, z: 2 },
					{ x: 0, y: 5, z: 2 },
				],
				marker: { x: 0, y: 5, z: 2 },
			},
			{
				index: 1,
				drop: [
					{ x: 1, y: 0, z: 3 },
					{ x: 1, y: -4, z: 3 },
				],
				marker: { x: 1, y: -4, z: 3 },
			},
		]);
	});

	it("defaults baseline to 0", () => {
		const [point] = stemPoints3([0], [7], [0]);
		expect(point.drop[0].y).toBe(0);
	});

	it("truncates to the shortest of the three arrays", () => {
		expect(stemPoints3([0, 1, 2], [0, 1], [0, 1, 2])).toHaveLength(2);
	});

	it("skips non-finite triples", () => {
		expect(stemPoints3([0, 1], [0, Number.NaN], [0, 1])).toHaveLength(1);
	});
});
