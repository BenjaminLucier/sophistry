/**
 * `numberPlane` and `complexPlane`: grid spacing follows the same step as the
 * axes' ticks (`axis.step` / `xAxis.step` / `yAxis.step` override the step in
 * the range), the grid stands on the ticks on every scale, `{ from, to, t }` ranges cross-fade the grid, and the complex plane's vocabulary.
 */

import { describe, expect, it } from "vitest";
import { Invalidate } from "../scene/context.js";
import { complexCoordsOf, complexPlane } from "./complex-plane.js";
import { coordsOf } from "./coords.js";
import type { NumberPlaneProps } from "./number-plane.js";
import { numberPlane } from "./number-plane.js";
import { mount, theme } from "./test-scene.js";

/** Scene x of every vertical grid line (z -1). */
function gridXs(props: NumberPlaneProps): number[] {
	const scene = mount(numberPlane.create(props));
	return scene
		.segments()
		.filter((l) => l.spec.zIndex === -1 && l.a.x === l.b.x)
		.map((l) => l.a.x)
		.sort((p, q) => p - q);
}

describe("numberPlane descriptor and structure", () => {
	it("is a named composite taking children", () => {
		expect(numberPlane.name).toBe("NumberPlane");
		expect(numberPlane.container).toBe(true);
		expect(numberPlane.descriptor.gridOpacity.default).toBe(0.45);
		expect(numberPlane.descriptor.gridZIndex.invalidates).toBe(
			Invalidate.UPDATE,
		);
	});

	it("is the grid (minor x, minor y, major x, major y: one batch each), then the axes, then the children", () => {
		const node = numberPlane.create({
			xRange: [-1, 1, 1],
			yRange: [-1, 1, 1],
			width: 2,
			height: 2,
			minorGridLineCount: 1,
		});
		mount(node);
		const types = node.children.map((c) => c.type);
		// Four grid families (2 + 2 minors, 3 + 3 majors), a node each.
		expect(types.slice(0, 4)).toEqual(Array(4).fill("Instances"));
		expect(types.slice(4)).toEqual(["NumberLine", "NumberLine"]);
	});

	it("draws each grid line as a `line` node would", () => {
		const props: NumberPlaneProps = {
			xRange: [-1, 1, 1],
			yRange: [-1, 1, 1],
			width: 2,
			height: 2,
		};
		const scene = mount(numberPlane.create(props));
		const grid = scene.shapes().filter((s) => s.zIndex === -1);
		// 3 vertical and 3 horizontal majors, each a two-point stroke across
		// the area at the grid's width, colour and opacity.
		expect(grid).toHaveLength(6);
		const verticals = grid.filter(
			(s) => s.polylines[0]?.[0]?.x === s.polylines[0]?.[1]?.x,
		);
		expect(verticals).toHaveLength(3);
		for (const shape of grid) {
			expect(shape.closed).toBe(false);
			expect(shape.style.stroke).toBe(theme.palette.grid);
			expect(shape.style.strokeWidth).toBe(0.02);
			expect(shape.style.opacity).toBeCloseTo(0.45);
			expect(shape.progress).toBe(1);
		}
		const spans = verticals.map((s) => [
			s.polylines[0]?.[0]?.y,
			s.polylines[0]?.[1]?.y,
		]);
		for (const [from, to] of spans) {
			expect(from).toBeCloseTo(-1);
			expect(to).toBeCloseTo(1);
		}
	});

	it("writes no numbers unless asked", () => {
		const base: NumberPlaneProps = {
			xRange: [-2, 2, 1],
			yRange: [-1, 1, 1],
			width: 4,
			height: 2,
		};
		expect(mount(numberPlane.create({ ...base })).texts()).toHaveLength(0);
		expect(
			mount(numberPlane.create({ ...base, axis: { numbers: true } })).texts()
				.length,
		).toBeGreaterThan(0);
	});

	it("draws no grid with `grid: false`, and moves it on a range change", () => {
		const node = numberPlane.create({
			xRange: [-2, 2, 1],
			yRange: [-1, 1, 1],
			width: 4,
			height: 2,
		});
		const scene = mount(node);
		const grid = () => scene.shapes().filter((s) => s.zIndex === -1);
		expect(grid()).toHaveLength(5 + 3);
		node.set("xRange", [-4, 4, 1]);
		scene.commit();
		expect(grid()).toHaveLength(9 + 3);
		node.set("grid", false);
		scene.commit();
		expect(grid()).toHaveLength(0);
	});
});

describe("numberPlane grid step", () => {
	const base: NumberPlaneProps = {
		xRange: [-4, 4, 1],
		yRange: [-2, 2, 1],
		width: 8,
		height: 4,
	};

	it("uses the step in xRange by default", () => {
		expect(gridXs({ ...base })).toHaveLength(9);
	});

	it("axis.step overrides the range step", () => {
		expect(gridXs({ ...base, axis: { step: 2 } })).toHaveLength(5);
	});

	it("xAxis.step wins over axis.step", () => {
		expect(
			gridXs({ ...base, axis: { step: 2 }, xAxis: { step: 4 } }),
		).toHaveLength(3);
	});
});

/** Scene x of every vertical segment: the grid's (z -1) or the x axis's tick marks (short, at the axes' z). */
function verticals(props: NumberPlaneProps): {
	grid: number[];
	ticks: number[];
} {
	const scene = mount(numberPlane.create(props));
	const grid: number[] = [];
	const ticks: number[] = [];
	for (const spec of scene.shapes()) {
		for (const line of spec.polylines) {
			const [a, b] = line;
			if (!a || !b || line.length !== 2 || a.x !== b.x) continue;
			if (spec.zIndex === -1) grid.push(a.x);
			else if (Math.abs(a.y - b.y) < 1) ticks.push(a.x);
		}
	}
	const sort = (values: number[]) => values.sort((p, q) => p - q);
	return { grid: sort(grid), ticks: sort(ticks) };
}

describe("numberPlane grid on every scale", () => {
	const cases: [
		string,
		NumberPlaneProps["xRange"],
		"log" | "sqrt" | "symlog" | "utc",
	][] = [
		["log", [1, 1000], "log"],
		["sqrt", [0, 100], "sqrt"],
		["symlog", [-100, 100], "symlog"],
		["utc", [Date.UTC(2024, 0, 1), Date.UTC(2024, 6, 1)], "utc"],
	];
	for (const [name, xRange, scale] of cases) {
		it(`stands its ${name} grid on the x axis's ticks`, () => {
			const { grid, ticks } = verticals({
				xRange,
				yRange: [-2, 2, 1],
				width: 8,
				height: 4,
				xAxis: { scale, minorTickCount: 0 },
			});
			expect(grid.length).toBeGreaterThan(2);
			expect(grid).toHaveLength(ticks.length);
			grid.forEach((x, i) => {
				expect(x).toBeCloseTo(ticks[i] as number, 9);
			});
		});
	}
});

describe("range transitions on numberPlane", () => {
	it("cross-fades the grid by value", () => {
		const scene = mount(
			numberPlane.create({
				xRange: { from: [-4, 4, 1], to: [-8, 8, 2], t: 0.5 },
				yRange: [-2, 2, 1],
				width: 8,
				height: 4,
			}),
		);
		const vertical = scene
			.segments()
			.filter((l) => l.spec.zIndex === -1 && l.a.x === l.b.x);
		const opacities = vertical.map((l) => l.spec.style.opacity ?? 1);
		// Lines on both ends (even values) at full strength, the old end's
		// odd ones half faded.
		expect(Math.max(...opacities)).toBeCloseTo(0.45);
		expect(Math.min(...opacities)).toBeCloseTo(0.45 * 0.5);
	});
});

describe("complexPlane", () => {
	it("labels the imaginary axis in units of i and speaks { re, im }", () => {
		const node = complexPlane.create({
			xRange: [-2, 2, 1],
			yRange: [-2, 2, 1],
			width: 4,
			height: 4,
			axis: { numbers: true },
		});
		const scene = mount(node);
		const texts = scene.texts().map((t) => t.text);
		expect(texts).toContain("i");
		expect(texts).toContain("-2i");
		const coords = complexCoordsOf(node);
		expect(coords?.numberToPoint({ re: 1, im: -1 })).toEqual({ x: 1, y: -1 });
		expect(coords?.pointToNumber({ x: 2, y: 1 })).toEqual({ re: 2, im: 1 });
		expect(coordsOf(node)).toBe(coords);
	});

	it("writes plain numbers with labelImaginaryUnit: false", () => {
		const scene = mount(
			complexPlane.create({
				xRange: [-2, 2, 1],
				yRange: [-2, 2, 1],
				width: 4,
				height: 4,
				axis: { numbers: true },
				labelImaginaryUnit: false,
			}),
		);
		expect(scene.texts().map((t) => t.text)).not.toContain("i");
	});
});
