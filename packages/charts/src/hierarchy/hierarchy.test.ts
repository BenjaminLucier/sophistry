/**
 * `icicle`, `sunburst` and `circlePack` mounted (the treemap
 * cases are in `treemap.test.ts`): geometry in scene units,
 * colour by branch, the progress-driven reveals, tooltips, drill-down focus
 * and keyed tree transitions for every hierarchy chart. Each drawn node is one
 * batched item.
 */

import type { SceneNode } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { mount } from "../test-harness.js";
import { circlePack } from "./circle-pack.js";
import { icicle } from "./icicle.js";
import { sunburst } from "./sunburst.js";
import type { Scene } from "./test-helpers.js";
import {
	boxes,
	boxOfItem,
	drawn,
	items,
	labels,
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

const show = (node: SceneNode) => mount(node);

describe("icicle", () => {
	it("draws one band per depth, root at the left", () => {
		const all = boxes(
			show(icicle.create({ ...common, width: 6, height: 3, inset: 0 })),
		);
		expect(all).toHaveLength(8);
		const root = all[0] as (typeof all)[number];
		expect(root.minX).toBeCloseTo(-3, 9);
		expect(root.maxX).toBeCloseTo(-1, 9);
		expect(root.maxY - root.minY).toBeCloseTo(3, 9);
		// a: 6/16 of the height, at the top, in the second band.
		const a = all[1] as (typeof all)[number];
		expect(a.minX).toBeCloseTo(-1, 9);
		expect(a.maxX).toBeCloseTo(1, 9);
		expect(a.maxY).toBeCloseTo(1.5, 9);
		expect(a.maxY - a.minY).toBeCloseTo((6 / 16) * 3, 9);
	});

	it("lays out top-down when vertical", () => {
		const root = boxes(
			show(
				icicle.create({
					...common,
					width: 6,
					height: 3,
					inset: 0,
					orientation: "vertical",
				}),
			),
		)[0] as ReturnType<typeof boxOfItem>;
		expect(root.maxY).toBeCloseTo(1.5, 9);
		expect(root.minY).toBeCloseTo(0.5, 9);
		expect(root.maxX - root.minX).toBeCloseTo(6, 9);
	});

	it("grows outward depth by depth from the parent side", () => {
		expect(
			items(
				show(icicle.create({ ...common, width: 6, height: 3, progress: 0 })),
			),
		).toHaveLength(0);
		// Three levels, stagger 0.5: at 0.5 the root is done, depth 1 is half
		// grown and depth 2 has not started.
		const half = boxes(
			show(
				icicle.create({
					...common,
					width: 6,
					height: 3,
					inset: 0,
					progress: 0.5,
				}),
			),
		);
		expect(half).toHaveLength(4);
		const a = half[1] as (typeof half)[number];
		expect(a.minX).toBeCloseTo(-1, 9);
		expect(a.maxX).toBeCloseTo(0, 9);
		expect(
			items(
				show(icicle.create({ ...common, width: 6, height: 3, progress: 1 })),
			),
		).toHaveLength(8);
	});
});

describe("sunburst", () => {
	it("starts at 12 o'clock and runs clockwise", () => {
		const scene = show(sunburst.create({ ...common, radius: 3 }));
		const all = items(scene);
		expect(all).toHaveLength(8);
		expect(scene.marks()).toHaveLength(1);
		expect(scene.marks()[0]?.shape.kind).toBe("paths");
		// a (6/16 of the turn, from 12 o'clock clockwise) lies right of centre.
		const a = boxOfItem(all[1] as (typeof all)[number]);
		expect(a.minX).toBeGreaterThanOrEqual(-1e-6);
		expect(a.maxY).toBeCloseTo(2, 2);
		// c (the last 7/16) ends back at 12 o'clock, from the left.
		const c = boxOfItem(all[5] as (typeof all)[number]);
		expect(c.maxX).toBeLessThanOrEqual(1e-6);
		expect(opaque(all[1]?.fill as string)).toBe(opaque(COLORS[0] as string));
		expect(opaque(all[6]?.fill as string)).toBe(opaque(COLORS[2] as string));
	});

	it("sweeps clockwise with progress", () => {
		expect(
			items(show(sunburst.create({ ...common, radius: 3, progress: 0 }))),
		).toHaveLength(0);
		// No stagger: half a turn swept, so everything drawn is right of centre.
		const half = items(
			show(
				sunburst.create({ ...common, radius: 3, progress: 0.5, stagger: 0 }),
			),
		);
		expect(half.length).toBeGreaterThan(0);
		expect(half.length).toBeLessThan(8);
		for (const item of half)
			expect(boxOfItem(item).minX).toBeGreaterThanOrEqual(-1e-6);
		expect(
			items(show(sunburst.create({ ...common, radius: 3, progress: 1 }))),
		).toHaveLength(8);
	});

	it("can hide the root, leaving a hole", () => {
		expect(
			items(show(sunburst.create({ ...common, radius: 3, root: false }))),
		).toHaveLength(7);
	});

	it("outlines rings in the background colour, never the centre disc", () => {
		const all = items(show(sunburst.create({ ...common, radius: 3 })));
		expect(all[0]?.stroke).toBe("none");
		expect(all[1]?.stroke).not.toBe("none");
	});

	it("names each node with its path for the tooltip", () => {
		const t = mountChart(
			sunburst.create({ ...common, radius: 3, tooltip: true }),
		);
		expect(t.names()).toContain("c / c2: 6");
	});
});

describe("circlePack", () => {
	it("nests circles inside the root, leaf areas proportional to value", () => {
		const scene = show(
			circlePack.create({
				...common,
				radius: 2,
				center: { x: 1, y: 0 },
				padding: 0,
			}),
		);
		const all = items(scene);
		expect(all).toHaveLength(8);
		expect(scene.marks()[0]?.shape.kind).toBe("circle");
		const root = boxOfItem(all[0] as (typeof all)[number]);
		expect((root.minX + root.maxX) / 2).toBeCloseTo(1, 6);
		expect(root.maxX - root.minX).toBeCloseTo(4, 3);
		for (const item of all.slice(1)) {
			const b = boxOfItem(item);
			expect(b.minX).toBeGreaterThanOrEqual(root.minX - 1e-6);
			expect(b.maxX).toBeLessThanOrEqual(root.maxX + 1e-6);
		}
		// a1 (4) and a2 (2): radius ratio √2.
		expect((all[2]?.radius as number) / (all[3]?.radius as number)).toBeCloseTo(
			Math.SQRT2,
			3,
		);
	});

	it("grows circles from their centres, parents first", () => {
		expect(
			items(show(circlePack.create({ ...common, radius: 2, progress: 0 }))),
		).toHaveLength(0);
		const full = items(show(circlePack.create({ ...common, radius: 2 })));
		const half = items(
			show(circlePack.create({ ...common, radius: 2, progress: 0.5 })),
		);
		// Root and the three depth-1 circles; the leaves below have not started.
		expect(half).toHaveLength(4);
		expect(half[0]?.radius).toBeCloseTo(full[0]?.radius as number, 6);
		expect(half[1]?.radius).toBeCloseTo((full[1]?.radius as number) / 2, 6);
		expect(half[1]?.center.x).toBeCloseTo(full[1]?.center.x as number, 6);
	});

	it("labels leaves that fit", () => {
		const scene = show(circlePack.create({ ...common, radius: 3 }));
		expect(texts(scene)).toContain("c2");
		expect(texts(scene)).not.toContain("root");
		expect(drawn(scene)).toHaveLength(8);
	});
});

describe("drill-down (focus)", () => {
	it("icicle: the focused node spans the breadth at the root side", () => {
		const all = boxes(
			show(
				icicle.create({
					...common,
					width: 6,
					height: 3,
					inset: 0,
					focus: ["a"],
				}),
			),
		);
		expect(all).toHaveLength(3);
		const [a, a1, a2] = all as [
			(typeof all)[0],
			(typeof all)[0],
			(typeof all)[0],
		];
		// a: the first band of two, the whole height.
		expect(a.minX).toBeCloseTo(-3, 9);
		expect(a.maxX).toBeCloseTo(0, 9);
		expect(a.maxY - a.minY).toBeCloseTo(3, 9);
		// a1 and a2 share the second band, 4 : 2.
		expect(a1.minX).toBeCloseTo(0, 9);
		expect(a1.maxX).toBeCloseTo(3, 9);
		expect(a1.maxY - a1.minY).toBeCloseTo(2, 9);
		expect(a2.maxY - a2.minY).toBeCloseTo(1, 9);
	});

	it("icicle: root false with no focus keeps its layout", () => {
		const all = boxes(
			show(
				icicle.create({
					...common,
					width: 6,
					height: 3,
					inset: 0,
					root: false,
				}),
			),
		);
		expect(all).toHaveLength(7);
		// Two levels left: a spans the first half.
		expect(all[0]?.minX).toBeCloseTo(-3, 9);
		expect(all[0]?.maxX).toBeCloseTo(0, 9);
	});

	it("sunburst: the focused node becomes the centre disc, its children the whole turn", () => {
		const scene = show(
			sunburst.create({
				...common,
				radius: 3,
				focus: (d: Node) => d.name === "c",
			}),
		);
		const all = boxes(scene);
		expect(all).toHaveLength(3);
		const [c, c1, c2] = all as [
			(typeof all)[0],
			(typeof all)[0],
			(typeof all)[0],
		];
		// c's ring (1/3..2/3 of r) becomes a disc of radius r/2.
		expect(c.maxX - c.minX).toBeCloseTo(3, 2);
		// Its children fill out to r, round the whole turn between them.
		expect(Math.max(c1.maxY, c2.maxY)).toBeCloseTo(3, 2);
		expect(Math.min(c1.minX, c2.minX)).toBeCloseTo(-3, 1);
		expect(texts(scene)).toContain("c");
	});

	it("a path that stops matching zooms as far as it got", () => {
		const partial = show(
			icicle.create({
				...common,
				width: 6,
				height: 3,
				inset: 0,
				focus: ["a", "zz"],
			}),
		);
		expect(drawn(partial)).toHaveLength(3);
		const none = show(
			icicle.create({
				...common,
				width: 6,
				height: 3,
				inset: 0,
				focus: ["zz"],
			}),
		);
		expect(drawn(none)).toHaveLength(8);
	});
});

describe("updates in place", () => {
	it("scrubs progress, size, data and zoom on mounted charts without errors", () => {
		const charts: SceneNode[] = [
			treemap.create({
				...common,
				width: 4,
				height: 2,
				tooltip: true,
				progress: 0,
			}),
			icicle.create({
				...common,
				width: 4,
				height: 2,
				tooltip: true,
				progress: 0,
			}),
			sunburst.create({ ...common, radius: 2, tooltip: true, progress: 0 }),
			circlePack.create({ ...common, radius: 2, tooltip: true, progress: 0 }),
			treemap.create({
				...common,
				width: 4,
				height: 2,
				focus: { from: [], to: ["a"], t: 0 },
			}),
			icicle.create({
				...common,
				width: 4,
				height: 2,
				focus: { from: ["c"], to: [], t: 0 },
			}),
			sunburst.create({
				...common,
				radius: 2,
				focus: { from: [], to: ["c"], t: 0 },
			}),
		];
		const scene = mount(...charts);
		const zoomed = charts.slice(4);
		for (const z of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.6, 0]) {
			zoomed[0]?.set("focus" as never, { from: [], to: ["a"], t: z } as never);
			zoomed[1]?.set("focus" as never, { from: ["c"], to: [], t: z } as never);
			zoomed[2]?.set("focus" as never, { from: [], to: ["c"], t: z } as never);
			scene.commit();
		}
		for (const p of [0.2, 0.5, 0.8, 1, 0.4, 0, 1]) {
			for (const chart of charts.slice(0, 4))
				chart.set("progress" as never, p as never);
			scene.commit();
		}
		for (const chart of charts)
			chart.set(
				"data" as never,
				{ name: "other", children: [{ name: "x", size: 1 }] } as never,
			);
		scene.commit();
		expect(items(scene).length).toBeGreaterThan(0);
	});

	it("a progress frame keeps the layout: unchanged tiles keep their place", () => {
		const chart = treemap.create({
			...common,
			width: 4,
			height: 2,
			progress: 1,
		});
		const scene = mount(chart);
		const before = boxes(scene);
		chart.set("progress" as never, 0.99 as never);
		scene.commit();
		chart.set("progress" as never, 1 as never);
		scene.commit();
		expect(boxes(scene)).toEqual(before);
	});
});

describe("keyed tree transitions", () => {
	const next: Node = {
		name: "root",
		children: [
			{
				name: "a",
				children: [
					{ name: "a1", size: 1 },
					{ name: "a2", size: 2 },
					{ name: "a3", size: 5 },
				],
			},
			{ name: "b", size: 3 },
		],
	};
	const sorted = (scene: Scene) =>
		boxes(scene)
			.map((b) =>
				[b.minX, b.minY, b.maxX, b.maxY].map((v) => (v + 0).toFixed(9)),
			)
			.sort((p, q) => p.join().localeCompare(q.join()));

	it("draws `data` at blend 0 and `to` at blend 1, for every hierarchy chart", () => {
		const charts = [
			(extra: object) =>
				treemap.create({ ...common, width: 8, height: 4, ...extra }),
			(extra: object) =>
				icicle.create({ ...common, width: 6, height: 3, ...extra }),
			(extra: object) => sunburst.create({ ...common, radius: 3, ...extra }),
			(extra: object) => circlePack.create({ ...common, radius: 3, ...extra }),
		];
		for (const chart of charts) {
			expect(sorted(show(chart({ to: next, blend: 0 })))).toEqual(
				sorted(show(chart({}))),
			);
			expect(sorted(show(chart({ to: next, blend: 1 })))).toEqual(
				sorted(show(chart({ data: next }))),
			);
		}
	});

	it("fades the old tree's nodes out, moves the matched ones, fades the new ones in", () => {
		const at = (blend: number) =>
			show(
				icicle.create({
					...common,
					width: 6,
					height: 3,
					inset: 0,
					to: next,
					blend,
				}),
			);
		// Exit stage: c's subtree (c, c1, c2) fades out; a3 is not in yet.
		const exiting = at(1 / 6);
		expect(
			items(exiting).filter((item) => item.alpha > 0 && item.alpha < 1),
		).toHaveLength(3);
		expect(texts(exiting)).not.toContain("a3");
		expect(texts(exiting)).toContain("c");
		// Enter stage: a3 fades in at its new place.
		const entering = at(5 / 6);
		expect(
			items(entering).filter((item) => item.alpha > 0 && item.alpha < 1),
		).toHaveLength(1);
	});

	it("keeps each node's item across a blend scrub (keyed by its path)", () => {
		const chart = icicle.create({
			...common,
			width: 6,
			height: 3,
			to: next,
			blend: 0,
			tooltip: true,
		});
		const t = mountChart(chart);
		for (const blend of [0.2, 0.5, 0.8, 1]) {
			chart.set("blend" as never, blend as never);
			t.scene.commit();
		}
		expect(t.names()).toContain("a / a3: 5");
		expect(labels(t.scene).map((l) => l.text)).toContain("a3");
	});

	it("drill-down focus resolves in the union tree", () => {
		const scene = show(
			icicle.create({
				...common,
				width: 6,
				height: 3,
				inset: 0,
				to: next,
				blend: 1,
				focus: ["a"],
			}),
		);
		// a, a1, a2, a3.
		expect(drawn(scene)).toHaveLength(4);
	});
});
