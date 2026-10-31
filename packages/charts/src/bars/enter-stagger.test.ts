/**
 * `enterStagger` on `bars`: entering
 * bars take their own sub-windows of the enter stage, in `staggerOrder`,
 * while the ends of the transition stay exactly each end's chart.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chart } from "../chart";
import type { AnyDatum } from "../props";
import { mount } from "../test-harness";
import type { BarsProps } from "./bars";
import { bars } from "./bars";
import { boxes } from "./test-helpers";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

const before = [
	{ k: "a", v: 2 },
	{ k: "b", v: 3 },
];
/** Three entering keys, listed out of category order. */
const after = [
	{ k: "a", v: 2 },
	{ k: "b", v: 3 },
	{ k: "e", v: 4 },
	{ k: "c", v: 2 },
	{ k: "d", v: 3 },
];
type Row = (typeof before)[number];

function barsAt(
	blend: number,
	data: Row[],
	to?: Row[],
	extra: Partial<BarsProps<Row>> = {},
) {
	const layer = bars.create({
		data,
		to,
		blend,
		key: "k",
		category: "k",
		value: "v",
		enterStagger: 0.5,
		...extra,
	} as BarsProps<AnyDatum>);
	const plot = chart.create({
		width: 8,
		height: 4,
		yRange: [0, 5],
		children: [layer],
	});
	const scene = mount(plot);
	return {
		layer,
		scene,
		boxes: () =>
			boxes(scene.marks().filter((spec) => spec.shape.kind === "rect"))
				.filter((b) => b.maxY - b.minY > 0)
				.map((b) => ({
					x: rounded((b.minX + b.maxX) / 2),
					h: rounded(b.maxY - b.minY),
				}))
				.sort((p, q) => p.x - q.x),
	};
}

describe("enterStagger", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("staggers entering bars in category order", () => {
		const heights = barsAt(0.75, before, after, { staging: "together" })
			.boxes()
			.map((b) => b.h);
		// Bars a and b are whole; the entering e, c, d grow in `to`'s category
		// order (e first): e and c whole, d half grown.
		const whole = barsAt(0, after).boxes();
		expect(heights[0]).toBeCloseTo(whole[0]?.h as number);
		expect(heights[2]).toBeCloseTo(whole[2]?.h as number);
		expect(heights[3]).toBeCloseTo(whole[3]?.h as number);
		expect(heights[4]).toBeCloseTo((whole[4]?.h as number) / 2);
	});

	it("scrubs without diagnostics, every frame a pure function of blend", () => {
		const messages: string[] = [];
		for (const level of ["warn", "error"] as const)
			vi.spyOn(console, level).mockImplementation((...args) => {
				messages.push(`${level}: ${args.map(String).join(" ")}`);
			});
		const extra = { enterStagger: 0.6, staggerOrder: "random" as const };
		const scrubbed = barsAt(0, before, after, extra);
		for (const t of [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.65, 0, 1, 0.65]) {
			scrubbed.layer.set("blend", t);
			scrubbed.scene.commit();
		}
		expect(messages).toEqual([]);
		expect(scrubbed.boxes()).toEqual(
			barsAt(0.65, before, after, extra).boxes(),
		);
	});
});
