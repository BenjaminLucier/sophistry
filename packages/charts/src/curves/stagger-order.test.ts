/**
 * `enterStagger` on the series marks: both ends are exactly each end's own
 * chart, and entering lines sweep in one after another in `to`'s order.
 *
 * A scrub checks the enter order holds still: the
 * same blend draws the same picture going forward and back.
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { chart } from "../chart.js";
import { mount } from "../test-harness.js";
import { density } from "./density.js";
import { linePlot } from "./line-plot.js";
import type { CurveItem } from "./test-items.js";
import { drawing, itemsAt, rounded } from "./test-items.js";

const Z = 7;

const before = [
	{ id: "a", x: 1, y: 2, v: 2, s: "p" },
	{ id: "b", x: 2, y: 3, v: 3, s: "q" },
];
/** Three entering keys, listed out of x order. */
const after = [
	{ id: "a", x: 1, y: 2, v: 2, s: "p" },
	{ id: "b", x: 2, y: 3, v: 3, s: "q" },
	{ id: "e", x: 5, y: 4, v: 4, s: "u" },
	{ id: "c", x: 3, y: 2, v: 2, s: "r" },
	{ id: "d", x: 4, y: 3, v: 3, s: "t" },
];
type Row = (typeof before)[number];
/** Line and density data: one series per `s`. */
const runsOf = (list: Row[]) =>
	list.flatMap((row) =>
		[0, 1, 2, 3].map((i) => ({ s: row.s, x: i, y: row.v + i * 0.1 })),
	);
const samplesOf = (list: Row[]) =>
	list.flatMap((row) =>
		[0, 0.5, 1, 1.5, 2].map((d) => ({ s: row.s, x: row.v + d })),
	);

type Build = (
	blend: number | undefined,
	data: Row[],
	to: Row[] | undefined,
	extra?: Record<string, unknown>,
) => SceneNode;

const marks: Record<string, Build> = {
	linePlot: (blend, data, to, extra) =>
		linePlot.create({
			zIndex: Z,
			data: runsOf(data),
			to: to && runsOf(to),
			blend,
			x: "x",
			y: "y",
			series: "s",
			enterStagger: 0.6,
			...extra,
		}),
	density: (blend, data, to, extra) =>
		density.create({
			zIndex: Z,
			data: samplesOf(data),
			to: to && samplesOf(to),
			blend,
			x: "x",
			series: "s",
			enterStagger: 0.6,
			...extra,
		}),
};

/** The mark's items in a chart with fixed ranges. */
function draw(layer: SceneNode): CurveItem[] {
	const scene = mount(
		chart.create({
			width: 8,
			height: 4,
			xRange: [0, 6],
			yRange: [0, 6],
			children: [layer],
		}),
	);
	return itemsAt(scene.marks(), Z).filter(
		(item) => item.points.length > 0 && item.opacity > 0,
	);
}

describe("enterStagger on the series marks", () => {
	for (const [name, build] of Object.entries(marks)) {
		it(`${name}: both ends are exactly each end's own chart`, () => {
			expect(drawing(draw(build(0, before, after)))).toEqual(
				drawing(draw(build(undefined, before, undefined))),
			);
			expect(drawing(draw(build(1, before, after)))).toEqual(
				drawing(draw(build(undefined, after, undefined))),
			);
		});
	}

	it("linePlot: entering lines sweep in one after another, in `to`'s order", () => {
		const widths = (items: CurveItem[]) =>
			items.map((s) => {
				const xs = s.points.map((p) => p.x);
				return rounded(Math.max(...xs) - Math.min(...xs));
			});
		const line = (blend: number, extra: Record<string, unknown> = {}) =>
			draw(
				(marks.linePlot as Build)(blend, before, after, {
					staging: "together",
					enterStagger: undefined,
					...extra,
				}),
			);
		// At 0.6 with a 0.6 spread over three entering lines, each takes 0.4:
		// the first in `to` (u) is whole, the second (r) half swept, the third
		// (t) not begun, so not drawn. Without the stagger all three are 0.6 in.
		const staggered = widths(line(0.6, { enterStagger: 0.6 }));
		const together = widths(line(0.6));
		const full = together[0] as number;
		expect(together.slice(2)).toEqual([
			rounded(full * 0.6),
			rounded(full * 0.6),
			rounded(full * 0.6),
		]);
		const entering = staggered.slice(2);
		expect(entering).toHaveLength(2);
		expect(entering[0]).toBeCloseTo(full);
		expect(entering[1]).toBeCloseTo(full * 0.75);
	});

	it("scrubs with the enter order held: a blend draws the same going back", () => {
		const layers = Object.values(marks).map((build) => build(0, before, after));
		const scene = mount(
			chart.create({
				width: 8,
				height: 4,
				xRange: [0, 6],
				yRange: [0, 6],
				children: layers,
			}),
		);
		const seen = new Map<number, string[]>();
		for (const t of [
			0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.65, 0, 1, 0.7, 0.3,
		]) {
			for (const layer of layers) layer.set("blend" as never, t as never);
			scene.commit();
			const picture = drawing(itemsAt(scene.marks(), Z));
			const before = seen.get(t);
			if (before) expect(picture).toEqual(before);
			else seen.set(t, picture);
		}
	});
});
