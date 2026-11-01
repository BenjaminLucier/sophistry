import { describe, expect, it } from "vitest";
import { scatterPoints } from "./scatter.js";

describe("scatterPoints", () => {
	it("keeps every finite pair with its original index", () => {
		expect(scatterPoints([0, 1, 2], [10, 20, 30])).toEqual([
			{ index: 0, x: 0, y: 10 },
			{ index: 1, x: 1, y: 20 },
			{ index: 2, x: 2, y: 30 },
		]);
	});

	it("drops non-finite pairs but preserves the surviving indices", () => {
		expect(scatterPoints([0, Number.NaN, 2], [10, 20, 30])).toEqual([
			{ index: 0, x: 0, y: 10 },
			{ index: 2, x: 2, y: 30 },
		]);
	});
});
