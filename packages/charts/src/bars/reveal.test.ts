/**
 * Reveal semantics of the bar-like marks:
 * they grow out of zero, and fade when the axis has none.
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import { mount } from "../test-harness.js";
import { bars } from "./bars.js";
import { histogram } from "./histogram.js";
import { boxes, drawnBoxes, specsOf } from "./test-helpers.js";

/** An 8 × 4 chart with no axes drawn around `layer`. */
function frame(
	props: Omit<ChartProps, "width" | "height" | "children">,
	layer: SceneNode,
) {
	const plot = chart.create({
		width: 8,
		height: 4,
		axis: { visible: false },
		...props,
		children: [layer],
	});
	const scene = mount(plot);
	const handle = chartHandle(plot) as ChartHandle;
	return {
		marks: () => specsOf(scene.marks(), layer),
		y: (value: number) => handle.coords.coordsToPoint(0, value).y,
	};
}

describe("bar-like marks grow from zero", () => {
	it("histogram bars grow out of the baseline", () => {
		const { marks, y } = frame(
			{ xRange: [0, 2], yRange: [0, 4] },
			histogram.create({
				data: [0.5, 0.5, 1.5, 1.5, 1.5, 1.5],
				binCount: 2,
				range: [0, 2],
				progress: 0.5,
			}),
		);
		const [left, right] = drawnBoxes(marks());
		expect(left?.minY).toBeCloseTo(y(0));
		expect(left?.maxY).toBeCloseTo(y(1));
		expect(right?.maxY).toBeCloseTo(y(2));
	});

	it("histogram stagger grows the bins left to right", () => {
		const { marks, y } = frame(
			{ xRange: [0, 3], yRange: [0, 2] },
			histogram.create({
				data: [0.5, 1.5, 2.5],
				binCount: 3,
				range: [0, 3],
				progress: 0.5,
				stagger: 0.5,
			}),
		);
		const heights = boxes(marks()).map((b) => b.maxY - b.minY);
		const full = y(1) - y(0);
		expect(heights[0]).toBeCloseTo(full);
		expect(heights[1]).toBeCloseTo(full * 0.5);
		// The last bin has not started: it is left out of the batch.
		expect(heights[2] ?? 0).toBeCloseTo(0);
	});

	it("fades in at full height when the y range has no zero", () => {
		const { marks, y } = frame(
			{ xRange: [0, 1], yRange: [1, 4] },
			histogram.create({
				data: [0.5, 0.5, 0.5],
				binCount: 1,
				range: [0, 1],
				progress: 0.5,
			}),
		);
		const [bar] = drawnBoxes(marks());
		expect(bar?.maxY).toBeCloseTo(y(3));
		expect(bar?.opacity).toBeCloseTo(0.5);
	});

	it("bars fade rather than grow from the edge of a truncated axis", () => {
		const { marks, y } = frame(
			{ xAxis: { categories: [0] }, yRange: [5, 10] },
			bars.create({ data: [8], progress: 0.5 }),
		);
		const [bar] = drawnBoxes(marks());
		expect(bar?.maxY).toBeCloseTo(y(8));
		expect(bar?.opacity).toBeCloseTo(0.5);
	});
});
