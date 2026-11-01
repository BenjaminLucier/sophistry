import { describe, expect, it } from "vitest";
import { fillBetweenRings } from "./fillBetween.js";

describe("fillBetweenRings", () => {
	it("builds one closed ring from upper then reversed lower, first point repeated", () => {
		const rings = fillBetweenRings([0, 1], [1, 2], [0, 0]);
		expect(rings).toEqual([
			[
				{ x: 0, y: 1 },
				{ x: 1, y: 2 },
				{ x: 1, y: 0 },
				{ x: 0, y: 0 },
				{ x: 0, y: 1 },
			],
		]);
	});

	it("splits into separate rings at a gap in any series", () => {
		const rings = fillBetweenRings(
			[0, 1, 2, 3],
			[1, Number.NaN, 3, 4],
			[0, 0, 0, 0],
		);
		expect(rings).toHaveLength(1);
		expect(rings[0][0]).toEqual({ x: 2, y: 3 });
	});

	it("drops a run left with a single point", () => {
		expect(fillBetweenRings([0], [1], [0])).toEqual([]);
	});
});
