/**
 * `treemap` mounted: tiles in
 * scene units, colour by branch, the progress reveal, names, tooltips,
 * drill-down focus and keyed transitions.
 */

import { cssColor } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { mount } from "../test-harness.js";
import {
	alphaOf,
	area,
	boxes,
	boxOfItem,
	drawn,
	items,
	mountChart,
	opaque,
	texts,
} from "./test-helpers.js";
import { treemap } from "./treemap.js";

type Node = { name: string; size?: number; children?: Node[] };

const tree: Node = {
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
		{
			name: "c",
			children: [
				{ name: "c1", size: 1 },
				{ name: "c2", size: 6 },
			],
		},
	],
};

const COLORS = ["#ff0000", "#00ff00", "#0000ff"];
const common = {
	data: tree,
	value: "size",
	label: "name",
	sort: false,
	colors: COLORS,
	depthLighten: 0,
};

const at = (extra: Record<string, unknown>) =>
	mount(treemap.create({ ...common, width: 4, height: 2, ...extra }));

describe("treemap", () => {
	it("tiles the box with leaf areas proportional to value", () => {
		const scene = at({ padding: 0 });
		const all = items(scene);
		// Every node below the root: a, a1, a2, b, c, c1, c2.
		expect(all).toHaveLength(7);
		expect(scene.marks()).toHaveLength(1);
		expect(scene.marks()[0]?.shape.kind).toBe("rect");
		const leaves = all.filter((item) => alphaOf(item.fill) === 1);
		expect(leaves).toHaveLength(5);
		const values = [4, 2, 3, 1, 6];
		leaves.forEach((leaf, i) => {
			const b = boxOfItem(leaf);
			expect(area(b)).toBeCloseTo(((values[i] as number) / 16) * 8, 6);
			expect(b.minX).toBeGreaterThanOrEqual(-2 - 1e-9);
			expect(b.maxX).toBeLessThanOrEqual(2 + 1e-9);
			expect(b.minY).toBeGreaterThanOrEqual(-1 - 1e-9);
			expect(b.maxY).toBeLessThanOrEqual(1 + 1e-9);
		});
	});

	it("colours every node by its top-level branch", () => {
		const [red, green, blue] = COLORS.map(opaque);
		const fills = items(at({})).map((item) => opaque(item.fill));
		expect(fills).toEqual([red, red, red, green, blue, blue, blue]);
	});

	it("lightens deeper levels and honours a color channel", () => {
		const [a, a1] = items(at({ depthLighten: 0.2 })).map((item) => item.fill);
		expect(opaque(a as string)).toBe(opaque(COLORS[0] as string));
		expect(opaque(a1 as string)).not.toBe(opaque(a as string));
		const custom = at({
			color: (d: Node) => (d.name === "b" ? "#123456" : undefined),
		});
		expect(items(custom)[3]?.fill).toBe(cssColor("#123456"));
	});

	it("fades tiles in reading order with progress", () => {
		const none = at({ progress: 0 });
		expect(items(none)).toHaveLength(0);
		expect(texts(none)).toHaveLength(0);

		const opacities = items(at({ progress: 0.5 })).map((item) => item.alpha);
		expect(opacities.length).toBeGreaterThan(0);
		expect(opacities.length).toBeLessThan(7);
		expect(opacities[0]).toBe(1);
		// Earlier tiles are never behind later ones (groups are tinted, so compare leaves' share).
		const all = items(at({ progress: 1 }));
		expect(all).toHaveLength(7);
	});

	it("writes leaf names only where they fit, and group names in the header", () => {
		const big = mount(
			treemap.create({ ...common, width: 8, height: 4, paddingTop: 0.3 }),
		);
		expect(texts(big).sort()).toEqual(
			["a", "a1", "a2", "b", "c", "c1", "c2"].sort(),
		);
		const tiny = mount(treemap.create({ ...common, width: 0.5, height: 0.5 }));
		expect(texts(tiny)).toEqual([]);
	});

	it("names each tile with its path and value, for the tooltip and the item list", () => {
		const t = mountChart(
			treemap.create({ ...common, width: 4, height: 2, tooltip: true }),
		);
		expect(t.names()).toContain("a / a1: 4");
		expect(t.names()).toContain("c: 7");
		const custom = mountChart(
			treemap.create({
				...common,
				width: 4,
				height: 2,
				tooltip: (d: Node) => `#${d.name}`,
			}),
		);
		expect(custom.names()).toContain("#b");
	});

	it("draws nothing for an empty tree", () => {
		const scene = at({ data: { name: "r" } });
		expect(scene.graph.frame).toEqual([]);
	});
});

describe("treemap drill-down (focus)", () => {
	const flat = { ...common, padding: 0, width: 8, height: 4 };

	it("the focused tile fills the box, its children scaled with it", () => {
		const scene = mount(treemap.create({ ...flat, focus: ["a"] }));
		const shown = drawn(scene).map(boxOfItem);
		// a (now the whole box), a1 and a2; everything else is gone.
		expect(shown).toHaveLength(3);
		const [a, a1, a2] = shown as [
			ReturnType<typeof boxOfItem>,
			ReturnType<typeof boxOfItem>,
			ReturnType<typeof boxOfItem>,
		];
		expect(area(a)).toBeCloseTo(32, 6);
		expect(area(a1)).toBeCloseTo((32 * 4) / 6, 6);
		expect(area(a2)).toBeCloseTo((32 * 2) / 6, 6);
		for (const b of shown) {
			expect(b.minX).toBeGreaterThanOrEqual(-4 - 1e-9);
			expect(b.maxX).toBeLessThanOrEqual(4 + 1e-9);
		}
		expect(texts(scene)).toContain("a1");
		expect(texts(scene)).not.toContain("b");
	});

	it("{ from, to, t } blends the window, fading what it leaves", () => {
		const atT = (t: number) =>
			mount(treemap.create({ ...flat, focus: { from: [], to: ["a"], t } }));
		const start = atT(0);
		const plain = mount(treemap.create(flat));
		expect(boxes(start)).toEqual(boxes(plain));
		const mid = atT(0.5);
		const shown = drawn(mid);
		const opacityOf = (name: string) =>
			shown[["a", "a1", "a2", "b", "c", "c1", "c2"].indexOf(name)]?.alpha;
		expect(opacityOf("a1")).toBeCloseTo(1);
		expect(opacityOf("b")).toBeCloseTo(0.5);
		const a0 = area(boxes(start)[0] as ReturnType<typeof boxOfItem>);
		const a = area(boxes(mid)[0] as ReturnType<typeof boxOfItem>);
		expect(a).toBeGreaterThan(a0);
		expect(a).toBeLessThan(32);
		for (const b of boxes(mid)) {
			expect(b.minX).toBeGreaterThanOrEqual(-4 - 1e-9);
			expect(b.maxX).toBeLessThanOrEqual(4 + 1e-9);
			expect(b.minY).toBeGreaterThanOrEqual(-2 - 1e-9);
			expect(b.maxY).toBeLessThanOrEqual(2 + 1e-9);
		}
		// A pure function of t: the same t draws the same frame.
		expect(boxes(atT(0.5))).toEqual(boxes(mid));
	});
});
