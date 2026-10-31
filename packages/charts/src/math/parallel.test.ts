import { describe, expect, it } from "vitest";
import { parallelAxisX, parallelLines } from "./parallel";

describe("parallelAxisX", () => {
	it("spaces axes evenly from 0 to 1", () => {
		expect([0, 1, 2, 3].map((i) => parallelAxisX(i, 4))).toEqual([
			0,
			1 / 3,
			2 / 3,
			1,
		]);
		expect(parallelAxisX(0, 1)).toBe(0.5);
	});
});

describe("parallelLines", () => {
	it("maps each value into its axis's range", () => {
		const [line] = parallelLines(
			[[1, 20, 0.3]],
			[
				[0, 4],
				[0, 20, 5],
				[0, 1],
			],
		);
		expect(line.index).toBe(0);
		expect(line.segments).toEqual([
			[
				{ x: 0, y: 0.25 },
				{ x: 0.5, y: 1 },
				{ x: 1, y: 0.3 },
			],
		]);
	});

	it("is monotone in x", () => {
		const [line] = parallelLines([[3, 1, 4, 1, 5]], Array(5).fill([0, 5]));
		const xs = line.segments[0].map((p) => p.x);
		expect(xs).toEqual([...xs].sort((a, b) => a - b));
	});

	it("breaks the line at a non-finite value", () => {
		const [line] = parallelLines(
			[[1, Number.NaN, 2, 3]],
			Array(4).fill([0, 4]),
		);
		expect(line.segments).toHaveLength(2);
		expect(line.segments[0]).toEqual([{ x: 0, y: 0.25 }]);
		expect(line.segments[1].map((p) => p.y)).toEqual([0.5, 0.75]);
	});

	it("handles short rows, degenerate ranges and values outside the range", () => {
		const lines = parallelLines(
			[[2], [5, 7]],
			[
				[2, 2],
				[0, 4],
			],
		);
		expect(lines[0].segments).toEqual([[{ x: 0, y: 0.5 }]]);
		expect(lines[1].segments[0][1].y).toBeCloseTo(1.75);
		expect(parallelLines([], [[0, 1]])).toEqual([]);
		expect(parallelLines([[1, 2]], [])).toEqual([{ index: 0, segments: [] }]);
	});
});
