import { describe, expect, it } from "vitest";
import { errorBarPoints } from "./errorbar.js";

describe("errorBarPoints", () => {
	it("builds symmetric yerr bars", () => {
		const points = errorBarPoints([1, 2], [10, 20], [1, 2]);
		expect(points).toEqual([
			{
				index: 0,
				point: { x: 1, y: 10 },
				yBar: [
					{ x: 1, y: 9 },
					{ x: 1, y: 11 },
				],
			},
			{
				index: 1,
				point: { x: 2, y: 20 },
				yBar: [
					{ x: 2, y: 18 },
					{ x: 2, y: 22 },
				],
			},
		]);
	});

	it("builds asymmetric [lower[], upper[]] yerr bars", () => {
		const points = errorBarPoints([1], [10], [
			[1, 2],
			[3, 4],
		] as const);
		expect(points).toEqual([
			{
				index: 0,
				point: { x: 1, y: 10 },
				yBar: [
					{ x: 1, y: 9 },
					{ x: 1, y: 13 },
				],
			},
		]);
	});

	it("builds xerr-only bars", () => {
		const points = errorBarPoints([5], [7], undefined, [0.5]);
		expect(points).toEqual([
			{
				index: 0,
				point: { x: 5, y: 7 },
				xBar: [
					{ x: 4.5, y: 7 },
					{ x: 5.5, y: 7 },
				],
			},
		]);
	});

	it("builds both xerr and yerr bars together", () => {
		const points = errorBarPoints([5], [7], [1], [0.5]);
		expect(points).toEqual([
			{
				index: 0,
				point: { x: 5, y: 7 },
				yBar: [
					{ x: 5, y: 6 },
					{ x: 5, y: 8 },
				],
				xBar: [
					{ x: 4.5, y: 7 },
					{ x: 5.5, y: 7 },
				],
			},
		]);
	});

	it("omits the yBar for a non-finite entry but keeps the point", () => {
		const points = errorBarPoints([1, 2], [10, 20], [1, Number.NaN]);
		expect(points).toEqual([
			{
				index: 0,
				point: { x: 1, y: 10 },
				yBar: [
					{ x: 1, y: 9 },
					{ x: 1, y: 11 },
				],
			},
			{
				index: 1,
				point: { x: 2, y: 20 },
			},
		]);
	});

	it("drops a non-finite (x, y) pair entirely, preserving index on subsequent points", () => {
		const points = errorBarPoints([1, Number.NaN, 3], [10, 20, 30], [1, 2, 3]);
		expect(points).toEqual([
			{
				index: 0,
				point: { x: 1, y: 10 },
				yBar: [
					{ x: 1, y: 9 },
					{ x: 1, y: 11 },
				],
			},
			{
				index: 2,
				point: { x: 3, y: 30 },
				yBar: [
					{ x: 3, y: 27 },
					{ x: 3, y: 33 },
				],
			},
		]);
	});

	it("leaves both bars undefined when no error args are given", () => {
		const points = errorBarPoints([1, 2], [10, 20]);
		expect(points).toEqual([
			{ index: 0, point: { x: 1, y: 10 } },
			{ index: 1, point: { x: 2, y: 20 } },
		]);
	});
});
