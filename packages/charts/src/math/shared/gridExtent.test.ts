import { describe, expect, it } from "vitest";
import { dataExtent, resolveLevels } from "./gridExtent";

describe("dataExtent", () => {
	it("finds the finite min/max across a 2D grid", () => {
		expect(
			dataExtent([
				[1, 2],
				[3, Number.NaN],
			]),
		).toEqual([1, 3]);
	});

	it("returns null when there are no finite values", () => {
		expect(dataExtent([[Number.NaN]])).toBeNull();
		expect(dataExtent([])).toBeNull();
	});
});

describe("resolveLevels", () => {
	const even = (min: number, max: number, count: number) =>
		Array.from({ length: count }, (_, i) => min + (i * (max - min)) / count);

	it("passes explicit levels through", () => {
		expect(resolveLevels([1, 2, 3], [[0, 10]], even)).toEqual([1, 2, 3]);
	});

	it("derives evenly spaced levels from the data extent via evenFn", () => {
		expect(resolveLevels(2, [[0, 10]], even)).toEqual([0, 5]);
	});

	it("resolves to [] for a constant field or all-non-finite field", () => {
		expect(resolveLevels(4, [[5, 5]], even)).toEqual([]);
		expect(resolveLevels(4, [[Number.NaN]], even)).toEqual([]);
	});
});
