/**
 * Hierarchy interaction: tap-to-drill on
 * `treemap`, `icicle`, `sunburst`, `circlePack` and `tree` (uncontrolled and
 * controlled), the `createDrillDown` tween, keys, reduced motion,
 * breadcrumbs and the `circlePack` zoom. Taps are delivered the way the
 * pointer driver and the accessibility layer deliver them to a batched
 * node: its `onTap` with `event.item` (Enter and Space on the walked item
 * call exactly that handler).
 *
 * A chart's nodes are one batched node whose items the keys walk, so the
 * "tab stops" cases check the item list's names.
 */

import type { SceneNode } from "@sophistry/core";
import {
	createClock,
	group,
	reducedMotionContext,
	track,
} from "@sophistry/core";
import { describe, expect, it, vi } from "vitest";
import { partitionLayout, treemapLayout, treemapRows } from "../math/hierarchy";
import { mount } from "../test-harness";
import { breadcrumbs } from "./breadcrumbs";
import { circlePack } from "./circle-pack";
import type { DrillDown } from "./drill";
import { createDrillDown } from "./drill";
import { icicle } from "./icicle";
import { drillTarget } from "./shared";
import { sunburst } from "./sunburst";
import type { Scene } from "./test-helpers";
import {
	boxes,
	descendants,
	drawn,
	labels,
	mountChart,
	press,
	texts,
} from "./test-helpers";
import { tree as treeChart } from "./tree";
import { treemap } from "./treemap";

/** Counts the treemap layout calls, to check a blend scrub lays out nothing. */
const calls = vi.hoisted(() => ({ rows: 0, layout: 0 }));
vi.mock("../math/hierarchy", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../math/hierarchy")>();
	return {
		...actual,
		treemapRows: ((...args: Parameters<typeof actual.treemapRows>) => {
			calls.rows++;
			return actual.treemapRows(...args);
		}) as typeof actual.treemapRows,
		treemapLayout: ((...args: Parameters<typeof actual.treemapLayout>) => {
			calls.layout++;
			return actual.treemapLayout(...args);
		}) as typeof actual.treemapLayout,
	};
});

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

const common = {
	data: tree,
	value: "size",
	label: "name",
	sort: false,
};

/** The label nodes of a mounted chart with interaction, by accessible name. */
function crumb(root: SceneNode, name: string) {
	const found = descendants(root).find(
		(node) =>
			node.type === "Label" &&
			(node as SceneNode<{ label?: string }>).get("label") === name,
	);
	if (!found) throw new Error(`no crumb ${name}`);
	return found as SceneNode<{
		onTap?: (event: never) => void;
		keyboard?: { key?: (event: KeyboardEvent) => boolean; shortcuts?: string };
		focusable?: boolean;
		label?: string;
		cursor?: string;
	}>;
}

/** Taps a crumb (or a tree's name) by accessible name, and commits. */
function tapCrumb(root: SceneNode, scene: Scene, name: string) {
	const onTap = crumb(root, name).get("onTap");
	if (!onTap) throw new Error(`${name} has no tap`);
	onTap({} as never);
	scene.commit();
}

/** The crumbs that are tab stops, by accessible name. */
function crumbStops(root: SceneNode): string[] {
	return descendants(root)
		.filter(
			(node) =>
				node.type === "Label" &&
				(node as SceneNode<{ focusable?: boolean }>).get("focusable") === true,
		)
		.map(
			(node) => (node as SceneNode<{ label?: string }>).get("label") as string,
		);
}

describe("drillTarget", () => {
	const nodes = partitionLayout(tree, {
		value: (d) => d.size ?? 0,
		label: (d) => d.name,
		sort: false,
	});
	const at = (name: string) => nodes.findIndex((n) => n.label === name);

	it("zooms into a parent, a leaf's parent, and out of the focus", () => {
		expect(drillTarget(nodes, 0, at("a"))).toBe(at("a"));
		expect(drillTarget(nodes, 0, at("c2"))).toBe(at("c"));
		expect(drillTarget(nodes, at("a"), at("a"))).toBe(0);
	});

	it("goes nowhere from the root, or from a leaf right under the focus", () => {
		expect(drillTarget(nodes, 0, 0)).toBe(-1);
		expect(drillTarget(nodes, 0, at("b"))).toBe(-1);
		expect(drillTarget(nodes, at("a"), at("a1"))).toBe(-1);
		expect(drillTarget(nodes, 0, 99)).toBe(-1);
	});
});

describe("uncontrolled drill-down", () => {
	it("a tap on a leaf zooms to its group, tweened, ending exactly on that focus", () => {
		const t = mountChart(
			treemap.create({ ...common, width: 8, height: 4, drill: true }),
		);
		const still = mount(
			treemap.create({ ...common, width: 8, height: 4, focus: ["a"] }),
		);
		expect(drawn(t.scene)).toHaveLength(7);
		t.tap("a / a1: 4");
		t.step(0.375);
		// Mid-zoom: b is fading as it slides out; a is growing.
		const fading = drawn(t.scene).find(
			(item) => Math.abs(item.alpha - 0.5) < 0.4,
		);
		expect(fading).toBeDefined();
		t.step(0.5);
		expect(boxes(t.scene)).toEqual(boxes(still));
	});

	it("a tap on the focused node zooms back out", () => {
		const t = mountChart(
			icicle.create({
				...common,
				width: 6,
				height: 3,
				drill: { duration: 0.5 },
			}),
		);
		const start = boxes(t.scene);
		t.tap("c: 7");
		t.step(0.6);
		expect(drawn(t.scene)).toHaveLength(3);
		t.tap("c: 7");
		t.step(0.6);
		expect(boxes(t.scene)).toEqual(start);
	});

	it("starts at defaultFocus", () => {
		const t = mountChart(
			sunburst.create({
				...common,
				radius: 3,
				drill: true,
				defaultFocus: ["c"],
			}),
		);
		expect(drawn(t.scene)).toHaveLength(3);
	});

	it("where a tap goes nowhere, it toggles the tooltip instead", () => {
		const t = mountChart(
			sunburst.create({ ...common, radius: 3, drill: true, tooltip: true }),
		);
		t.tap("b: 3");
		expect(t.tip()).toBe("b: 3");
		t.tap("b: 3");
		expect(t.tip()).toBeNull();
		// A tap that drills closes an open tooltip.
		t.tap("root: 16");
		expect(t.tip()).toBe("root: 16");
		t.tap("a: 6");
		expect(t.tip()).toBeNull();
	});

	it("hover opens no tooltip while the view is moving", () => {
		const t = mountChart(
			circlePack.create({ ...common, radius: 3, drill: true, tooltip: true }),
		);
		t.tap("a: 6");
		t.step(0.3);
		t.hover("a / a1: 4");
		expect(t.tip()).toBeNull();
		t.step(1);
		t.hover("a / a1: 4");
		expect(t.tip()).toBe("a / a1: 4");
	});

	it("onFocusChange alone turns drilling on, and is told", () => {
		const seen: [string[], string][] = [];
		const t = mountChart(
			sunburst.create({
				...common,
				radius: 3,
				onFocusChange: (path: string[], d: Node) => seen.push([path, d.name]),
			}),
		);
		t.tap("c / c1: 1");
		t.step(1);
		expect(seen).toEqual([[["c"], "c"]]);
		expect(drawn(t.scene)).toHaveLength(3);
	});

	it("registers no taps or item names when drilling and tooltips are off", () => {
		const t = mountChart(treemap.create({ ...common, width: 8, height: 4 }));
		expect(t.handlers()).toEqual({});
	});
});

describe("controlled drill-down", () => {
	it("a tap only asks: onFocusChange gets the path and datum, the view stays", () => {
		const asked: [string[], Node][] = [];
		const t = mountChart(
			icicle.create({
				...common,
				width: 6,
				height: 3,
				focus: [],
				onFocusChange: (path: string[], d: Node) => asked.push([path, d]),
			}),
		);
		const before = boxes(t.scene);
		t.tap("c / c2: 6");
		t.step(1);
		expect(asked).toEqual([[["c"], tree.children?.[2]]]);
		expect(boxes(t.scene)).toEqual(before);
	});

	it("createDrillDown tweens it; an interrupted zoom carries on from where the view was", () => {
		const chart = icicle.create({ ...common, width: 6, height: 3, focus: [] });
		const t = mountChart(chart);
		// On the scene's clock, bound to the chart's focus.
		const own: DrillDown = createDrillDown({
			duration: 1,
			clock: t.scene.clock,
		});
		chart.set("focus" as never, own.focus as never);
		chart.set(
			"onFocusChange" as never,
			((path: string[]) => void own.zoomTo(path)) as never,
		);
		t.scene.commit();
		const toC = mount(
			icicle.create({ ...common, width: 6, height: 3, focus: ["c"] }),
		);
		t.tap("a: 6");
		expect(own.path.peek()).toEqual(["a"]);
		t.step(0.4);
		const midway = boxes(t.scene);
		// Interrupt: the view must not jump.
		void own.zoomTo(["c"]);
		t.scene.commit();
		expect(boxes(t.scene)).toEqual(midway);
		expect(own.focus.peek()).toMatchObject({
			from: { from: [], to: ["a"] },
			to: ["c"],
			t: 0,
		});
		t.step(1);
		expect(boxes(t.scene)).toEqual(boxes(toC));
		// Scrubbing the track replays the zoom, a pure function of t.
		own.t.set(0);
		t.scene.commit();
		expect(boxes(t.scene)).toEqual(midway);
		own.t.set(1);
		t.scene.commit();
		expect(boxes(t.scene)).toEqual(boxes(toC));
	});

	it("zoomTo where it already is does nothing; zoomOut goes up a level", async () => {
		const clock = createClock({ reducedMotion: "no-preference" });
		const zoom = createDrillDown({ initial: ["a"], clock });
		expect(await zoom.zoomTo(["a"])).toBe("done");
		expect(zoom.focus.peek()).toEqual(["a"]);
		const out = zoom.zoomOut();
		clock.advance(1);
		expect(await out).toBe("done");
		expect(zoom.focus.peek()).toEqual([]);
	});
});

describe("keyboard and accessibility", () => {
	it("the chart is one item list; drilling names every drawn node and shows a pointer", () => {
		const t = mountChart(
			treemap.create({ ...common, width: 8, height: 4, drill: true }),
		);
		expect(t.names()).toEqual([
			"a: 6",
			"a / a1: 4",
			"a / a2: 2",
			"b: 3",
			"c: 7",
			"c / c1: 1",
			"c / c2: 6",
		]);
		expect(t.handlers().label).toBe("Treemap, 7 tiles");
		// Enter on the walked item calls onTap, as a tap does.
		t.tap("a: 6");
		t.step(1);
		expect(t.names()).toEqual(["a: 6", "a / a1: 4", "a / a2: 2"]);
		expect(t.handlers().cursor).toBe("pointer");
	});

	it("without drill, tooltips still name every node, with no pointer", () => {
		const t = mountChart(
			treemap.create({ ...common, width: 8, height: 4, tooltip: true }),
		);
		expect(t.names()).toHaveLength(7);
		expect(t.handlers().cursor).toBeUndefined();
	});
});

describe("reduced motion", () => {
	it("the zoom jumps to its end", () => {
		const chart = sunburst.create({ ...common, radius: 3, drill: true });
		const reduced = group.create({});
		reduced.provide(reducedMotionContext, track(true));
		reduced.add(chart);
		const t = mountChart(reduced);
		const still = mount(
			sunburst.create({ ...common, radius: 3, focus: ["a"] }),
		);
		t.tap("a: 6");
		t.step(0);
		expect(boxes(t.scene)).toEqual(boxes(still));
	});
});

describe("breadcrumbs", () => {
	it("draws the trail and selects an earlier crumb's path", () => {
		const selected: string[][] = [];
		const trail = breadcrumbs.create({
			path: ["src", "charts"],
			root: "repo",
			onSelect: (path) => selected.push(path),
		});
		const scene = mount(trail);
		expect(texts(scene)).toEqual(["repo", "›", "src", "›", "charts"]);
		const xs = labels(scene)
			.filter((l) => l.text !== "›")
			.map((l) => l.at.x);
		expect(xs[0]).toBeLessThan(xs[1] as number);
		expect(xs[1]).toBeLessThan(xs[2] as number);
		// The current crumb is not a stop; the others are.
		expect(crumbStops(trail)).toEqual(["repo", "src"]);
		tapCrumb(trail, scene, "src");
		tapCrumb(trail, scene, "repo");
		expect(selected).toEqual([["src"], []]);
	});

	it("cross-fades the crumbs of a transition", () => {
		const trail = breadcrumbs.create({
			path: { from: ["a"], to: ["b"], t: 0.25 },
		});
		const scene = mount(trail);
		const opacity = (text: string) =>
			labels(scene).find((l) => l.text === text)?.style.opacity;
		expect(opacity("All")).toBeCloseTo(1, 9);
		expect(opacity("a")).toBeCloseTo(0.75, 9);
		expect(opacity("b")).toBeCloseTo(0.25, 9);
		// Without onSelect nothing is interactive.
		expect(
			descendants(trail).filter(
				(n) =>
					n.type === "Label" &&
					(n as SceneNode<{ onTap?: unknown }>).get("onTap"),
			),
		).toHaveLength(0);
	});

	it("a chart's own breadcrumbs follow its zoom and zoom it back out", () => {
		const chart = treemap.create({
			...common,
			width: 8,
			height: 4,
			drill: true,
			breadcrumbs: true,
		});
		const t = mountChart(chart);
		expect(texts(t.scene)).toContain("root");
		t.tap("c / c2: 6");
		t.step(1);
		expect(texts(t.scene)).toContain("›");
		expect(drawn(t.scene)).toHaveLength(3);
		tapCrumb(chart, t.scene, "root");
		t.step(1);
		expect(drawn(t.scene)).toHaveLength(7);
		expect(texts(t.scene)).not.toContain("›");
	});

	it("a controlled chart's crumbs ask through onFocusChange", () => {
		const asked: string[][] = [];
		const chart = icicle.create({
			...common,
			width: 6,
			height: 3,
			focus: (d: Node) => d.name === "a",
			onFocusChange: (path: string[]) => asked.push(path),
			breadcrumbs: { root: "top" },
		});
		const t = mountChart(chart);
		expect(texts(t.scene)).toEqual(expect.arrayContaining(["top", "a"]));
		tapCrumb(chart, t.scene, "top");
		expect(asked).toEqual([[]]);
	});
});

describe("circlePack zoom", () => {
	it("the focused circle fills the root's, the rest clipped and faded", () => {
		const plain = mount(circlePack.create({ ...common, radius: 3 }));
		expect(plain.marks().every((s) => s.clip === undefined)).toBe(true);
		const zoomed = mount(
			circlePack.create({ ...common, radius: 3, focus: ["c"] }),
		);
		const circles = drawn(zoomed);
		// c, c1, c2.
		expect(circles).toHaveLength(3);
		const c = circles[0] as (typeof circles)[number];
		expect(c.radius).toBeCloseTo(3, 1);
		expect(c.center.x).toBeCloseTo(0, 1);
		expect(c.center.y).toBeCloseTo(0, 1);
		expect(zoomed.marks().every((s) => s.clip !== undefined)).toBe(true);
	});

	it("zooms along a smooth path that is a pure function of t", () => {
		const at = (t: number) =>
			mount(
				circlePack.create({
					...common,
					radius: 3,
					focus: { from: [], to: ["a"], t },
				}),
			);
		const plain = mount(circlePack.create({ ...common, radius: 3 }));
		expect(boxes(at(0))).toEqual(boxes(plain));
		const still = mount(
			circlePack.create({ ...common, radius: 3, focus: ["a"] }),
		);
		expect(boxes(at(1))).toEqual(boxes(still));
		const mid = at(0.5);
		const radius = drawn(mid)[1]?.radius as number; // a
		expect(radius).toBeGreaterThan(drawn(plain)[1]?.radius as number);
		expect(radius).toBeLessThan(3);
		expect(boxes(at(0.5))).toEqual(boxes(mid));
	});

	it("drills on tap, and the focused circle's background zooms out", () => {
		const t = mountChart(
			circlePack.create({ ...common, radius: 3, drill: true }),
		);
		t.tap("a / a2: 2");
		t.step(1);
		expect(drawn(t.scene)).toHaveLength(3);
		t.tap("a: 6");
		t.step(1);
		expect(drawn(t.scene)).toHaveLength(8);
	});
});

describe("tree focus and drill", () => {
	const treeProps = { ...common, width: 8, height: 4, nodeRadius: 0.1 };
	const dots = (scene: Scene) =>
		drawn(scene).filter((item) => item.spec.shape.kind === "circle");
	const linksOf = (scene: Scene) =>
		drawn(scene).filter((item) => item.spec.shape.kind === "paths");
	const centres = (scene: Scene) => dots(scene).map((item) => item.center);

	it("focus spreads the subtree over the box and fades the rest", () => {
		const plain = mount(treeChart.create(treeProps));
		const zoomed = mount(treeChart.create({ ...treeProps, focus: ["c"] }));
		// c, c1, c2 are left; their links from c, not c's own from the root.
		expect(dots(zoomed)).toHaveLength(3);
		expect(linksOf(zoomed)).toHaveLength(2);
		const [c, c1, c2] = centres(zoomed) as [
			{ x: number; y: number },
			{ x: number; y: number },
			{ x: number; y: number },
		];
		const before = centres(plain);
		// The focus stands at the root side, as the root did (with room for its
		// own, shorter name), its children at the leaf side.
		expect(c.x).toBeLessThan(-3);
		expect(c.x).toBeLessThan((before[0]?.x as number) + 0.5);
		expect(c1.x).toBeGreaterThan(c.x + 3);
		// Its children spread over more of the box than they had.
		const spread = (a: { y: number }, b: { y: number }) => Math.abs(a.y - b.y);
		expect(spread(c1, c2)).toBeGreaterThan(
			spread(before[6] as { y: number }, before[7] as { y: number }) * 2,
		);
		for (const p of [c, c1, c2]) {
			expect(p.x).toBeGreaterThanOrEqual(-4);
			expect(p.x).toBeLessThanOrEqual(4);
			expect(p.y).toBeGreaterThanOrEqual(-2);
			expect(p.y).toBeLessThanOrEqual(2);
		}
		// Names are refitted: the leaves' names still fit inside the box.
		expect(texts(zoomed)).toEqual(expect.arrayContaining(["c1", "c2"]));
	});

	it("a { from, to, t } focus is a pure function of t, exact at both ends", () => {
		const at = (t: number) =>
			mount(
				treeChart.create({ ...treeProps, focus: { from: [], to: ["a"], t } }),
			);
		const plain = mount(treeChart.create(treeProps));
		const still = mount(treeChart.create({ ...treeProps, focus: ["a"] }));
		expect(boxes(at(0))).toEqual(boxes(plain));
		expect(boxes(at(1))).toEqual(boxes(still));
		expect(boxes(at(0.4))).toEqual(boxes(at(0.4)));
	});

	it("drills on tap: a parent zooms in, the focus zooms back out", () => {
		const t = mountChart(treeChart.create({ ...treeProps, drill: true }));
		const start = boxes(t.scene);
		const still = mount(treeChart.create({ ...treeProps, focus: ["c"] }));
		t.tap("c / c1: 1");
		t.step(1);
		expect(boxes(t.scene)).toEqual(boxes(still));
		expect(t.names()).toEqual(["c: 7", "c / c1: 1", "c / c2: 6"]);
		t.tap("c: 7");
		t.step(1);
		expect(boxes(t.scene)).toEqual(start);
	});

	it("draws breadcrumbs that zoom it back out, radially too", () => {
		const chart = treeChart.create({
			...treeProps,
			orientation: "radial",
			drill: true,
			breadcrumbs: { root: "top" },
		});
		const t = mountChart(chart);
		t.tap("a: 6");
		t.step(1);
		expect(texts(t.scene)).toEqual(expect.arrayContaining(["top", "›", "a"]));
		// Radially the focus moves to the centre.
		const centre = centres(t.scene)[0] as { x: number; y: number };
		expect(centre.x).toBeCloseTo(0, 6);
		expect(centre.y).toBeCloseTo(0, 6);
		tapCrumb(chart, t.scene, "top");
		t.step(1);
		expect(dots(t.scene)).toHaveLength(8);
	});
});

describe("breadcrumb truncation and back", () => {
	const deep: Node = {
		name: "repo",
		children: [
			{
				name: "packages",
				children: [
					{
						name: "sophistry",
						children: [
							{
								name: "charts",
								children: [
									{ name: "Tree", size: 3 },
									{ name: "Pie", size: 2 },
								],
							},
							{ name: "scene", size: 4 },
						],
					},
					{ name: "docs", size: 3 },
				],
			},
			{ name: "tests", size: 2 },
		],
	};

	it("collapses a deep trail's middle and the ellipsis climbs to what it hides", () => {
		const selected: string[][] = [];
		const trail = breadcrumbs.create({
			path: ["packages", "sophistry", "charts", "Tree"],
			root: "repo",
			maxWidth: 3,
			onSelect: (path) => selected.push(path),
		});
		const scene = mount(trail);
		const shown = texts(scene).filter((text) => text !== "›");
		expect(shown[0]).toBe("repo");
		expect(shown).toContain("…");
		expect(shown.at(-1)).toBe("Tree");
		expect(shown).not.toContain("packages");
		// The ellipsis is a stop, named by the deepest crumb it hides.
		const hidden = crumbStops(trail).filter((stop) => stop !== "repo");
		expect(hidden.length).toBeGreaterThan(0);
		tapCrumb(trail, scene, hidden[0] as string);
		expect(selected[0]?.length).toBeGreaterThan(0);
		expect(selected[0]).not.toContain("Tree");
	});

	it("a chart's own trail collapses past the chart's width by default", () => {
		const narrow = mount(
			treemap.create({
				...common,
				data: deep,
				width: 3,
				height: 3,
				focus: ["packages", "sophistry", "charts"],
				onFocusChange: () => {},
				breadcrumbs: true,
			}),
		);
		expect(texts(narrow)).toContain("…");
		const wide = mount(
			treemap.create({
				...common,
				data: deep,
				width: 3,
				height: 3,
				focus: ["packages", "sophistry", "charts"],
				breadcrumbs: { maxWidth: false },
			}),
		);
		expect(texts(wide)).not.toContain("…");
		expect(texts(wide)).toContain("packages");
	});

	it("the back control asks for the parent and fades out at the root", () => {
		const selected: string[][] = [];
		const path = track<readonly string[]>(["src", "charts"]);
		const trail = breadcrumbs.create({
			path,
			root: "repo",
			back: true,
			onSelect: (p) => selected.push(p),
		});
		const scene = mount(trail);
		expect(texts(scene)[0]).toBe("←");
		expect(crumbStops(trail)).toEqual(["Back to src", "repo", "src"]);
		tapCrumb(trail, scene, "Back to src");
		expect(selected).toEqual([["src"]]);
		path.set([]);
		scene.commit();
		expect(texts(scene)).not.toContain("←");
		expect(crumbStops(trail)).toEqual([]);
	});

	it("a chart's back control zooms out one level", () => {
		const chart = treemap.create({
			...common,
			width: 8,
			height: 4,
			drill: true,
			breadcrumbs: { back: "Up" },
		});
		const t = mountChart(chart);
		expect(texts(t.scene)).not.toContain("Up");
		t.tap("c / c2: 6");
		t.step(1);
		expect(drawn(t.scene)).toHaveLength(3);
		tapCrumb(chart, t.scene, "Back to root");
		t.step(1);
		expect(drawn(t.scene)).toHaveLength(7);
	});
});

describe("interaction follows its props", () => {
	it("turning drill on later reaches every node, and off again removes it", () => {
		const chart = treemap.create({ ...common, width: 8, height: 4 });
		const t = mountChart(chart);
		expect(t.handlers()).toEqual({});
		chart.set("drill" as never, true as never);
		t.scene.commit();
		expect(t.names()).toHaveLength(7);
		t.tap("a: 6");
		t.step(1);
		expect(drawn(t.scene)).toHaveLength(3);
		chart.set("drill" as never, false as never);
		t.scene.commit();
		expect(t.handlers()).toEqual({});
	});

	it("turning tooltip on later gives every node its tooltip", () => {
		const chart = sunburst.create({ ...common, radius: 3 });
		const t = mountChart(chart);
		chart.set("tooltip" as never, true as never);
		t.scene.commit();
		t.tap("b: 3");
		expect(t.tip()).toBe("b: 3");
	});

	it("a tooltip opened over a still view closes when a scrubbed focus moves on", () => {
		const chart = icicle.create({
			...common,
			width: 6,
			height: 3,
			tooltip: true,
			focus: { from: [], to: ["a"], t: 0 },
		});
		const t = mountChart(chart);
		t.hover("b: 3");
		expect(t.tip()).toBe("b: 3");
		chart.set("focus" as never, { from: [], to: ["a"], t: 0.3 } as never);
		t.scene.commit();
		expect(t.tip()).toBeNull();
	});

	it("and when a scrubbed blend moves on", () => {
		const next: Node = {
			...tree,
			children: [...(tree.children ?? []), { name: "d", size: 2 }],
		};
		const chart = treemap.create({
			...common,
			width: 8,
			height: 4,
			tooltip: true,
			to: next,
			blend: 0,
		});
		const t = mountChart(chart);
		t.tap("b: 3");
		expect(t.tip()).toBe("b: 3");
		chart.set("blend" as never, 0.5 as never);
		t.scene.commit();
		expect(t.tip()).toBeNull();
	});
});

describe("treemap resquarify transitions", () => {
	type Flat = { name: string; size?: number; children?: Flat[] };
	const flat = (sizes: Record<string, number>): Flat => ({
		name: "root",
		children: Object.entries(sizes).map(([name, size]) => ({ name, size })),
	});
	const before = flat({ a: 6, b: 6, c: 4, d: 3, e: 2, f: 2, g: 1 });
	const after = flat({ a: 1, b: 2, c: 2, d: 3, e: 4, f: 6, g: 6 });
	const props = {
		data: before,
		to: after,
		value: "size",
		label: "name",
		width: 6,
		height: 4,
		padding: 0,
	};
	const overlap = (
		a: ReturnType<typeof boxes>[number],
		b: ReturnType<typeof boxes>[number],
	) =>
		Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-6 &&
		Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 1e-6;

	it("starts at data's squarify and ends in data's rows with to's values", () => {
		const at = (blend: number) =>
			mount(treemap.create({ ...props, tile: "resquarify", blend }));
		const plain = mount(treemap.create({ ...props, to: undefined }));
		expect(boxes(at(0))).toEqual(boxes(plain));
		// The end is `to` laid out in `data`'s rows, not a fresh squarify.
		const end = boxes(at(1));
		const fresh = boxes(
			mount(treemap.create({ ...props, data: after, to: undefined })),
		);
		expect(end).not.toEqual(fresh);
		const options = {
			value: (d: Flat) => d.size ?? 0,
			label: (d: Flat) => d.name,
			width: 6,
			height: 4,
		};
		const kept = treemapLayout(after, {
			...options,
			keepRows: treemapRows(before, options),
		}).filter((n) => n.leaf);
		expect(end).toHaveLength(kept.length);
		const areas = end
			.map((b) => (b.maxX - b.minX) * (b.maxY - b.minY))
			.sort((p, q) => p - q);
		const keptAreas = kept
			.map((n) => (n.x1 - n.x0) * (n.y1 - n.y0))
			.sort((p, q) => p - q);
		areas.forEach((value, i) => {
			expect(value).toBeCloseTo(keptAreas[i] as number, 6);
		});
	});

	it("never crosses tiles mid-way, where plain squarify does", () => {
		const crossings = (list: ReturnType<typeof boxes>) => {
			let count = 0;
			for (let i = 0; i < list.length; i++)
				for (let j = i + 1; j < list.length; j++)
					if (overlap(list[i] as (typeof list)[0], list[j] as (typeof list)[0]))
						count++;
			return count;
		};
		for (const blend of [0.35, 0.5, 0.65]) {
			expect(
				crossings(
					boxes(mount(treemap.create({ ...props, tile: "resquarify", blend }))),
				),
			).toBe(0);
		}
		expect(
			crossings(boxes(mount(treemap.create({ ...props, blend: 0.5 })))),
		).toBeGreaterThan(0);
	});

	it("lays the rows out once while the blend scrubs", () => {
		const chart = treemap.create({
			...props,
			tile: "resquarify",
			blend: 0,
			tooltip: true,
		});
		const scene = mount(chart);
		calls.rows = 0;
		calls.layout = 0;
		for (const blend of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.4, 0]) {
			chart.set("blend" as never, blend as never);
			scene.commit();
		}
		expect(calls.rows).toBe(0);
		expect(calls.layout).toBe(0);
	});
});

describe("Escape and tree names", () => {
	const charts = {
		treemap: () =>
			treemap.create({ ...common, width: 8, height: 4, drill: true }),
		icicle: () =>
			icicle.create({ ...common, width: 8, height: 4, drill: true }),
		sunburst: () => sunburst.create({ ...common, radius: 3, drill: true }),
		circlePack: () => circlePack.create({ ...common, radius: 3, drill: true }),
		tree: () =>
			treeChart.create({ ...common, width: 8, height: 4, drill: true }),
	};

	for (const [name, build] of Object.entries(charts)) {
		it(`${name}: Escape zooms out one level, and does nothing at the root`, () => {
			const t = mountChart(build());
			const pressEscape = () => {
				const handled = t.handlers().keyboard?.key?.(press("Escape"));
				t.scene.commit();
				return handled;
			};
			const start = t.names();
			expect(pressEscape()).toBe(false);
			t.tap("a: 6");
			t.step(1);
			expect(t.names()).toEqual(["a: 6", "a / a1: 4", "a / a2: 2"]);
			// Other keys are left to the accessibility layer.
			expect(t.handlers().keyboard?.key?.(press("x"))).toBe(false);
			expect(pressEscape()).toBe(true);
			t.step(1);
			expect(t.names()).toEqual(start);
			expect(t.handlers().keyboard?.shortcuts).toBe("Escape");
		});
	}

	it("a controlled chart asks for the parent through onFocusChange", () => {
		const asked: string[][] = [];
		const t = mountChart(
			treemap.create({
				...common,
				width: 8,
				height: 4,
				focus: ["a"],
				onFocusChange: (path: string[]) => asked.push(path),
			}),
		);
		expect(t.handlers().keyboard?.key?.(press("Escape"))).toBe(true);
		expect(asked).toEqual([[]]);
	});

	it("without drill, nodes take no keys", () => {
		const t = mountChart(
			treemap.create({ ...common, width: 8, height: 4, tooltip: true }),
		);
		expect(t.handlers().keyboard).toBeUndefined();
	});

	it("Escape on a breadcrumb climbs one level", () => {
		const chart = icicle.create({
			...common,
			width: 8,
			height: 4,
			drill: true,
			defaultFocus: ["a"],
			breadcrumbs: { root: "top", back: true },
		});
		const t = mountChart(chart);
		expect(crumb(chart, "top").get("keyboard")?.key?.(press("Escape"))).toBe(
			true,
		);
		t.scene.commit();
		t.step(1);
		expect(drawn(t.scene)).toHaveLength(8);
		// At the root there is nowhere to climb.
		expect(t.handlers().keyboard?.key?.(press("Escape"))).toBe(false);
	});

	it("a tree node's name answers the same tap as its dot", () => {
		const chart = treeChart.create({
			...common,
			width: 8,
			height: 4,
			drill: true,
		});
		const t = mountChart(chart);
		const name = descendants(chart).find(
			(node) =>
				node.type === "Label" &&
				(node as SceneNode<{ text?: string }>).get("text") === "c",
		) as SceneNode<{ onTap?: (event: never) => void; pointerEvents?: string }>;
		// Text is hit by its (rotated) box, so the whole name is a target.
		expect(name.get("pointerEvents")).toBe("painted");
		name.get("onTap")?.({} as never);
		t.scene.commit();
		t.step(1);
		expect(t.names()).toEqual(["c: 7", "c / c1: 1", "c / c2: 6"]);
	});

	it("a tree without drill or tooltips registers nothing", () => {
		const chart = treeChart.create({ ...common, width: 8, height: 4 });
		const t = mountChart(chart);
		expect(t.handlers()).toEqual({});
		expect(
			descendants(chart).filter(
				(n) =>
					n.type === "Label" &&
					(n as SceneNode<{ onTap?: unknown }>).get("onTap"),
			),
		).toHaveLength(0);
	});
});
