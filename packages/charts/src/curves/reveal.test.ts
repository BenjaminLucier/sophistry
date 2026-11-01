/**
 * Lines and areas reveal along x: a line is cut at the front, an area is
 * whole behind a clip at the front, a stack grows from its baseline (or
 * sweeps behind one clip), and `reveal: "length"` draws by arc length.
 *
 * A `"length"` reveal is carried by each path batch item as its own
 * `progress`, over the whole outline.
 */

import type { SceneNode } from "@sophistry/core";
import { clipBounds } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import { mount } from "../test-harness.js";
import { fillBetween } from "./fill-between.js";
import { linePlot } from "./line-plot.js";
import { stackPlot } from "./stack-plot.js";
import { stairs } from "./stairs.js";
import type { CurveItem } from "./test-items.js";
import { curveItems } from "./test-items.js";

let handle!: ChartHandle;
function draw(
	layers: SceneNode[],
	props: Partial<ChartProps> = {},
): CurveItem[] {
	const plot = chart.create({
		width: 8,
		height: 4,
		axis: { visible: false },
		...props,
		children: layers,
	});
	const scene = mount(plot);
	handle = chartHandle(plot) as ChartHandle;
	return curveItems(scene.marks()).filter(
		(item) => item.points.length > 0 && item.opacity > 0,
	);
}
const x = (value: number) => handle.coords.coordsToPoint(value, 0).x;
const y = (value: number) => handle.coords.coordsToPoint(0, value).y;
const boxOf = (item: CurveItem | undefined) => {
	const points = item?.points ?? [];
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
	};
};

describe("lines and areas reveal along x", () => {
	// Busy on the left (most of the arc length), calm on the right.
	const spiky = [0, 9, 0, 9, 0, 1, 1, 1, 1, 1, 1];

	it("a linePlot is cut at the x the reveal has reached", () => {
		const [line] = draw([linePlot.create({ data: spiky, progress: 0.3 })], {
			xRange: [0, 10],
			yRange: [0, 10],
		});
		expect(line?.opacity).toBe(1);
		expect(boxOf(line).maxX).toBeCloseTo(x(3));
		expect(boxOf(line).minX).toBeCloseTo(x(0));
	});

	it('reveal="length" hands each line the reveal as its progress, over the whole line', () => {
		const range = { xRange: [0, 10], yRange: [0, 10] } as Partial<ChartProps>;
		const [whole] = draw(
			[linePlot.create({ data: spiky, reveal: "length" })],
			range,
		);
		const [line] = draw(
			[linePlot.create({ data: spiky, progress: 0.3, reveal: "length" })],
			range,
		);
		expect(whole?.progress).toBe(1);
		expect(line?.progress).toBeCloseTo(0.3, 6);
		expect(line?.opacity).toBe(1);
		// The geometry is the whole line: the renderer traces it.
		expect(line?.points).toEqual(whole?.points);
		expect(boxOf(line).maxX).toBeCloseTo(x(10));
	});

	it("follows the chart's own progress: nothing until the frame has drawn", () => {
		expect(
			draw([linePlot.create({ data: spiky })], {
				xRange: [0, 10],
				yRange: [0, 10],
				progress: 0.5,
			}),
		).toHaveLength(0);
	});

	it("stairs and fillBetween sweep in on the same front", () => {
		const items = draw(
			[
				stairs.create({ data: [1, 3, 2, 4], progress: 0.5 }),
				fillBetween.create({
					data: [
						{ t: 0, v: 2 },
						{ t: 4, v: 3 },
					],
					x: "t",
					y1: "v",
					progress: 0.5,
				}),
			],
			{ xRange: [0, 4], yRange: [0, 5] },
		);
		// The area paints under the axes, so first; the steps are the open line.
		const steps = items.find((item) => !item.closed);
		const area = items.find((item) => item.closed);
		expect(boxOf(steps).maxX).toBeCloseTo(x(2));
		// The area is whole behind a clip front at the same x, so a stroked
		// outline shows no edge along the front.
		expect(boxOf(area).maxX).toBeCloseTo(x(4));
		expect(clipBounds(area?.clip)?.maxX).toBeCloseTo(x(2));
		expect(area?.fillOpacity).toBeCloseTo(0.3);
	});

	it('fillBetween reveal="length" traces the whole region, its fill coming up with it', () => {
		const rows = [
			{ t: 0, v: 2 },
			{ t: 4, v: 3 },
		];
		const range = { xRange: [0, 4], yRange: [0, 5] } as Partial<ChartProps>;
		const props = {
			data: rows,
			x: "t",
			y1: "v",
			reveal: "length",
			stroke: "white",
		} as const;
		const whole = draw([fillBetween.create(props)], range);
		expect(whole).toHaveLength(1);
		const half = draw([fillBetween.create({ ...props, progress: 0.5 })], range);
		expect(half).toHaveLength(1);
		const [region] = half as [CurveItem];
		expect(region.closed).toBe(true);
		expect(region.progress).toBeCloseTo(0.5, 6);
		expect(region.opacity).toBe(1);
		expect(region.clip).toBeUndefined();
		expect(region.points).toEqual(whole[0]?.points);
	});

	it('a stackPlot with reveal="length" traces every whole band to the reveal', () => {
		const data = [
			{ t: 0, a: 2, b: 4 },
			{ t: 4, a: 2, b: 4 },
		];
		const range = { xRange: [0, 4], yRange: [0, 10] } as Partial<ChartProps>;
		const props = { data, x: "t", y: ["a", "b"], reveal: "length" } as const;
		const whole = draw([stackPlot.create(props)], range);
		const half = draw([stackPlot.create({ ...props, progress: 0.4 })], range);
		expect(half).toHaveLength(2);
		half.forEach((band, i) => {
			expect(band.progress).toBeCloseTo(0.4, 6);
			expect(band.clip).toBeUndefined();
			expect(band.points).toEqual(whole[i]?.points);
		});
	});

	it("keeps each outline while only the arc-length reveal moves", () => {
		const line = linePlot.create({
			data: spiky,
			curve: "monotone",
			reveal: "length",
			progress: 0.2,
			zIndex: 7,
		});
		const plot = chart.create({
			width: 8,
			height: 4,
			xRange: [0, 10],
			yRange: [0, 10],
			children: [line],
		});
		const scene = mount(plot);
		const outlineOf = () => {
			const spec = scene.marks().find((mark) => mark.zIndex === 7);
			return spec?.shape.kind === "paths" ? spec.shape.outlines[0] : undefined;
		};
		const before = outlineOf();
		expect(before?.curvePaths).toBeTruthy();
		for (const progress of [0.4, 0.7, 1]) {
			line.set("progress", progress);
			scene.commit();
			expect(outlineOf()).toBe(before);
		}
	});

	it('a stackPlot with reveal="x" advances every band behind one clip', () => {
		const [a, b] = draw(
			[
				stackPlot.create({
					data: [
						{ t: 0, a: 2, b: 4 },
						{ t: 4, a: 2, b: 4 },
					],
					x: "t",
					y: ["a", "b"],
					reveal: "x",
					progress: 0.25,
				}),
			],
			{ xRange: [0, 4], yRange: [0, 10] },
		);
		expect(a?.clip).toBe(b?.clip);
		expect(clipBounds(a?.clip)?.maxX).toBeCloseTo(x(1));
		expect(boxOf(b).maxY).toBeCloseTo(y(6));
	});

	it("a stackPlot grows every band from the baseline together", () => {
		const [a, b] = draw(
			[
				stackPlot.create({
					data: [
						{ t: 0, a: 2, b: 4 },
						{ t: 1, a: 2, b: 4 },
					],
					x: "t",
					y: ["a", "b"],
					progress: 0.5,
				}),
			],
			{ xRange: [0, 1], yRange: [0, 10] },
		).map(boxOf);
		// value × t: the stack of 2 + 4 stands at 3, its first band at 1.
		expect(a?.maxY).toBeCloseTo(y(1));
		expect(b?.minY).toBeCloseTo(y(1));
		expect(b?.maxY).toBeCloseTo(y(3));
		expect((a?.maxX as number) - (a?.minX as number)).toBeCloseTo(x(1) - x(0));
	});
});

describe("stackPlot data API", () => {
	it("stacks one band per y channel, mixing keys and functions", () => {
		const data = [
			{ t: 0, a: 1, b: 2 },
			{ t: 1, a: 2, b: 2 },
		];
		const items = draw([
			stackPlot.create({ data, x: "t", y: ["a", (d: { b: number }) => d.b] }),
		]);
		expect(items).toHaveLength(2);
		expect(boxOf(items[1]).maxY).toBeCloseTo(y(4));
	});
});
