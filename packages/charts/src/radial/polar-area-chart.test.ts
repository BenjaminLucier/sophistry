/**
 * `polarAreaChart`: keyed transitions (radii morph, angular shares open and
 * close), the sweep reveal and its stagger, and the report to a chart.
 * Wedges are path batch items.
 */

import { describe, expect, it } from "vitest";
import { chart, chartHandle } from "../chart";
import { mount } from "../test-harness";
import { polarAreaChart } from "./polar-area-chart";
import {
	angleOf,
	areaOf,
	boxOf,
	filled,
	filledPicture,
	label,
	labelled,
	picture,
	turnOf,
} from "./test-helpers";

describe("keyed transitions on polarAreaChart", () => {
	const before = [
		{ name: "a", v: 4, s: "p" },
		{ name: "b", v: 2, s: "q" },
		{ name: "c", v: 3, s: "p" },
	];
	const after = [
		{ name: "a", v: 2, s: "p" },
		{ name: "b", v: 2, s: "q" },
		{ name: "d", v: 6, s: "r" },
		{ name: "e", v: 1, s: "q" },
	];
	type Row = { name: string; v: number; s: string };
	const rose = (
		data: Row[],
		to: Row[] | undefined,
		blend?: number,
		extra: Record<string, unknown> = {},
	) =>
		polarAreaChart.create({
			data,
			to,
			blend,
			value: "v",
			label: "name",
			series: "s",
			...extra,
		});

	it("is exactly `data` at blend 0 and exactly `to` at blend 1", () => {
		for (const extra of [{}, { progress: 0.6 }]) {
			const start = mount(rose(before, after, 0, extra));
			const plainStart = mount(rose(before, undefined, 0, extra));
			expect(filledPicture(start)).toEqual(filledPicture(plainStart));
			expect(labelled(start)).toEqual(labelled(plainStart));
			const end = mount(rose(before, after, 1, extra));
			const plainEnd = mount(rose(after, undefined, 0, extra));
			expect(filledPicture(end)).toEqual(filledPicture(plainEnd));
			expect(labelled(end)).toEqual(labelled(plainEnd));
		}
	});

	it("blends a wedge's radius in data units", () => {
		const scene = mount(
			rose(
				[
					{ name: "a", v: 4, s: "p" },
					{ name: "b", v: 4, s: "p" },
				],
				[
					{ name: "a", v: 2, s: "p" },
					{ name: "b", v: 4, s: "p" },
				],
				0.5,
				{ staging: "together", maxValue: 4, labels: false },
			),
		);
		// a: the right half, from 12 o'clock round to 6, reaching 3 of 4.
		const right = filled(scene).find((s) => boxOf(s).minX > -1e-9);
		expect(right && boxOf(right).maxX).toBeCloseTo(0.75);
	});

	it("opens an entering wedge's angular share at its full radius", () => {
		const from = [
			{ name: "a", v: 1, s: "p" },
			{ name: "b", v: 1, s: "p" },
		];
		const to = [...from, { name: "c", v: 1, s: "p" }];
		const scene = mount(rose(from, to, 0.75));
		const c = label(scene, "c");
		expect(c?.style.opacity).toBeCloseTo(0.5);
		// Shares 1 : 1 : 0.5 of the turn, c last.
		expect(turnOf(angleOf(c))).toBeCloseTo(0.8 + 0.1);
		expect(turnOf(angleOf(label(scene, "a")))).toBeCloseTo(0.2);
		expect(Math.hypot(c?.at.x ?? 0, c?.at.y ?? 0)).toBeCloseTo(0.65);
	});

	it("reports both ends' series to a frame", () => {
		const plot = chart.create({
			width: 4,
			height: 4,
			xRange: [-2, 2],
			yRange: [-2, 2],
			children: [rose(before, after, 0.5)],
		});
		mount(plot);
		expect(chartHandle(plot)?.colorDomain()).toEqual(["p", "q", "r"]);
	});

	it("scrubs a blend inside a chart: each frame is a function of blend", () => {
		const node = rose(
			[
				{ name: "a", v: 2, s: "p" },
				{ name: "b", v: 1, s: "q" },
			],
			[
				{ name: "b", v: 3, s: "q" },
				{ name: "c", v: 2, s: "r" },
			],
			0,
		);
		const scene = mount(
			chart.create({ width: 8, height: 4, children: [node] }),
		);
		const at = (t: number) => {
			node.set("blend", t);
			scene.commit();
			return picture(scene).items;
		};
		const seen = new Map<number, unknown>();
		for (const t of [0.1, 0.3, 0.6, 0.9, 1]) seen.set(t, at(t));
		for (const t of [0.6, 0.1]) expect(at(t)).toEqual(seen.get(t));
	});

	it("enterStagger: both ends are exactly each end's own chart", () => {
		const rows = [
			{ name: "a", v: 2, s: "p" },
			{ name: "b", v: 3, s: "q" },
		];
		const more = [
			...rows,
			{ name: "e", v: 4, s: "u" },
			{ name: "c", v: 2, s: "r" },
		];
		const build = (blend: number | undefined, data: Row[], to?: Row[]) =>
			mount(
				polarAreaChart.create({
					data,
					to,
					blend,
					value: "v",
					label: "name",
					enterStagger: 0.6,
				}),
			);
		expect(picture(build(0, rows, more))).toEqual(
			picture(build(undefined, rows)),
		);
		expect(picture(build(1, rows, more))).toEqual(
			picture(build(undefined, more)),
		);
	});
});

describe("polarAreaChart sweep", () => {
	it("polar-area wedges take equal shares of one sweep, at full radius", () => {
		const scene = mount(
			polarAreaChart.create({
				data: [4, 2, 3, 1],
				progress: 0.375,
				labels: false,
			}),
		);
		const wedges = filled(scene);
		// 1.5 of 4 wedges: the first whole, the second half swept, the rest not begun.
		expect(wedges).toHaveLength(2);
		for (const wedge of wedges) expect(wedge.progress).toBe(1);
		expect(wedges[0] && boxOf(wedges[0]).maxY).toBeCloseTo(1);
	});
});

describe("polarAreaChart stagger", () => {
	const wedges = (node: ReturnType<typeof polarAreaChart.create>) =>
		filled(mount(node)).map((s) => areaOf(s.polylines));

	it("opens every wedge together at 0, one after another by default", () => {
		const together = wedges(
			polarAreaChart.create({
				data: [1, 1, 1, 1],
				progress: 0.5,
				stagger: 0,
				labels: false,
			}),
		);
		// Four quarter wedges of radius 1, each half open (π/4): π/8 each.
		expect(together).toHaveLength(4);
		for (const area of together) expect(area).toBeCloseTo(Math.PI / 8, 2);
		const sweep = wedges(
			polarAreaChart.create({
				data: [1, 1, 1, 1],
				progress: 0.5,
				labels: false,
			}),
		);
		expect(sweep).toHaveLength(2);
	});

	it("staggers in sweep order, and each end of a transition reveals as its own chart", () => {
		const staggeredAreas = wedges(
			polarAreaChart.create({
				data: [1, 1, 1],
				progress: 0.5,
				stagger: 0.5,
				labels: false,
			}),
		);
		expect(staggeredAreas).toHaveLength(2);
		const end = (data: number[], to?: number[], blend = 0) =>
			wedges(
				polarAreaChart.create({
					data,
					to,
					blend,
					progress: 0.6,
					stagger: 0.4,
					maxValue: 4,
					labels: false,
				}),
			).map((a) => Math.round(a * 1e6));
		expect(end([1, 2, 3], [3, 0, 2, 4], 0)).toEqual(end([1, 2, 3]));
		expect(end([1, 2, 3], [3, 0, 2, 4], 1)).toEqual(end([3, 0, 2, 4]));
	});

	it("scrubs progress back and forth to the same frames", () => {
		const node = polarAreaChart.create({
			data: [1, 2, 3],
			stagger: 0.4,
			progress: 0,
		});
		const scene = mount(node);
		const at = (p: number) => {
			node.set("progress", p);
			scene.commit();
			return picture(scene);
		};
		const half = at(0.55);
		at(1);
		at(0.1);
		expect(at(0.55)).toEqual(half);
	});
});
