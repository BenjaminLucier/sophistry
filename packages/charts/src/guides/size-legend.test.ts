/**
 * The size key on its own: the pure parts (values, layout, the stack's
 * measurements) and `sizeLegend` drawn without a frame, through a keyed
 * transition and a scrub. The `chart` size key cases are the frame's.
 */

import type { Point } from "@sophistry/core/geometry";
import type { ShapeSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { bubbleLegendValues } from "../math/bubble";
import { sizeLegendLayout } from "../math/legend";
import { mount } from "../test-harness";
import type { SizeKey } from "./size-legend";
import {
	flowSizeKeys,
	measureSizeKeyExtents,
	measureSizeKeys,
	sameOffsets,
	sameSizeKeyMeasures,
	sameSizeKeysEnds,
	sizeKeyOffsets,
	sizeKeyStack,
	sizeLegend,
} from "./size-legend";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;
const circleOf = (spec: ShapeSpec) => {
	const points = spec.polylines.flat();
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	return {
		x: rounded((minX + maxX) / 2),
		y: rounded((Math.min(...ys) + Math.max(...ys)) / 2),
		r: rounded((maxX - minX) / 2),
		opacity: spec.style.opacity,
	};
};
type Scene = ReturnType<typeof mount>;
const keyCircles = (scene: Scene) =>
	scene
		.shapes()
		.filter((s) => s.closed && s.style.fill === "none" && s.polylines.length)
		.map(circleOf);
const textsOf = (scene: Scene) => scene.texts().map((t) => t.text);

describe("size key values and layout", () => {
	it("picks up to three round values above zero, the largest kept", () => {
		expect(bubbleLegendValues(16)).toEqual([5, 10, 15]);
		expect(bubbleLegendValues(1)).toEqual([0.5, 1]);
		expect(bubbleLegendValues(1_200_000)).toEqual([500_000, 1_000_000]);
		expect(bubbleLegendValues(16, 2)).toEqual([10, 15]);
		expect(bubbleLegendValues(0)).toEqual([]);
		expect(bubbleLegendValues(Number.NaN)).toEqual([]);
	});

	it("stacks circles on one centre line, each row as tall as its circle", () => {
		const layout = sizeLegendLayout([0.1, 0.3], [0.5, 0.4], {
			direction: "column",
			rowHeight: 0.4,
			gap: 0.1,
			itemGap: 0.2,
		});
		expect(layout.items.map((item) => item.center.x)).toEqual([0.3, 0.3]);
		// Row 1: a line of text (0.4); row 2: the circle's diameter (0.6).
		expect(layout.items.map((item) => rounded(item.center.y))).toEqual([
			-0.2, -0.7,
		]);
		expect(layout.items[0]?.label.x).toBeCloseTo(0.7);
		expect(layout.width).toBeCloseTo(0.7 + 0.5);
		expect(layout.height).toBeCloseTo(1);
	});

	it("lays a row side by side and wraps at maxWidth", () => {
		const layout = sizeLegendLayout([0.1, 0.2, 0.3], [0.3, 0.3, 0.3], {
			direction: "row",
			rowHeight: 0.4,
			gap: 0.1,
			itemGap: 0.2,
			maxWidth: 1.7,
		});
		const [a, b, c] = layout.items;
		expect(a?.center).toEqual({ x: 0.1, y: -0.3 });
		expect(b?.center.x).toBeCloseTo(0.2 + 0.1 + 0.3 + 0.2 + 0.2);
		// The third would end at 2.8: it wraps to a second row of the same height.
		expect(c?.center.x).toBeCloseTo(0.3);
		expect(c?.center.y).toBeCloseTo(-0.9);
		expect(layout.height).toBeCloseTo(1.2);
	});
});

describe("a stack of size keys, measured", () => {
	const keys: SizeKey[] = [
		{ maxValue: 100, range: [0, 0.5], label: "pop" },
		{ maxValue: 10, range: [0, 0.3], label: "area" },
	];
	const options = { fontFamily: "sans-serif", direction: "column" as const };

	it("measures each key at each end, and nothing without keys", () => {
		expect(measureSizeKeyExtents([], options)).toBeUndefined();
		const still = measureSizeKeyExtents(keys, options);
		expect(still?.to).toBeUndefined();
		expect(still?.from.map((e) => e.presence)).toEqual([1, 1]);
		const rescaling = measureSizeKeyExtents(
			[{ ...keys[0], to: 0 } as SizeKey, keys[1] as SizeKey],
			options,
		);
		// An end that sizes nothing has no key there.
		expect(rescaling?.to?.[0]).toEqual({ width: 0, height: 0, presence: 0 });
		expect(
			sameSizeKeyMeasures(still, measureSizeKeyExtents(keys, options)),
		).toBe(true);
		expect(sameSizeKeyMeasures(still, rescaling)).toBe(false);
	});

	it("flows keys one under another, starting a column past maxHeight", () => {
		const measures = {
			from: [
				{ width: 1, height: 2, presence: 1 },
				{ width: 0.5, height: 0, presence: 0 },
				{ width: 1.5, height: 2, presence: 1 },
			],
			to: undefined,
		};
		const stacked = flowSizeKeys(measures, 0.2);
		expect(stacked?.offsets.from).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: 2.2 },
			{ x: 0, y: 2.2 },
		]);
		expect(stacked?.from).toEqual({ width: 1.5, height: 4.2, presence: 1 });
		const columns = flowSizeKeys(measures, 0.2, { maxHeight: 3, gap: 0.4 });
		expect(columns?.offsets.from[2]).toEqual({ x: 1.4, y: 0 });
		expect(columns?.from.width).toBeCloseTo(2.9);
		expect(sameSizeKeysEnds(stacked, flowSizeKeys(measures, 0.2))).toBe(true);
		expect(sameSizeKeysEnds(stacked, columns)).toBe(false);
		expect(
			sameSizeKeysEnds(measureSizeKeys(keys, options, 0.2), undefined),
		).toBe(false);
	});

	it("blends each key's place by the update progress", () => {
		const from: Point[] = [{ x: 0, y: 0 }];
		const to: Point[] = [{ x: 2, y: 4 }];
		const ends = {
			from: { width: 1, height: 1, presence: 1 },
			to: { width: 1, height: 1, presence: 1 },
			offsets: { from, to },
		};
		expect(sizeKeyOffsets(undefined, 0.5)).toEqual([]);
		expect(sizeKeyOffsets(ends, 0)).toBe(from);
		expect(sizeKeyOffsets(ends, 1)).toBe(to);
		expect(sizeKeyOffsets(ends, 0.5)).toEqual([{ x: 1, y: 2 }]);
		expect(sameOffsets(from, [{ x: 0, y: 0 }])).toBe(true);
		expect(sameOffsets(from, to)).toBe(false);
	});
});

describe("sizeLegend on its own", () => {
	it("draws a key for radii computed by hand", () => {
		const scene = mount(
			sizeLegend.create({
				at: { x: 0, y: 0 },
				scale: { maxValue: 100, range: [0, 0.5] },
				values: [25, 100],
			}),
		);
		expect(keyCircles(scene).map((c) => c.r)).toEqual([0.25, 0.5]);
		expect(textsOf(scene)).toEqual(["25", "100"]);
	});

	it("draws round values by default, with a title, and hides on visible false", () => {
		const key = sizeLegend.create({
			at: { x: 1, y: 2 },
			scale: { maxValue: 16 },
			title: "Population",
		});
		const scene = mount(key);
		expect(textsOf(scene)).toEqual(["Population", "5", "10", "15"]);
		key.set("visible", false);
		scene.commit();
		expect(scene.shapes()).toEqual([]);
		expect(scene.texts()).toEqual([]);
	});

	it("reveals its circles one after another", () => {
		const key = sizeLegend.create({
			at: { x: 0, y: 0 },
			scale: { maxValue: 100, range: [0, 0.5] },
			values: [25, 50, 100],
			progress: 0.3,
		});
		const scene = mount(key);
		const opacities = keyCircles(scene).map((c) => c.opacity);
		expect(opacities.length).toBeGreaterThan(0);
		expect(opacities[0]).toBeCloseTo(0.6);
		key.set("progress", 1);
		scene.commit();
		expect(keyCircles(scene).map((c) => c.opacity)).toEqual([1, 1, 1]);
	});

	it("is exactly each end's key at the ends of a transition, blending the shared values", () => {
		const scale = { maxValue: 100, range: [0, 0.5] as const };
		const far = { maxValue: 400, range: [0, 0.5] as const };
		const values = [25, 100];
		const start = mount(
			sizeLegend.create({ at: { x: 0, y: 0 }, scale, values }),
		);
		const end = mount(
			sizeLegend.create({ at: { x: 0, y: 0 }, scale: far, values }),
		);
		const key = sizeLegend.create({
			at: { x: 0, y: 0 },
			scale,
			values,
			transition: { to: far, exit: 0, update: 0, enter: 0 },
		});
		const scene = mount(key);
		expect(keyCircles(scene)).toEqual(keyCircles(start));
		key.set("transition", { to: far, exit: 1, update: 1, enter: 1 });
		scene.commit();
		expect(keyCircles(scene)).toEqual(keyCircles(end));
		key.set("transition", { to: far, exit: 1, update: 0.5, enter: 0 });
		scene.commit();
		const [a] = keyCircles(scene);
		// 100 is 0.5 at the start and 0.25 at the end.
		expect(keyCircles(scene).map((c) => c.r)).toContain(0.375);
		expect(a?.opacity).toBe(1);
	});

	it("fades the start's values out on the exit and the end's in on the enter", () => {
		const key = sizeLegend.create({
			at: { x: 0, y: 0 },
			scale: { maxValue: 100, range: [0, 0.5] },
			values: [10],
			transition: {
				to: { maxValue: 100, range: [0, 0.5] },
				values: [50],
				exit: 0.25,
				update: 0,
				enter: 0.5,
			},
		});
		const scene = mount(key);
		expect(keyCircles(scene).map((c) => c.opacity)).toEqual([0.75, 0.5]);
		expect(textsOf(scene)).toEqual(["10", "50"]);
	});

	it("fades its title with an end that sizes nothing", () => {
		const key = sizeLegend.create({
			at: { x: 0, y: 0 },
			scale: { maxValue: 100 },
			title: "Size",
			transition: { to: { maxValue: 0 }, exit: 0.4, update: 0, enter: 0 },
		});
		const scene = mount(key);
		const title = scene.texts().find((t) => t.text === "Size");
		expect(title?.style.opacity).toBeCloseTo(0.6);
	});

	it("scrubs without re-measuring the key or re-making its nodes", () => {
		const scale = { maxValue: 100, range: [0, 0.5] as const };
		const far = { maxValue: 400, range: [0, 0.5] as const };
		const key = sizeLegend.create({
			at: { x: 0, y: 0 },
			scale,
			values: [25, 100],
			transition: { to: far, exit: 0, update: 0, enter: 0 },
		});
		const scene = mount(key);
		const nodes = [...key.children];
		const ids = scene.shapes().map((s) => s.id);
		for (const t of [0.2, 0.4, 0.6]) {
			key.set("transition", { to: far, exit: 1, update: t, enter: 0 });
			scene.commit();
		}
		expect(key.children).toEqual(nodes);
		expect(scene.shapes().map((s) => s.id)).toEqual(ids);
	});
});

describe("sizeKeyStack", () => {
	it("draws one key per scale at its offset, titling the first with a given title", () => {
		const stack = sizeKeyStack.create({
			keys: [
				{ maxValue: 100, range: [0, 0.5], label: "pop" },
				{ maxValue: 10, range: [0, 0.3], label: "area" },
			],
			offsets: [
				{ x: 0, y: 0 },
				{ x: 0, y: 2 },
			],
			at: { x: 1, y: 3 },
			title: "Population",
			direction: "column",
		});
		const scene = mount(stack);
		const texts = textsOf(scene);
		expect(texts).toContain("Population");
		expect(texts).toContain("area");
		expect(texts).not.toContain("pop");
		const [first, second] = stack.children;
		expect(first?.get("at" as never)).toEqual({ x: 1, y: 3 });
		expect(second?.get("at" as never)).toEqual({ x: 1, y: 1 });
		const kept = [...stack.children];
		stack.set("stages", { exit: 0, update: 0.5, enter: 0 });
		scene.commit();
		expect(stack.children).toEqual(kept);
	});
});
