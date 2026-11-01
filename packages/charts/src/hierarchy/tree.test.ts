/**
 * `tree` mounted: the tidy and cluster layouts in
 * scene units, both orientations, link shapes, labels, the level-by-level
 * reveal, tooltips and keyed transitions. Dots are batched circle items,
 * links path batch items; a link's draw-in is its item's `progress` over
 * the whole polyline, so "partly drawn" here
 * is a link whose reveal is below 1.
 */

import type { Point } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { mount, theme } from "../test-harness.js";
import { textWidth } from "../text-width.js";
import type { Scene } from "./test-helpers.js";
import {
	itemsOf,
	labelOf,
	labels,
	mountChart,
	opaque,
	texts,
} from "./test-helpers.js";
import { tree as treeChart } from "./tree.js";

type Node = { name: string; size?: number; children?: Node[] };

/** Depths: root 0; a, b, c 1; a1, a2, c1, c2 2; c2x, c2y 3. */
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
				{
					name: "c2",
					children: [
						{ name: "c2x", size: 2 },
						{ name: "c2y", size: 4 },
					],
				},
			],
		},
	],
};

const COLORS = ["#ff0000", "#00ff00", "#0000ff"];
const common = {
	data: tree,
	label: "name",
	colors: COLORS,
	depthLighten: 0,
	nodeRadius: 0.1,
};

const show = (extra: Record<string, unknown>) =>
	mount(treeChart.create({ ...common, ...extra } as never));
const dots = (scene: Scene) => itemsOf(scene, "circle");
const links = (scene: Scene) => itemsOf(scene, "paths");
const lineOf = (link: ReturnType<typeof links>[number]) =>
	link.polylines[0] as Point[];
const width = (text: string) => textWidth(text, 0.2, theme.defaults.fontFamily);
/** Links whose reveal is below 1: partly drawn. */
const partial = (scene: Scene) =>
	links(scene).filter((link) => link.reveal < 1);

describe("tree", () => {
	it("draws a dot per node and a link per parent-child pair, inside the box", () => {
		const scene = show({ width: 6, height: 3, labels: false });
		expect(dots(scene)).toHaveLength(10);
		expect(links(scene)).toHaveLength(9);
		for (const dot of dots(scene)) {
			expect(dot.center.x - dot.radius).toBeGreaterThanOrEqual(-3 - 1e-6);
			expect(dot.center.x + dot.radius).toBeLessThanOrEqual(3 + 1e-6);
			expect(dot.center.y - dot.radius).toBeGreaterThanOrEqual(-1.5 - 1e-6);
			expect(dot.center.y + dot.radius).toBeLessThanOrEqual(1.5 + 1e-6);
		}
		// Horizontal: the root at the left edge, the deepest leaves at the right.
		const xs = dots(scene).map((dot) => dot.center.x);
		expect(Math.min(...xs)).toBeCloseTo(-3 + 0.1, 6);
		expect(Math.max(...xs)).toBeCloseTo(3 - 0.1, 6);
		expect(dots(scene)[0]?.radius).toBeCloseTo(0.1, 3);
		// Tidy: four distinct depth columns.
		expect(new Set(xs.map((x) => x.toFixed(6))).size).toBe(4);
	});

	it("colours dots and links by top-level branch", () => {
		const scene = show({ width: 6, height: 3, labels: false });
		const [red, , blue] = COLORS.map(opaque);
		const fills = dots(scene).map((dot) => opaque(dot.fill));
		expect(fills.filter((f) => f === red)).toHaveLength(3); // a, a1, a2
		expect(fills.filter((f) => f === blue)).toHaveLength(5); // c and below
		const strokes = links(scene).map((link) => opaque(link.stroke as string));
		expect(strokes.filter((f) => f === blue)).toHaveLength(5);
	});

	it("cluster aligns every leaf at the far side, with elbow links", () => {
		const scene = show({
			layout: "cluster",
			width: 6,
			height: 3,
			labels: false,
		});
		const xs = dots(scene).map((dot) => dot.center.x);
		expect(xs.filter((x) => Math.abs(x - (3 - 0.1)) < 1e-6)).toHaveLength(6); // a1, a2, b, c1, c2x, c2y
		// Elbow links: at most three points, axis-aligned segments.
		for (const link of links(scene)) {
			const line = lineOf(link);
			expect(line.length).toBeLessThanOrEqual(3);
			for (let i = 1; i < line.length; i++) {
				const dx = Math.abs((line[i] as Point).x - (line[i - 1] as Point).x);
				const dy = Math.abs((line[i] as Point).y - (line[i - 1] as Point).y);
				expect(Math.min(dx, dy)).toBeLessThan(1e-9);
			}
		}
		const curved = show({ width: 6, height: 3, labels: false });
		expect(
			lineOf(links(curved)[0] as ReturnType<typeof links>[number]).length,
		).toBeGreaterThan(3);
	});

	it("lays out top-down when vertical", () => {
		const all = dots(
			show({
				orientation: "vertical",
				center: { x: 1, y: 0 },
				width: 4,
				height: 3,
				labels: false,
			}),
		);
		const root = all[0]?.center as Point;
		expect(root.y).toBeCloseTo(1.5 - 0.1, 6);
		expect(root.x).toBeGreaterThan(-1);
		expect(root.x).toBeLessThan(3);
		expect(Math.min(...all.map((dot) => dot.center.y))).toBeCloseTo(
			-1.5 + 0.1,
			6,
		);
		for (const dot of all) {
			expect(dot.center.x).toBeGreaterThanOrEqual(-1);
			expect(dot.center.x).toBeLessThanOrEqual(3);
		}
	});

	it("labels leaves past the leaf and parents beside the node, inside the box", () => {
		const scene = show({ width: 6, height: 3, labelFontSize: 0.2 });
		expect(texts(scene).sort()).toEqual(
			["root", "a", "a1", "a2", "b", "c", "c1", "c2", "c2x", "c2y"].sort(),
		);
		// A leaf's name starts right of its dot and ends inside the box.
		const leaf = labelOf(scene, "c2y");
		expect(leaf.style.align).toBe("left");
		expect(leaf.at.x + width("c2y")).toBeLessThanOrEqual(3 + 1e-6);
		// A parent's name ends left of its dot, above its incoming link.
		expect(labelOf(scene, "c").style.align).toBe("right");
		// The root's name fits in the box too.
		expect(labelOf(scene, "root").at.x - width("root")).toBeGreaterThanOrEqual(
			-3 - 1e-6,
		);
		// Labels use the theme foreground, not the node colour.
		expect(new Set(labels(scene).map((l) => l.style.fill)).size).toBe(1);

		const vertical = show({ orientation: "vertical", width: 6, height: 3 });
		// Vertical leaf names read downward.
		expect(labelOf(vertical, "a1").rotation).toBeCloseTo(-Math.PI / 2, 9);
		expect(labelOf(vertical, "a").rotation).toBe(0);
	});

	it("grows outward depth by depth: links from the parent, then the dots", () => {
		expect(show({ width: 6, height: 3, progress: 0 }).graph.frame).toEqual([]);

		// Four levels: the default stagger widens to 9/14, so each level's links
		// start once its parents' have drawn (windows 5/14 long, 3/14 apart).
		// At 0.25 the root is 70% grown and the depth-1 links have just
		// started; nothing deeper.
		const early = show({ width: 6, height: 3, progress: 0.25 });
		expect(dots(early)).toHaveLength(1);
		expect(dots(early)[0]?.radius).toBeCloseTo(0.07, 3);
		expect(links(early)).toHaveLength(3);
		expect(partial(early)).toHaveLength(3);
		expect(texts(early)).toEqual(["root"]);

		// At 0.5 the deepest level (c2x, c2y) has not started.
		const mid = show({ width: 6, height: 3, progress: 0.5 });
		expect(texts(mid)).not.toContain("c2x");
		expect(dots(mid).length).toBeLessThan(10);
		expect(links(mid).length).toBeLessThan(9);
		expect(dots(mid)[0]?.radius).toBeCloseTo(0.1, 3);

		const full = show({ width: 6, height: 3, progress: 1 });
		expect(dots(full)).toHaveLength(10);
		expect(links(full)).toHaveLength(9);
		expect(partial(full)).toHaveLength(0);
		expect(texts(full)).toHaveLength(10);
	});

	it("radial: the root in the centre, leaves round a circle that fits the box", () => {
		const scene = show({
			orientation: "radial",
			layout: "cluster",
			center: { x: 1, y: -1 },
			width: 6,
			height: 4,
			labelFontSize: 0.2,
		});
		const all = dots(scene);
		expect(all).toHaveLength(10);
		expect(all[0]?.center.x).toBeCloseTo(1, 6);
		expect(all[0]?.center.y).toBeCloseTo(-1, 6);
		// Cluster: every leaf on one circle, inside the 4-high box with its name.
		const leafNames = ["a1", "a2", "b", "c1", "c2x", "c2y"];
		const leafRadii = leafNames.map((name) => {
			const label = labelOf(scene, name);
			return Math.hypot(label.at.x - 1, label.at.y + 1);
		});
		for (const r of leafRadii) expect(r).toBeCloseTo(leafRadii[0] as number, 6);
		for (const name of leafNames) {
			const label = labelOf(scene, name);
			expect(
				Math.hypot(label.at.x - 1, label.at.y + 1) + width(name),
			).toBeLessThanOrEqual(2 + 1e-6);
		}
		// Parents are named in the tooltip only.
		expect(texts(scene).sort()).toEqual([...leafNames].sort());
		// The first leaf is just clockwise of 12 o'clock: above the centre, to the right.
		const first = labelOf(scene, "a1");
		expect(first.at.y).toBeGreaterThan(-1);
		expect(first.at.x).toBeGreaterThan(1);
		expect(first.style.align).toBe("left");
		// A leaf on the left half reads outward too, upright: right-aligned.
		expect(labels(scene).find((l) => l.at.x < 1 - 0.5)?.style.align).toBe(
			"right",
		);
	});

	it("radial elbow links run round the parent's circle", () => {
		const scene = show({
			orientation: "radial",
			layout: "cluster",
			link: "elbow",
			width: 6,
			height: 6,
			labels: false,
		});
		const root = dots(scene)[0]?.center as Point;
		for (const link of links(scene)) {
			// All but the last point share the parent's radius.
			const radii = lineOf(link).map((p) =>
				Math.hypot(p.x - root.x, p.y - root.y),
			);
			for (const r of radii.slice(0, -1))
				expect(r).toBeCloseTo(radii[0] as number, 6);
		}
	});

	it("distance places nodes by merge height", () => {
		type Merge = { name: string; d?: number; children?: Merge[] };
		const merges: Merge = {
			name: "root",
			d: 4,
			children: [
				{ name: "ab", d: 1, children: [{ name: "a" }, { name: "b" }] },
				{ name: "c" },
			],
		};
		const xs = dots(
			mount(
				treeChart.create({
					data: merges,
					label: "name",
					distance: (d: Merge) => d.d ?? 0,
					layout: "cluster",
					nodeRadius: 0.1,
					width: 4.2,
					height: 2,
					labels: false,
				}),
			),
		).map((dot) => dot.center.x);
		// Root at the left edge (-2.1 + r), leaves at the right (2.1 - r): a
		// 4-unit depth span; "ab" at distance 1 of 4 sits 3/4 of the way out.
		expect(xs[0]).toBeCloseTo(-2, 6);
		expect(xs[1]).toBeCloseTo(-2 + 3, 6);
		expect(xs[2]).toBeCloseTo(2, 6);
	});

	it("hides with visible false", () => {
		expect(show({ width: 6, height: 3, visible: false }).graph.frame).toEqual(
			[],
		);
	});

	it("names nodes with their path and leaf count, or summed value", () => {
		const names = (value?: string) =>
			mountChart(
				treeChart.create({
					...common,
					value,
					width: 6,
					height: 3,
					tooltip: true,
				}),
			).names();
		const counted = names();
		expect(counted).toContain("c / c2: 2");
		expect(counted).toContain("a / a1: 1");
		const summed = names("size");
		expect(summed).toContain("c / c2: 6");
		expect(summed).toContain("b: 3");
	});

	it("updates in place through progress, size, orientation and data", () => {
		const charts = [
			treeChart.create({
				...common,
				width: 4,
				height: 2,
				tooltip: true,
				progress: 0,
			}),
			treeChart.create({
				...common,
				width: 4,
				height: 3,
				orientation: "radial",
				layout: "cluster",
				tooltip: true,
				progress: 0,
			}),
			treeChart.create({
				...common,
				layout: "cluster",
				width: 4,
				height: 2,
				tooltip: true,
				progress: 0,
			}),
		];
		const scene = mount(...charts);
		for (const p of [0.2, 0.5, 0.8, 1, 1, 0.4, 0, 1]) {
			for (const chart of charts) chart.set("progress" as never, p as never);
			scene.commit();
		}
		for (const chart of charts) chart.set("width" as never, 5 as never);
		charts[0]?.set("orientation" as never, "vertical" as never);
		scene.commit();
		for (const chart of charts)
			chart.set(
				"data" as never,
				{ name: "other", children: [{ name: "x", size: 1 }] } as never,
			);
		scene.commit();
		expect(dots(scene)).toHaveLength(6);
	});
});

/** `tree` with b and c2y gone, a3 and d new. */
const nextTree: Node = {
	name: "root",
	children: [
		{
			name: "a",
			children: [
				{ name: "a1", size: 4 },
				{ name: "a2", size: 2 },
				{ name: "a3", size: 1 },
			],
		},
		{
			name: "c",
			children: [
				{ name: "c1", size: 1 },
				{ name: "c2", children: [{ name: "c2x", size: 2 }] },
			],
		},
		{ name: "d", size: 5 },
	],
};

describe("tree keyed transitions", () => {
	const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
	/** Everything drawn, rounded, in a stable order. */
	const picture = (scene: Scene) => ({
		dots: dots(scene)
			.map((dot) => ({
				x: r6(dot.center.x),
				y: r6(dot.center.y),
				r: r6(dot.radius),
				fill: dot.fill,
				alpha: dot.alpha,
			}))
			.sort((a, b) => a.x - b.x || a.y - b.y),
		links: links(scene)
			.map((link) => ({
				points: lineOf(link).map((p) => [r6(p.x), r6(p.y)]),
				stroke: link.stroke,
				alpha: r6(link.alpha),
			}))
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
		labels: labels(scene)
			.map((l) => ({
				text: l.text,
				x: r6(l.at.x),
				y: r6(l.at.y),
				opacity: r6(l.style.opacity),
			}))
			.sort((a, b) => a.text.localeCompare(b.text)),
	});
	const layouts = [
		{},
		{ orientation: "vertical", layout: "cluster" },
		{ orientation: "radial", layout: "cluster" },
	] as const;

	it("is exactly `data` at blend 0 and exactly `to` at blend 1, in every layout", () => {
		for (const extra of layouts) {
			const at = (blend?: number, data = tree, to?: Node) =>
				show({ ...extra, data, to, blend, width: 6, height: 4 });
			expect(picture(at(0, tree, nextTree))).toEqual(picture(at()));
			expect(picture(at(1, tree, nextTree))).toEqual(
				picture(at(undefined, nextTree)),
			);
		}
	});

	it("draws a leaving node back into its parent, moves the matched ones, grows the new ones out", () => {
		const at = (blend: number) =>
			show({ data: tree, to: nextTree, blend, width: 6, height: 4 });
		// Exit, update, enter: a third each, eased within.
		const exiting = at(1 / 6);
		expect(partial(exiting)).toHaveLength(2); // b, c2y
		expect(dots(exiting)).toHaveLength(8); // their dots already gone
		expect(texts(exiting)).not.toContain("b");
		const updating = at(0.5);
		// Only the nodes both trees have: root, a, a1, a2, c, c1, c2, c2x.
		expect(dots(updating)).toHaveLength(8);
		const start = show({ width: 6, height: 4 });
		const end = show({ data: nextTree, width: 6, height: 4 });
		// c's name moves between its two places.
		const y0 = labelOf(start, "c").at.y;
		const y1 = labelOf(end, "c").at.y;
		const y = labelOf(updating, "c").at.y;
		expect(y).toBeGreaterThan(Math.min(y0, y1) + 1e-6);
		expect(y).toBeLessThan(Math.max(y0, y1) - 1e-6);
		const entering = at(5 / 6);
		expect(partial(entering)).toHaveLength(2); // a3, d
		expect(texts(entering)).not.toContain("d");
	});

	it("scrubs a blend on mounted trees in every layout", () => {
		const charts = layouts.map((extra) =>
			treeChart.create({
				...common,
				...extra,
				to: nextTree,
				blend: 0,
				width: 6,
				height: 4,
				tooltip: true,
			}),
		);
		const scene = mount(...charts);
		for (const t of [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 0.5, 0, 1]) {
			for (const chart of charts) chart.set("blend" as never, t as never);
			scene.commit();
		}
		expect(dots(scene)).toHaveLength(3 * 10);
	});
});
