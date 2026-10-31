import { describe, expect, it } from "vitest";
import { eventPlotRows } from "./eventplot";

describe("eventPlotRows", () => {
	it("makes one row per input row, with distinct event counts", () => {
		const result = eventPlotRows([[0, 1, 2], [5]]);
		expect(result).toHaveLength(2);
		expect(result[0].row).toBe(0);
		expect(result[0].ticks).toHaveLength(3);
		expect(result[1].row).toBe(1);
		expect(result[1].ticks).toHaveLength(1);
	});

	it("spans each tick by lineLength around the row's y", () => {
		const result = eventPlotRows([[3]], { lineOffset: 1, lineLength: 0.8 });
		expect(result[0].ticks[0]).toEqual([
			{ x: 3, y: -0.4 },
			{ x: 3, y: 0.4 },
		]);
	});

	it("scales the y span with lineLength", () => {
		const result = eventPlotRows([[3]], { lineOffset: 1, lineLength: 2 });
		expect(result[0].ticks[0]).toEqual([
			{ x: 3, y: -1 },
			{ x: 3, y: 1 },
		]);
	});

	it("spaces rows apart by lineOffset", () => {
		const result = eventPlotRows([[0], [0], [0]], {
			lineOffset: 2,
			lineLength: 0.8,
		});
		expect(result[0].ticks[0]).toEqual([
			{ x: 0, y: -0.4 },
			{ x: 0, y: 0.4 },
		]);
		expect(result[1].ticks[0]).toEqual([
			{ x: 0, y: 1.6 },
			{ x: 0, y: 2.4 },
		]);
		expect(result[2].ticks[0]).toEqual([
			{ x: 0, y: 3.6 },
			{ x: 0, y: 4.4 },
		]);
	});

	it("drops non-finite times within a row", () => {
		const result = eventPlotRows([
			[0, Number.NaN, 2, Number.POSITIVE_INFINITY, 4],
		]);
		expect(result[0].ticks).toHaveLength(3);
	});

	it("keeps an empty row with ticks: []", () => {
		const result = eventPlotRows([[1, 2], []]);
		expect(result).toHaveLength(2);
		expect(result[1]).toEqual({ row: 1, ticks: [] });
	});

	it("returns [] for an empty rows array", () => {
		expect(eventPlotRows([])).toEqual([]);
	});
});
