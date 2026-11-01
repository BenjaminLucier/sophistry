import { describe, expect, it } from "vitest";
import { scatterPoints3 } from "./scatter3d.js";

describe("scatterPoints3", () => {
	it("keeps every finite triple with its original index", () => {
		expect(scatterPoints3([0, 1], [10, 20], [100, 200])).toEqual([
			{ index: 0, x: 0, y: 10, z: 100 },
			{ index: 1, x: 1, y: 20, z: 200 },
		]);
	});

	it("drops non-finite triples but preserves the surviving indices", () => {
		expect(scatterPoints3([0, Number.NaN, 2], [10, 20, 30], [1, 2, 3])).toEqual(
			[
				{ index: 0, x: 0, y: 10, z: 1 },
				{ index: 2, x: 2, y: 30, z: 3 },
			],
		);
	});

	it("truncates to the shortest of the three arrays", () => {
		expect(scatterPoints3([0, 1, 2], [0, 1], [0, 1, 2])).toHaveLength(2);
	});
});
