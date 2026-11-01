import { describe, expect, it } from "vitest";
import { bar3dSlots } from "./bar3d.js";

describe("bar3dSlots", () => {
	it("anchors each box at (x, y, z) and extends by (width, height, depth)", () => {
		const slots = bar3dSlots([1], [2], [3], 0.5, 0.6, 0.7);
		expect(slots).toEqual([
			{ index: 0, x0: 1, x1: 1.5, y0: 2, y1: 2.6, z0: 3, z1: 3.7 },
		]);
	});

	it("broadcasts a scalar extent to every bar", () => {
		const slots = bar3dSlots([0, 1], [0, 1], [0, 1], 1, 1, 1);
		expect(slots).toHaveLength(2);
		expect(slots[1]).toEqual({
			index: 1,
			x0: 1,
			x1: 2,
			y0: 1,
			y1: 2,
			z0: 1,
			z1: 2,
		});
	});

	it("accepts a per-bar extent array", () => {
		const slots = bar3dSlots([0, 0], [0, 0], [0, 0], [1, 2], 1, 1);
		expect(slots[0].x1).toBe(1);
		expect(slots[1].x1).toBe(2);
	});

	it("sorts a negative extent so the box is never inside out", () => {
		const slots = bar3dSlots([0], [0], [0], -2, 1, 1);
		expect(slots[0].x0).toBe(-2);
		expect(slots[0].x1).toBe(0);
	});

	it("truncates to the shortest of all six arrays", () => {
		const slots = bar3dSlots([0, 1, 2], [0, 1], [0, 1, 2], [1, 1, 1], 1, 1);
		expect(slots).toHaveLength(2);
	});

	it("drops an entry with a non-finite anchor or extent component", () => {
		const slots = bar3dSlots(
			[0, Number.NaN],
			[0, 0],
			[0, 0],
			[1, 1],
			[1, Number.POSITIVE_INFINITY],
			1,
		);
		expect(slots).toHaveLength(1);
		expect(slots[0].index).toBe(0);
	});
});
