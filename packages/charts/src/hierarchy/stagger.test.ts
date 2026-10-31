/**
 * `enterStagger` on the hierarchy charts: their own join (`hierarchyJoin`) staggers entering nodes
 * in the new tree's pre-order; both ends stay exactly each end's chart, and
 * a scrub lays nothing out again. Also the StackPlot cases: whole bands
 * enter one after another, bottom of the new stack up.
 */

import type { SceneNode } from "@sophistry/core";
import type { MarksSpec, TextSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { chart } from "../chart";
import { stackPlot } from "../curves/stack-plot";
import { itemsAt } from "../curves/test-items";
import { partitionLayout } from "../math/hierarchy";
import { hierarchyJoin } from "../math/hierarchyJoin";
import { markItems, mount } from "../test-harness";
import { circlePack } from "./circle-pack";
import { icicle } from "./icicle";
import { sunburst } from "./sunburst";
import { tree as treeChart } from "./tree";
import { treemap } from "./treemap";

const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** Everything drawn, ids left out and numbers rounded: what "the same chart" means. */
function picture(node: SceneNode): unknown[] {
	const clean = (value: unknown): unknown => {
		if (typeof value === "number") return rounded(value);
		if (Array.isArray(value)) return value.map(clean);
		if (value && typeof value === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value))
				if (k !== "id") out[k] = clean(v);
			return out;
		}
		return value;
	};
	return mount(node).graph.frame.flatMap((spec) => {
		if (spec.kind === "text") {
			const { id: _id, ...rest } = spec as TextSpec;
			return [clean(rest)];
		}
		if (spec.kind === "marks")
			return markItems(spec as MarksSpec)
				.filter((item) => item.alpha > 0)
				.map((item) => clean(item));
		return [];
	});
}

type Node = { name: string; size?: number; children?: Node[] };
const tree: Node = {
	name: "root",
	children: [
		{ name: "a", children: [{ name: "a1", size: 4 }] },
		{ name: "b", size: 3 },
	],
};
const grown: Node = {
	name: "root",
	children: [
		{
			name: "a",
			children: [
				{ name: "a1", size: 4 },
				{ name: "a2", size: 2 },
			],
		},
		{ name: "b", size: 3 },
		{ name: "c", children: [{ name: "c1", size: 2 }] },
	],
};
const common = {
	data: tree,
	value: "size",
	label: "name",
	sort: false,
	depthLighten: 0,
	enterStagger: 0.6,
};

describe("enterStagger on StackPlot", () => {
	type Row = { t: number; v: number; s: string };
	const rows = (series: string[], v = 1): Row[] =>
		series.flatMap((s) => [0, 1, 2].map((t) => ({ t, v, s })));
	const before = rows(["a"]);
	const after = rows(["a", "b", "c"]);
	const Z = 7;
	const stack = (
		blend: number | undefined,
		data: Row[],
		to?: Row[],
		extra: Record<string, unknown> = {},
	) =>
		chart.create({
			width: 6,
			height: 4,
			xRange: [0, 2],
			yRange: [0, 4],
			children: [
				stackPlot.create({
					zIndex: Z,
					data,
					to,
					blend,
					x: "t",
					y: "v",
					series: "s",
					enterStagger: 0.5,
					...extra,
				} as never),
			],
		});
	/** The bands drawn, bottom first: each one's bottom and top in scene units. */
	const bands = (node: SceneNode) =>
		itemsAt(mount(node).marks(), Z)
			.filter(
				(item) => item.closed && item.points.length > 0 && item.opacity > 0,
			)
			.map((item) => {
				const ys = item.points.map((p) => p.y);
				return {
					bottom: rounded(Math.min(...ys)),
					top: rounded(Math.max(...ys)),
				};
			})
			.sort((p, q) => p.bottom - q.bottom);

	it("is exactly each end's own chart at blend 0 and 1", () => {
		for (const extra of [{}, { staging: "together" }, { order: "reverse" }]) {
			expect(picture(stack(0, before, after, extra))).toEqual(
				picture(stack(undefined, before, undefined, extra)),
			);
			expect(picture(stack(1, before, after, extra))).toEqual(
				picture(stack(undefined, after, undefined, extra)),
			);
		}
	});

	it("grows whole bands one after another, bottom up, with no gap in the stack", () => {
		const at = (blend: number, extra: Record<string, unknown> = {}) =>
			bands(stack(blend, before, after, { staging: "together", ...extra }));
		// One band of 1 is a unit of 1 on a [0, 4] axis 4 units tall.
		const unit = (list: { bottom: number; top: number }[]) =>
			(list[0]?.top ?? 0) - (list[0]?.bottom ?? 0);
		const thickness = (band: { bottom: number; top: number } | undefined) =>
			(band?.top ?? 0) - (band?.bottom ?? 0);
		// together, spread 0.5 over two arriving bands: b enters over
		// [0, 0.5], c over [0.5, 1]. Under "together" the morph out of the seam
		// runs at the same time (update = blend), so a band's thickness is
		// update × its own enter: at 0.75, b is 0.75 × 1 and c 0.75 × 0.5.
		const mid = at(0.75);
		expect(mid).toHaveLength(3);
		const u = unit(mid);
		expect(thickness(mid[1])).toBeCloseTo(0.75 * u);
		expect(thickness(mid[2])).toBeCloseTo(0.375 * u);
		// At 0.25 b is 0.25 × 0.5 in and c not begun (not drawn).
		const early = at(0.25);
		expect(early).toHaveLength(2);
		expect(thickness(early[1])).toBeCloseTo(0.125 * u);
		// Every frame a stack: each band stands on the one below it.
		for (const blend of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9])
			for (const order of ["appearance", "reverse"]) {
				const list = at(blend, { order });
				for (let i = 1; i < list.length; i++)
					expect(list[i]?.bottom).toBeCloseTo(list[i - 1]?.top as number);
			}
		// Under order="reverse" the bottom of the new stack is c: it comes
		// first, under a (b has not begun).
		const reversed = at(0.25, { order: "reverse" });
		expect(reversed).toHaveLength(2);
		expect(thickness(reversed[0])).toBeCloseTo(0.125 * u);
		expect(thickness(reversed[1])).toBeCloseTo(u);
		// Without a stagger both arrive together.
		const together = at(0.5, { enterStagger: 0 });
		expect(thickness(together[1])).toBeCloseTo(0.25 * u);
		expect(thickness(together[2])).toBeCloseTo(0.25 * u);
	});
});

describe("enterStagger on the hierarchy charts", () => {
	const charts = {
		treemap: (extra: object) =>
			treemap.create({ ...common, width: 8, height: 4, ...extra }),
		icicle: (extra: object) =>
			icicle.create({ ...common, width: 6, height: 3, ...extra }),
		sunburst: (extra: object) =>
			sunburst.create({ ...common, radius: 3, ...extra }),
		circlePack: (extra: object) =>
			circlePack.create({ ...common, radius: 3, ...extra }),
		tree: (extra: object) =>
			treeChart.create({ ...common, width: 6, height: 3, ...extra }),
	};
	for (const [name, chart] of Object.entries(charts)) {
		it(`${name}: both ends are exactly each end's own chart`, () => {
			expect(picture(chart({ to: grown, blend: 0 }))).toEqual(
				picture(chart({})),
			);
			expect(picture(chart({ to: grown, blend: 1 }))).toEqual(
				picture(chart({ data: grown })),
			);
		});
	}

	it("hierarchyJoin: new nodes fade in one after another, in the new tree's pre-order", () => {
		const options = {
			value: (d: Node) => d.size ?? 0,
			label: (d: Node) => d.name,
			sort: false,
		};
		const from = partitionLayout(tree, options);
		const to = partitionLayout(grown, options);
		const presence = (blend: number, enterStagger?: number) =>
			Object.fromEntries(
				hierarchyJoin(from, to, {
					blend,
					staging: "together",
					enterStagger,
					fields: ["x0", "x1", "y0", "y1"],
				})
					.filter((node) => node.fromAt < 0)
					.map((node) => [node.label, rounded(node.presence)]),
			);
		// a2, c, c1 arrive (pre-order). Spread 0.6 over three: each takes
		// 0.4, starting at 0, 0.3 and 0.6.
		expect(presence(0.5, 0.6)).toEqual({ a2: 1, c: 0.5, c1: 0 });
		expect(presence(0.8, 0.6)).toEqual({ a2: 1, c: 1, c1: 0.5 });
		// A parent never trails its children; the ends are exact.
		expect(presence(0, 0.6)).toEqual({ a2: 0, c: 0, c1: 0 });
		expect(presence(1, 0.6)).toEqual({ a2: 1, c: 1, c1: 1 });
		expect(presence(0.5)).toEqual({ a2: 0.5, c: 0.5, c1: 0.5 });
	});
});

describe("enterStagger under a scrub", () => {
	it("scrubs mounted charts through a staggered enter", () => {
		const charts: SceneNode[] = [
			treemap.create({ ...common, width: 8, height: 4, to: grown, blend: 0 }),
			treeChart.create({ ...common, width: 6, height: 3, to: grown, blend: 0 }),
		];
		const scene = mount(...charts);
		for (const t of [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.65, 0, 1]) {
			for (const chart of charts) chart.set("blend" as never, t as never);
			scene.commit();
		}
		expect(scene.marks().length).toBeGreaterThan(0);
	});
});
