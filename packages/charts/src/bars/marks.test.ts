/**
 * The bar family's marks inside a `chart`:
 * rules, and the bar additions (floating bars, value labels, stagger).
 */

import type { SceneNode } from "@sophistry/core";
import type { MarksSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart";
import { chart, chartHandle } from "../chart";
import { markItems, mount } from "../test-harness";
import { bars } from "./bars";
import { ruleX, ruleY } from "./rules";
import { boxes, specsOf } from "./test-helpers";

/** An 8 × 4 chart centred on the origin around `children`. */
function frame(
	props: Omit<ChartProps, "width" | "height" | "children">,
	children: SceneNode[],
) {
	const plot = chart.create({ width: 8, height: 4, ...props, children });
	const scene = mount(plot);
	return { scene, handle: chartHandle(plot) as ChartHandle };
}

/** The boxes of every line item (a rule is a segment), in order. */
function segments(marks: readonly MarksSpec[]) {
	return marks.flatMap((spec) =>
		markItems(spec).map((item) => {
			const points = item.polylines.flat();
			const xs = points.map((p) => p.x);
			const ys = points.map((p) => p.y);
			return {
				minX: Math.min(...xs),
				maxX: Math.max(...xs),
				minY: Math.min(...ys),
				maxY: Math.max(...ys),
			};
		}),
	);
}

describe("ruleX / ruleY", () => {
	it("a rule spans the plotting area unless its ends are given", () => {
		const horizontalRule = ruleY.create({ data: [2] });
		const verticalRule = ruleX.create({ data: [5], y1: () => 1, y2: () => 3 });
		const { scene, handle } = frame(
			{ xRange: [0, 10], yRange: [0, 4], axis: { visible: false } },
			[horizontalRule, verticalRule],
		);
		const [horizontal] = segments(specsOf(scene.marks(), horizontalRule));
		const [vertical] = segments(specsOf(scene.marks(), verticalRule));
		const area = handle.coords.area();
		expect(horizontal?.minX).toBeCloseTo(area.minX);
		expect(horizontal?.maxX).toBeCloseTo(area.maxX);
		expect(horizontal?.minY).toBeCloseTo(handle.coords.coordsToPoint(0, 2).y);
		expect(vertical?.minY).toBeCloseTo(handle.coords.coordsToPoint(0, 1).y);
		expect(vertical?.maxY).toBeCloseTo(handle.coords.coordsToPoint(0, 3).y);
	});

	it("reports its position so the chart fits around it", () => {
		const { handle } = frame({}, [ruleY.create({ data: [-30, 70] })]);
		const [min, max] = handle.coords.yRange();
		expect(min).toBeLessThanOrEqual(-30);
		expect(max).toBeGreaterThanOrEqual(70);
	});

	it("draws out from its low end with `progress`", () => {
		const rule = ruleX.create({
			data: [5],
			y1: () => 0,
			y2: () => 4,
			progress: 0.5,
		});
		const { scene, handle } = frame(
			{ xRange: [0, 10], yRange: [0, 4], axis: { visible: false } },
			[rule],
		);
		// The whole segment, traced half way from its low end.
		const marks = specsOf(scene.marks(), rule);
		const [segment] = segments(marks);
		expect(segment?.minY).toBeCloseTo(handle.coords.coordsToPoint(0, 0).y);
		expect(segment?.maxY).toBeCloseTo(handle.coords.coordsToPoint(0, 4).y);
		const [first] = markItems(marks[0] as MarksSpec)[0]?.polylines ?? [];
		expect(first?.[0]?.y).toBeCloseTo(handle.coords.coordsToPoint(0, 0).y);
		expect(marks[0]?.progresses?.[0]).toBeCloseTo(0.5);
	});
});

describe("bars additions", () => {
	it("floating bars run from base to value and don't force zero", () => {
		const { handle } = frame({}, [
			bars.create({
				data: [
					{ k: "a", from: 40, to: 55 },
					{ k: "b", from: 50, to: 70 },
				],
				category: "k",
				base: "from",
				value: "to",
			}),
		]);
		expect(handle.coords.yRange()[0]).toBeGreaterThan(0);
	});

	it("value labels count up with the bar", () => {
		const layer = bars.create({ data: [8], labels: true });
		const { scene } = frame(
			{
				xAxis: { categories: [0] },
				yRange: [0, 10],
				axis: { numbers: false },
				progress: 0.75,
			},
			[layer],
		);
		// The data half is at 0.5: the label reads half of 8.
		expect(specsOf(scene.texts(), layer).map((t) => t.text)).toContain("4");
	});

	it("stagger grows bars in category order", () => {
		const layer = bars.create({ data: [4, 4, 4], stagger: 0.6 });
		const { scene } = frame(
			{ xAxis: { categories: [0, 1, 2] }, yRange: [0, 4], progress: 0.75 },
			[layer],
		);
		const heights = boxes(specsOf(scene.marks(), layer)).map(
			(b) => b.maxY - b.minY,
		);
		// Halfway through the data phase the last bar has not started: it is
		// not drawn at all (no zero-height outline on the axis).
		expect(heights).toHaveLength(2);
		expect(heights[0]).toBeGreaterThan(heights[1] as number);
	});
});
