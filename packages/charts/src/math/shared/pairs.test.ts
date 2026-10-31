import { describe, expect, it } from "vitest";
import { pairCount } from "./pairs";

describe("pairCount", () => {
	it("is the shorter of the two lengths", () => {
		expect(pairCount([1, 2, 3], [1, 2])).toBe(2);
		expect(pairCount([1], [1, 2, 3])).toBe(1);
	});

	it("is 0 when either array is empty", () => {
		expect(pairCount([], [1, 2])).toBe(0);
		expect(pairCount([1, 2], [])).toBe(0);
	});
});
