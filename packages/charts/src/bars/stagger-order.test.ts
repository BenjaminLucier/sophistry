/**
 * `enterStagger` on the bar family's keyed marks: both ends of a transition are exactly each
 * end's own chart.
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { chart } from "../chart.js";
import { mount } from "../test-harness.js";
import { bars } from "./bars.js";
import { histogram } from "./histogram.js";
import { ruleX } from "./rules.js";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** Everything drawn, ids left out and numbers rounded: what "the same chart" means. */
function picture(scene: ReturnType<typeof mount>): unknown[] {
	const clean = (value: unknown): unknown => {
		if (typeof value === "number") return rounded(value);
		if (ArrayBuffer.isView(value))
			return Array.from(value as Float64Array).map(clean);
		if (Array.isArray(value)) return value.map(clean);
		if (value && typeof value === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value))
				if (k !== "id" && k !== "bounds") out[k] = clean(v);
			return out;
		}
		return value;
	};
	return scene.graph.frame
		.filter((spec) => spec.kind === "marks" && spec.count > 0)
		.map((spec) => clean(spec));
}

const before = [
	{ id: "a", x: 1, y: 2, v: 2 },
	{ id: "b", x: 2, y: 3, v: 3 },
];
/** Three entering keys, listed out of x order. */
const after = [
	{ id: "a", x: 1, y: 2, v: 2 },
	{ id: "b", x: 2, y: 3, v: 3 },
	{ id: "e", x: 5, y: 4, v: 4 },
	{ id: "c", x: 3, y: 2, v: 2 },
	{ id: "d", x: 4, y: 3, v: 3 },
];
type Row = (typeof before)[number];
type Build = (blend: number | undefined, data: Row[], to?: Row[]) => SceneNode;

const inChart = (layer: SceneNode) =>
	chart.create({
		width: 8,
		height: 4,
		xRange: [0, 6],
		yRange: [0, 6],
		children: [layer],
	});

const marks: Record<string, Build> = {
	Histogram: (blend, data, to) =>
		inChart(
			histogram.create({
				data,
				to,
				blend,
				value: "x",
				binCount: 6,
				range: [0, 6],
				enterStagger: 0.6,
			}),
		),
	RuleX: (blend, data, to) =>
		inChart(
			ruleX.create({
				data,
				to,
				blend,
				key: "id",
				x: "x",
				y2: "y",
				enterStagger: 0.6,
			}),
		),
	// On its own band axis (the frame fits both ends' categories mid-blend).
	Bars: (blend, data, to) =>
		chart.create({
			width: 8,
			height: 4,
			yRange: [0, 6],
			children: [
				bars.create({
					data,
					to,
					blend,
					key: "id",
					category: "id",
					value: "v",
					enterStagger: 0.6,
				}),
			],
		}),
};

describe("enterStagger on the keyed marks", () => {
	for (const [name, build] of Object.entries(marks)) {
		it(`${name}: both ends are exactly each end's own chart`, () => {
			expect(picture(mount(build(0, before, after)))).toEqual(
				picture(mount(build(undefined, before, undefined))),
			);
			expect(picture(mount(build(1, before, after)))).toEqual(
				picture(mount(build(undefined, after, undefined))),
			);
		});
	}
});
