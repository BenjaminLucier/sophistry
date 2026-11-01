/**
 * `parallelCoordinates`: one path batch item per datum through every axis,
 * axes first, then the lines left to right; tooltips per item.
 */

import { describe, expect, it } from "vitest";
import { markItems, mount } from "../test-harness.js";
import { parallelCoordinates } from "./parallel-coordinates.js";

const cars = [
	{ mpg: 20, hp: 100, kg: 1200 },
	{ mpg: 30, hp: 80, kg: 1000 },
	{ mpg: 15, hp: Number.NaN, kg: 1600 },
];
const axes = [
	{ value: "mpg", label: "mpg", range: [10, 30] as [number, number] },
	{ value: "hp", label: "hp", range: [80, 120] as [number, number] },
	{ value: "kg", label: "kg", range: [1000, 2000] as [number, number] },
];

describe("parallelCoordinates", () => {
	it("draws one path item per datum through its value on every axis", () => {
		const scene = mount(
			parallelCoordinates.create({
				data: cars,
				axes,
				width: 8,
				height: 4,
			} as never),
		);
		const batch = scene.marks().find((s) => s.shape.kind === "paths");
		expect(batch?.count).toBe(3);
		const items = markItems(batch as never);
		// First datum: mpg 20 is mid-axis at x = -4, hp 100 mid at x = 0.
		const first = items[0]?.polylines[0] ?? [];
		expect(first[0]?.x).toBeCloseTo(-4, 9);
		expect(first[0]?.y).toBeCloseTo(0, 9);
		expect(first[1]?.x).toBeCloseTo(0, 9);
		// The third datum's missing hp breaks its line into two runs.
		expect(items[2]?.polylines).toHaveLength(2);
		const labels = scene.texts().map((t) => t.text);
		for (const name of ["mpg", "hp", "kg"]) expect(labels).toContain(name);
	});

	it("draws the axes first, then the lines", () => {
		const node = parallelCoordinates.create({
			data: cars,
			axes,
			width: 8,
			height: 4,
			progress: 0.3,
		} as never);
		const scene = mount(node);
		expect(scene.marks().find((s) => s.shape.kind === "paths")).toBeUndefined();
		node.set("progress" as never, 0.65 as never);
		scene.commit();
		const batch = scene.marks().find((s) => s.shape.kind === "paths");
		const items = markItems(batch as never);
		// Half each line traced by arc length: the whole outline, revealed
		// half way, the same outline object as at the next frame (the trace's lengths are cached by it).
		const run = items[0]?.polylines[0] ?? [];
		expect(run[0]?.x).toBeCloseTo(-4, 9);
		expect(run[run.length - 1]?.x).toBeCloseTo(4, 9);
		expect(batch?.progresses?.[0]).toBeCloseTo(0.5);
		const outline =
			batch?.shape.kind === "paths" ? batch.shape.outlines[0] : undefined;
		node.set("progress" as never, 0.7 as never);
		scene.commit();
		const next = scene.marks().find((s) => s.shape.kind === "paths");
		expect(
			next?.shape.kind === "paths"
				? next.shape.outlines[0]?.polylines
				: undefined,
		).toBe(outline?.polylines);
	});
});
