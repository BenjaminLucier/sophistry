/**
 * The data API through a chart: `data` plus channels (a key of the datum or
 * a function), with `number[]` data needing none. The layers sit in a chart with fixed ranges, and positions are
 * compared through its coordinates (`barChart`'s cases are in
 * `bars/bar-chart.test.ts`, `pieChart`'s in `radial/pie-chart.test.ts`,
 * scatter's placement in `points/scatter-batched.test.ts`).
 */

import type { SceneNode } from "@sophistry/core";
import { linearGradient } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import type { ChartHandle } from "../chart";
import { chart, chartHandle } from "../chart";
import { stackPlot } from "../curves/stack-plot";
import { scatter } from "../points/scatter";
import { stem } from "../points/stem";
import { markItems, mount } from "../test-harness";

/** A 10 × 10 chart over [0, 10]², mounted, with its handle. */
function plot(...children: SceneNode[]) {
	const node = chart.create({
		width: 10,
		height: 10,
		xRange: [0, 10],
		yRange: [0, 10],
		children,
	});
	const view = mount(node);
	return Object.assign(view, { handle: chartHandle(node) as ChartHandle });
}

/** The specs drawn by `node` or a node under it (the chart's axes left out). */
function specsOf<S extends { id: number }>(
	frame: readonly S[],
	node: SceneNode,
): S[] {
	const ids = new Set<number>();
	const walk = (own: SceneNode) => {
		ids.add(own.id);
		for (const child of (own as { children?: readonly SceneNode[] }).children ??
			[])
			walk(child);
	};
	walk(node);
	return frame.filter((spec) => ids.has(spec.id));
}

describe("scatter data API", () => {
	it("takes a function radius and a function colour", () => {
		const layer = scatter.create({
			data: [{ v: 1 }, { v: 2 }],
			x: (_: unknown, i: number) => i,
			y: "v",
			radius: (d: { v: number }) => d.v / 10,
			color: (d: { v: number }) => (d.v > 1 ? "#0000ff" : "#ff0000"),
		});
		const view = plot(layer);
		const items = specsOf(view.marks(), layer).flatMap((s) => markItems(s));
		expect(items).toHaveLength(2);
		expect((items[1]?.radius ?? 0) / (items[0]?.radius ?? 1)).toBeCloseTo(2, 1);
		expect(items.map((item) => item.fill)).toEqual(["#ff0000", "#0000ff"]);
	});
});

describe("stackPlot data API", () => {
	it("stacks one band per y channel, mixing keys and functions", () => {
		const layer = stackPlot.create({
			data: [
				{ t: 0, a: 1, b: 2 },
				{ t: 1, a: 2, b: 2 },
			],
			x: "t",
			y: ["a", (d: { b: number }) => d.b],
		});
		const view = plot(layer);
		const bands = specsOf(view.marks(), layer).flatMap((s) => markItems(s));
		expect(bands).toHaveLength(2);
	});
});

describe("stem colour", () => {
	it("passes a gradient stroke through; color wins when set", () => {
		const gradient = linearGradient(["red", "blue"]);
		const strokes = (props: object) => {
			const layer = stem.create({ data: [1, 2], stroke: gradient, ...props });
			const view = plot(layer);
			return [
				...specsOf(view.shapes(), layer).map((s) => s.style.stroke),
				...specsOf(view.marks(), layer).flatMap((s) => [
					s.style.stroke,
					...markItems(s).flatMap((item) => [item.stroke, item.fill]),
				]),
			];
		};
		expect(strokes({}).some((s) => typeof s === "object" && s !== null)).toBe(
			true,
		);
		expect(strokes({ color: "#00ff00" })).toContain("#00ff00");
	});
});
