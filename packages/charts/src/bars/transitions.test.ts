/**
 * Keyed transitions on `bars`, plus the clock-driven `transition` through the instance tween bank.
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import type { ChartHandle, ChartProps } from "../chart.js";
import { chart, chartHandle } from "../chart.js";
import type { AnyDatum } from "../props.js";
import { mount } from "../test-harness.js";
import type { BarsProps } from "./bars.js";
import { bars } from "./bars.js";
import { boxes, specsOf } from "./test-helpers.js";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

type Scene = ReturnType<typeof mount>;

/** Drawn bars, as rounded boxes, sorted. */
const barBoxes = (scene: Scene, layer?: SceneNode) =>
	boxes(layer ? specsOf(scene.marks(), layer) : scene.marks())
		.filter((b) => b.opacity > 0 && b.maxY - b.minY > 0)
		.map((b) => ({
			minX: rounded(b.minX),
			maxX: rounded(b.maxX),
			minY: rounded(b.minY),
			maxY: rounded(b.maxY),
		}))
		.sort((p, q) => p.minX - q.minX || p.minY - q.minY);
const texts = (scene: Scene) => scene.texts().map((t) => t.text);

/** A 6 × 4 chart around one `bars`. */
function frame(
	barsProps: Partial<BarsProps<AnyDatum>>,
	chartProps: Partial<ChartProps> = {},
) {
	const layer = bars.create(barsProps as BarsProps<AnyDatum>);
	const plot = chart.create({
		width: 6,
		height: 4,
		...chartProps,
		children: [layer],
	});
	const scene = mount(plot);
	return { scene, layer, handle: chartHandle(plot) as ChartHandle };
}

describe("keyed transitions on bars", () => {
	const sales = [
		{ k: "A", v: 3 },
		{ k: "B", v: 5 },
		{ k: "C", v: 2 },
	];
	const next = [
		{ k: "B", v: 6 },
		{ k: "A", v: 1 },
		{ k: "D", v: 4 },
	];
	const at = (
		blend: number | undefined,
		data: typeof sales,
		to: typeof sales | undefined,
	) =>
		frame({
			data,
			to,
			blend,
			category: "k",
			value: "v",
			key: "k",
			labels: true,
		}).scene;

	it("is exactly `data` at blend 0 and exactly `to` at blend 1, categories included", () => {
		const start = at(0, sales, next);
		const plainFrom = at(undefined, sales, undefined);
		expect(barBoxes(start)).toEqual(barBoxes(plainFrom));
		expect(texts(start).sort()).toEqual(texts(plainFrom).sort());
		const end = at(1, sales, next);
		const plainTo = at(undefined, next, undefined);
		expect(barBoxes(end)).toEqual(barBoxes(plainTo));
		expect(texts(end).sort()).toEqual(texts(plainTo).sort());
	});

	// needs frame: `frame.join` staging and the band axis fading its category names
	it("fades a leaving category's name with its bar, and a new one's in", () => {
		const name = (scene: Scene, text: string) =>
			scene.texts().find((s) => s.text === text);
		// Exit, update (with the value axis), enter: a third each.
		const exiting = at(1 / 6, sales, next);
		expect(name(exiting, "C")?.style.opacity).toBeCloseTo(0.5);
		expect(name(exiting, "A")?.style.opacity).toBe(1);
		expect(barBoxes(exiting)).toHaveLength(3);
		const entering = at(5 / 6, sales, next);
		expect(name(entering, "D")?.style.opacity).toBeCloseTo(0.5);
		expect(name(entering, "C")).toBeUndefined();
	});

	// needs frame: `frame.join` staging (the band axis blending its slots across a sort)
	it("sorts: the same bars slide to their new bands during the update", () => {
		const sorted = [...sales].sort((p, q) => q.v - p.v);
		const { scene, handle } = frame({
			data: sales,
			to: sorted,
			blend: 0.5,
			category: "k",
			value: "v",
			key: "k",
		});
		const band = handle.xBand;
		expect(band?.domain).toEqual(["A", "B", "C"]);
		// B moves from slot 1 to slot 0, A from 0 to 1: they meet halfway.
		expect(band?.center("A")).toBeCloseTo(1);
		expect(band?.center("B")).toBeCloseTo(1);
		expect(band?.center("C")).toBeCloseTo(2.5);
		expect(barBoxes(scene)).toHaveLength(3);
	});

	it("grows and shrinks values in place when only values change", () => {
		const taller = sales.map((d) => ({ ...d, v: d.v * 2 }));
		const { scene, handle } = frame(
			{
				data: sales,
				to: taller,
				blend: 0.5,
				category: "k",
				value: "v",
				key: "k",
			},
			{ yRange: [0, 10] },
		);
		const tops = barBoxes(scene).map((b) => b.maxY);
		const expected = sales.map((d) =>
			rounded(handle.coords.coordsToPoint(0, d.v * 1.5).y),
		);
		expect(tops).toEqual(expected);
	});
});

describe("the band axis's slot", () => {
	// needs frame: band axis `slot` and category names (the minimal frame lays bands out in order)
	it("stands categories, their bars and names at the slots it gives", () => {
		const rows = [
			{ k: "A", v: 1 },
			{ k: "B", v: 2 },
			{ k: "C", v: 3 },
		];
		const { scene, handle } = frame(
			{ data: rows, category: "k", value: "v" },
			{
				xAxis: {
					slot: (key) => (key === "C" ? 0 : key === "A" ? 1.5 : undefined),
				},
			},
		);
		const band = handle.xBand;
		expect(band?.center("C")).toBeCloseTo(0.5);
		expect(band?.center("A")).toBeCloseTo(2);
		expect(band?.center("B")).toBeCloseTo(1.5);
		const name = scene.texts().find((s) => s.text === "C");
		const bar = barBoxes(scene)[0];
		expect(name?.at.x).toBeCloseTo(((bar?.minX ?? 0) + (bar?.maxX ?? 0)) / 2);
	});
});

describe("clock-driven transition (instance tween bank)", () => {
	it("tweens bars to new data with `transition`, and is instant without it", () => {
		const data = [
			{ k: "A", v: 2 },
			{ k: "B", v: 4 },
		];
		const taller = data.map((d) => ({ ...d, v: d.v * 2 }));
		const { scene, layer, handle } = frame(
			{
				data,
				category: "k",
				value: "v",
				key: "k",
				transition: { duration: 1, easing: "linear" },
			},
			{ yRange: [0, 10] },
		);
		const top = () => barBoxes(scene, layer)[0]?.maxY ?? Number.NaN;
		const y = (v: number) => rounded(handle.coords.coordsToPoint(0, v).y);
		// The first items enter through the bank too (shared `createBatchedMark`
		// behaviour): let them settle.
		scene.advance(1.1);
		expect(top()).toBeCloseTo(y(2));
		layer.set("data", taller);
		scene.commit();
		scene.advance(0.5);
		expect(top()).toBeCloseTo(y(3));
		scene.advance(0.6);
		expect(top()).toBeCloseTo(y(4));

		layer.set("transition", undefined);
		layer.set("data", data);
		scene.commit();
		expect(top()).toBeCloseTo(y(2));
	});
});
