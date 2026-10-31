/**
 * The bar family as configurations of one mark: grouped bars (`dodge` +
 * `subband`), stacked, normalized and diverging bars (`stack` + `base`/`value`
 * + `reveal="stack"`). StackPlot's offsets live with the curves family.
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart";
import { chart, chartHandle } from "../chart";
import { mount } from "../test-harness";
import { bars } from "./bars";
import { drawnBoxes } from "./test-helpers";
import { dodge, stack } from "./transforms";

/** An 8 × 4 chart with no axes drawn. */
function frame(
	props: Omit<ChartProps, "width" | "height" | "children">,
	children: SceneNode[],
) {
	return chart.create({
		width: 8,
		height: 4,
		axis: { visible: false },
		...props,
		children,
	});
}

const drawn = drawnBoxes;

const sales = [
	{ quarter: "Q1", region: "north", units: 3 },
	{ quarter: "Q1", region: "south", units: 5 },
	{ quarter: "Q2", region: "north", units: 4 },
	{ quarter: "Q2", region: "south", units: 2 },
];

describe("grouped bars", () => {
	it("each series takes its sub-band of the category's band", () => {
		const rows = dodge(sales, {
			x: "quarter",
			y: "units",
			z: "region",
			padding: 0,
		});
		const plot = frame({ xAxis: { padding: 0 } }, [
			bars.create({
				data: rows,
				category: "x",
				value: "y",
				subband: "subband",
			}),
		]);
		const scene = mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		const x = (v: number) => handle.coords.coordsToPoint(v, 0).x;
		const y = (v: number) => handle.coords.coordsToPoint(0, v).y;
		const boxes = drawn(scene.marks());
		expect(handle.xBand?.domain).toEqual(["Q1", "Q2"]);
		expect(boxes[0]?.minX).toBeCloseTo(x(0));
		expect(boxes[0]?.maxX).toBeCloseTo(x(0.5));
		expect(boxes[1]?.minX).toBeCloseTo(x(0.5));
		expect(boxes[1]?.maxX).toBeCloseTo(x(1));
		expect(boxes[3]?.maxY).toBeCloseTo(y(2));
	});
});

describe("stacked bars", () => {
	const stacked = stack(sales, { x: "quarter", y: "units", z: "region" });

	it("draw each segment from y1 to y2, with zero in view", () => {
		const plot = frame({}, [
			bars.create({
				data: stacked,
				category: "x",
				base: "y1",
				value: "y2",
				reveal: "stack",
			}),
		]);
		const scene = mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		const y = (v: number) => handle.coords.coordsToPoint(0, v).y;
		const [north, south] = drawn(scene.marks());
		expect(north?.minY).toBeCloseTo(y(0));
		expect(north?.maxY).toBeCloseTo(y(3));
		expect(south?.minY).toBeCloseTo(y(3));
		expect(south?.maxY).toBeCloseTo(y(8));
		expect(handle.coords.yRange()[0]).toBeLessThanOrEqual(0);
	});

	it('reveal="stack" scales the whole stack about zero, so segments stay joined', () => {
		const plot = frame({ yRange: [0, 10] }, [
			bars.create({
				data: stacked,
				category: "x",
				base: "y1",
				value: "y2",
				reveal: "stack",
				progress: 0.5,
			}),
		]);
		const scene = mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		const y = (v: number) => handle.coords.coordsToPoint(0, v).y;
		const [north, south] = drawn(scene.marks());
		expect(north?.minY).toBeCloseTo(y(0));
		expect(north?.maxY).toBeCloseTo(y(1.5));
		expect(south?.minY).toBeCloseTo(y(1.5));
		expect(south?.maxY).toBeCloseTo(y(4));
	});

	it('the default "grow" still grows a floating bar from its own base', () => {
		const plot = frame({ yRange: [0, 10] }, [
			bars.create({
				data: stacked.slice(0, 2),
				category: "x",
				base: "y1",
				value: "y2",
				progress: 0.5,
			}),
		]);
		const scene = mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		const y = (v: number) => handle.coords.coordsToPoint(0, v).y;
		const south = drawn(scene.marks())[1];
		expect(south?.minY).toBeCloseTo(y(3));
		expect(south?.maxY).toBeCloseTo(y(5.5));
	});

	it("diverging values stack below zero; normalized ones fill 0..1", () => {
		const likert = [
			{ q: "A", answer: "disagree", n: -3 },
			{ q: "A", answer: "agree", n: 5 },
		];
		const plot = frame({}, [
			bars.create({
				data: stack(likert, { x: "q", y: "n", z: "answer" }),
				category: "x",
				base: "y1",
				value: "y2",
				orientation: "horizontal",
			}),
		]);
		const scene = mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		const x = (v: number) => handle.coords.coordsToPoint(v, 0).x;
		const [disagree, agree] = drawn(scene.marks());
		expect(disagree?.minX).toBeCloseTo(x(-3));
		expect(disagree?.maxX).toBeCloseTo(x(0));
		expect(agree?.minX).toBeCloseTo(x(0));
		expect(agree?.maxX).toBeCloseTo(x(5));

		const normalized = stack(sales, {
			x: "quarter",
			y: "units",
			z: "region",
			offset: "normalize",
		});
		expect(normalized.map((r) => r.y2)).toEqual([3 / 8, 1, 4 / 6, 1]);
	});

	it('reveal="fade" keeps full length and fades', () => {
		const plot = frame({ yRange: [0, 10] }, [
			bars.create({ data: [4], reveal: "fade", progress: 0.5 }),
		]);
		const scene = mount(plot);
		const handle = chartHandle(plot) as ChartHandle;
		const y = (v: number) => handle.coords.coordsToPoint(0, v).y;
		const [bar] = drawn(scene.marks());
		expect(bar?.maxY).toBeCloseTo(y(4));
		expect(bar?.opacity).toBeCloseTo(0.5);
	});
});
