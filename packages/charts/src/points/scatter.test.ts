import type { CoordinateSystem } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { chart, chartHandle } from "../chart";
import { mount, probe } from "../test-harness";
import { scatter } from "./scatter";

/** Item centres of a circle marks spec, as points. */
function centres(spec: { centers: Float64Array; count: number }) {
	return Array.from({ length: spec.count }, (_, i) => ({
		x: spec.centers[2 * i] as number,
		y: spec.centers[2 * i + 1] as number,
	}));
}

describe("scatter in a chart", () => {
	const rows = [
		{ x: 1, y: 2 },
		{ x: 2, y: 5 },
		{ x: 4, y: 3 },
	];

	it("fits the axes to the data and draws one marks node", () => {
		const { node: watcher, seen } = probe();
		const plot = chart.create({
			width: 8,
			height: 4,
			children: [scatter.create({ data: rows, x: "x", y: "y" }), watcher],
		});
		const { marks } = mount(plot);
		const coords = seen.coords as CoordinateSystem;
		expect(coords.xRange()[0]).toBeLessThanOrEqual(1);
		expect(coords.xRange()[1]).toBeGreaterThanOrEqual(4);
		expect(coords.yRange()[1]).toBeGreaterThanOrEqual(5);
		const layers = marks();
		expect(layers).toHaveLength(1);
		const spec = layers[0] as unknown as {
			centers: Float64Array;
			count: number;
		};
		expect(spec.count).toBe(3);
		const expected = rows.map((r) => coords.coordsToPoint(r.x, r.y));
		centres(spec).forEach((p, i) => {
			expect(p.x).toBeCloseTo((expected[i] as { x: number }).x, 9);
			expect(p.y).toBeCloseTo((expected[i] as { y: number }).y, 9);
		});
		expect(chartHandle(plot)?.coords).toBe(coords);
	});

	it("blends keyed data by `blend`: matched markers move halfway in data units", () => {
		const before = [
			{ id: "a", x: 0, y: 0 },
			{ id: "b", x: 10, y: 10 },
		];
		const after = [
			{ id: "a", x: 10, y: 0 },
			{ id: "b", x: 0, y: 10 },
		];
		const { node: watcher, seen } = probe();
		const dots = scatter.create({
			data: before,
			to: after,
			blend: 0.5,
			staging: "together",
			key: "id",
			x: "x",
			y: "y",
		});
		const plot = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 10],
			yRange: [0, 10],
			children: [dots, watcher],
		});
		const { marks } = mount(plot);
		const coords = seen.coords as CoordinateSystem;
		const spec = marks()[0] as unknown as {
			centers: Float64Array;
			count: number;
		};
		const [a, b] = centres(spec);
		const expectA = coords.coordsToPoint(5, 0);
		const expectB = coords.coordsToPoint(5, 10);
		expect(a?.x).toBeCloseTo(expectA.x, 9);
		expect(b?.x).toBeCloseTo(expectB.x, 9);
	});

	it("tweens markers to new data through the instance bank with `transition`", () => {
		const dots = scatter.create({
			data: [{ id: "a", x: 0, y: 0 }],
			key: "id",
			x: "x",
			y: "y",
			transition: { duration: 1, easing: "linear" },
		});
		const plot = chart.create({
			width: 10,
			height: 10,
			xRange: [0, 10],
			yRange: [0, 10],
			children: [dots],
		});
		const scene = mount(plot);
		const at = () =>
			centres(
				scene.marks()[0] as unknown as { centers: Float64Array; count: number },
			)[0];
		const start = at();
		dots.set("data", [{ id: "a", x: 10, y: 0 }]);
		scene.commit();
		scene.advance(0.5);
		const middle = at();
		scene.advance(0.6);
		const end = at();
		expect(middle?.x).toBeGreaterThan((start?.x ?? 0) + 1);
		expect(middle?.x).toBeLessThan((end?.x ?? 0) - 1);
		expect((end?.x ?? 0) - (start?.x ?? 0)).toBeCloseTo(10, 6);
	});

	it("traces markers with the chart's progress after the frame's half", () => {
		const dots = scatter.create({ data: [1, 2, 3], radius: 0.2 });
		const plot = chart.create({
			width: 8,
			height: 4,
			progress: 0.5,
			children: [dots],
		});
		const scene = mount(plot);
		const layer = () =>
			scene.marks()[0] as unknown as {
				shape: { kind: string };
				extents: Float64Array;
				count: number;
				progresses?: Float32Array | null;
			};
		// Each marker traces its own outline:
		// nothing drawn yet, the radius whole.
		expect(layer().shape.kind).toBe("outline");
		expect(Array.from(layer().progresses ?? [])).toEqual([0, 0, 0]);
		plot.set("progress", 0.75);
		scene.commit();
		expect(Array.from(layer().progresses ?? [])).toEqual([0.5, 0.5, 0.5]);
		plot.set("progress", 1);
		scene.commit();
		expect(layer().shape.kind).toBe("circle");
		expect(layer().progresses ?? null).toBeNull();
		const radii = Array.from(layer().extents.slice(0, layer().count));
		expect(radii.every((r) => Math.abs(r - 0.2) < 1e-9)).toBe(true);
	});

	it("withdraws its report when removed, and the chart refits", () => {
		const { node: watcher, seen } = probe();
		const big = scatter.create({ data: [{ x: 100, y: 100 }], x: "x", y: "y" });
		const small = scatter.create({ data: [{ x: 1, y: 1 }], x: "x", y: "y" });
		const plot = chart.create({
			width: 8,
			height: 4,
			children: [small, big, watcher],
		});
		const scene = mount(plot);
		expect(
			(seen.coords as CoordinateSystem).xRange()[1],
		).toBeGreaterThanOrEqual(100);
		plot.set("children", [small, watcher]);
		scene.commit();
		expect(big.disposed).toBe(true);
		expect((seen.coords as CoordinateSystem).xRange()[1]).toBeLessThan(100);
	});
});
