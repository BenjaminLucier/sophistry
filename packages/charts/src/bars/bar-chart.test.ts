/**
 * `barChart`'s data API: `data` plus channels
 * (a key of the datum or a function), with `number[]` data needing none;
 * and its names under the bars.
 */

import { describe, expect, it } from "vitest";
import { mount } from "../test-harness";
import type { BarChartHandle } from "./bar-chart";
import { barChart, barChartHandle } from "./bar-chart";
import { boxes } from "./test-helpers";

const heights = (handle: BarChartHandle) =>
	Array.from({ length: handle.count() }, (_, i) => {
		const box = handle.barBounds(i);
		return box ? box.maxY - box.minY : Number.NaN;
	});

/** Mounts a bar chart and returns its scene and handle. */
function render(props: Parameters<typeof barChart.create>[0]) {
	const node = barChart.create(props);
	const scene = mount(node);
	return {
		scene,
		handle: barChartHandle(node) as BarChartHandle,
		texts: () => scene.texts().map((t) => t.text),
	};
}

describe("barChart data API", () => {
	it("number[] data needs no channels", () => {
		const { handle } = render({
			data: [3, 1, 4],
			width: 6,
			height: 4,
			yRange: [0, 4],
		});
		expect(handle.count()).toBe(3);
		const [a, b, c] = heights(handle) as [number, number, number];
		expect(a / b).toBeCloseTo(3);
		expect(c / b).toBeCloseTo(4);
	});

	it("reads object data through a key and through a function alike", () => {
		const data = [
			{ name: "x", n: 2 },
			{ name: "y", n: 6 },
		];
		const byKey = render({
			data,
			value: "n",
			label: "name",
			width: 4,
			height: 4,
			yRange: [0, 6],
		});
		const byFn = render({
			data,
			value: (d: { n: number }) => d.n,
			width: 4,
			height: 4,
			yRange: [0, 6],
		});
		expect(heights(byKey.handle)).toEqual(heights(byFn.handle));
		const [first, second] = heights(byKey.handle) as [number, number];
		expect(second / first).toBeCloseTo(3);
		expect(byKey.texts()).toContain("x");
		expect(byKey.texts()).toContain("y");
	});

	it("draws no labels without a label channel", () => {
		const { texts } = render({
			data: [1, 2],
			width: 4,
			height: 4,
			yAxis: false,
		});
		expect(texts()).toEqual([]);
	});

	it("yAxis: { visible: false } hides the value axis's numbers too", () => {
		const { texts } = render({
			data: [1, 2],
			width: 4,
			height: 4,
			yAxis: { visible: false, numberFontSize: 0.3 },
		});
		expect(texts()).toEqual([]);
	});

	it("a per-datum colour function overrides the palette cycle", () => {
		const { scene } = render({
			data: [1, 2],
			color: (_: unknown, i: number) => (i === 0 ? "#ff0000" : "#00ff00"),
			width: 4,
			height: 4,
			yAxis: false,
			baseline: false,
		});
		expect(boxes(scene.marks()).map((b) => b.fill)).toEqual([
			"#ff0000",
			"#00ff00",
		]);
	});
});

describe("barChart names", () => {
	it("hang each name under the baseline, and under a negative bar's bottom", () => {
		const { scene, handle } = render({
			data: [
				{ name: "up", n: 2 },
				{ name: "down", n: -2 },
			],
			value: "n",
			label: "name",
			width: 4,
			height: 4,
			yRange: [-3, 3],
			yAxis: false,
		});
		const up = scene.texts().find((t) => t.text === "up");
		const down = scene.texts().find((t) => t.text === "down");
		const zero = handle.coords.coordsToPoint(0, 0).y;
		expect(up?.at.y).toBeLessThan(zero);
		expect(down?.at.y).toBeLessThan(handle.coords.coordsToPoint(0, -2).y);
	});

	it("ride their bars through a keyed sort", () => {
		const data = [
			{ name: "a", n: 1 },
			{ name: "b", n: 3 },
		];
		const sorted = [data[1], data[0]] as typeof data;
		const at = (blend: number) => {
			const { scene } = render({
				data,
				to: sorted,
				blend,
				value: "n",
				label: "name",
				width: 4,
				height: 4,
				yRange: [0, 3],
				yAxis: false,
			});
			const x = (name: string) =>
				scene.texts().find((t) => t.text === name)?.at.x ?? Number.NaN;
			return { a: x("a"), b: x("b") };
		};
		const start = at(0);
		const end = at(1);
		expect(start.a).toBeLessThan(start.b);
		expect(end.a).toBeGreaterThan(end.b);
		expect(end.a).toBeCloseTo(start.b);
	});
});
