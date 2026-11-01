import { describe, expect, it } from "vitest";
import { quiverVectors } from "./quiver3d.js";

describe("quiverVectors", () => {
	it("builds an origin/vector pair per index, scaled by 1 by default", () => {
		const vectors = quiverVectors([0], [0], [0], [1], [2], [3]);
		expect(vectors).toEqual([
			{
				index: 0,
				origin: { x: 0, y: 0, z: 0 },
				vector: { x: 1, y: 2, z: 3 },
			},
		]);
	});

	it("applies options.scale to (u, v, w)", () => {
		const vectors = quiverVectors([0], [0], [0], [1], [2], [3], { scale: 2 });
		expect(vectors[0].vector).toEqual({ x: 2, y: 4, z: 6 });
	});

	it("truncates to the shortest of the six arrays", () => {
		const vectors = quiverVectors(
			[0, 1, 2],
			[0, 1],
			[0, 1, 2],
			[1, 1, 1],
			[1, 1, 1],
			[1, 1, 1],
		);
		expect(vectors).toHaveLength(2);
	});

	it("drops an entry with a non-finite origin or vector component", () => {
		const vectors = quiverVectors(
			[0, Number.NaN],
			[0, 0],
			[0, 0],
			[1, 1],
			[1, 1],
			[1, Number.POSITIVE_INFINITY],
		);
		expect(vectors).toHaveLength(1);
		expect(vectors[0].index).toBe(0);
	});
});
