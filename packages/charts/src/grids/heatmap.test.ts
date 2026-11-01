/**
 * `cells`, `heatmap` and `dendrogram`: categorical cells on band axes, the
 * annotated heatmap preset, and clustered heatmaps whose dendrograms replay
 * the merges as the cells reveal.
 */

import type { SceneNode } from "@sophistry/core";
import { UNDER_AXES_Z_INDEX } from "@sophistry/core";
import type { TextSpec } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { clusterRows } from "../math/cluster.js";
import { mount } from "../test-harness.js";
import { cells } from "./cells.js";
import { dendrogram } from "./dendrogram.js";
import { heatmap } from "./heatmap.js";
import { inChart, itemBox, itemsOf } from "./test-support.js";

// Rows r1 and r3 are alike, as are r2 and r4; columns a and c are alike.
const rows = ["r1", "r2", "r3", "r4"];
const columns = ["a", "b", "c"];
const values = [
	[1, 9, 1.5],
	[8, 2, 8.5],
	[1.2, 8.5, 1.4],
	[8.2, 2.5, 8.8],
];
const grid = rows.flatMap((row, i) =>
	columns.map((column, j) => ({ row, column, v: values[i]?.[j] as number })),
);

type Scene = ReturnType<typeof mount>;
const labelOf = (scene: Scene, text: string): TextSpec => {
	const found = scene.texts().find((l) => l.text === text);
	if (!found) throw new Error(`no label ${text}`);
	return found;
};
/** The cells: the rect items. */
const cellItems = (scene: Scene) =>
	itemsOf(scene.marks().filter((m) => m.shape.kind === "rect"));
/** The dendrogram arms: path batch items. */
const arms = (scene: Scene) =>
	itemsOf(scene.marks().filter((m) => m.shape.kind === "paths"));
const gridBox = (scene: Scene) => {
	const boxes = cellItems(scene).map(itemBox);
	return {
		minX: Math.min(...boxes.map((b) => b.minX)),
		maxX: Math.max(...boxes.map((b) => b.maxX)),
		minY: Math.min(...boxes.map((b) => b.minY)),
		maxY: Math.max(...boxes.map((b) => b.maxY)),
	};
};
const heatmapOf = (extra: Record<string, unknown> = {}) =>
	heatmap.create({
		data: grid,
		x: "column",
		y: "row",
		value: "v",
		labels: false,
		width: 4,
		height: 4,
		...extra,
	});

describe("cells", () => {
	const small = [
		{ c: "a", r: "top", n: 0 },
		{ c: "b", r: "top", n: 5 },
		{ c: "a", r: "bottom", n: 10 },
		{ c: "b", r: "bottom", n: 5 },
	];

	it("puts both axes on bands with no gap, and colours by value", () => {
		const scene = inChart(
			{ width: 8, height: 4, axis: { visible: false } },
			cells.create({
				data: small,
				x: "c",
				y: "r",
				value: "n",
				ramp: ["#000000", "#ffffff"],
			}),
		);
		expect(scene.handle().xBand?.domain).toEqual(["a", "b"]);
		expect(scene.handle().xBand?.bandwidth).toBe(1);
		const items = cellItems(scene);
		expect(items).toHaveLength(4);
		for (const item of items) expect(item.zIndex).toBe(UNDER_AXES_Z_INDEX);
		expect(new Set(items.map((s) => s.fill)).size).toBe(3);
	});

	it("writes values in a colour that reads on each cell, one above the cells", () => {
		const scene = inChart(
			{ width: 8, height: 4 },
			cells.create({
				data: small,
				x: "c",
				y: "r",
				value: "n",
				ramp: ["#000000", "#ffffff"],
				labels: true,
			}),
		);
		const texts = scene.texts();
		expect(texts.map((t) => t.text)).toEqual(
			expect.arrayContaining(["0", "5", "10"]),
		);
		const zero = labelOf(scene, "0");
		const ten = labelOf(scene, "10");
		expect(zero.zIndex).toBe(UNDER_AXES_Z_INDEX + 1);
		// Dark text on the white cell, light on the black one.
		expect(zero.style.fill).not.toBe(ten.style.fill);
	});

	it("fades in reading order: the top-left cell leads the bottom-right", () => {
		const scene = inChart(
			{ width: 8, height: 4, progress: 0.75 },
			cells.create({ data: small, x: "c", y: "r", value: "n" }),
		);
		const items = cellItems(scene);
		// Data order: top-left, top-right, bottom-left, bottom-right.
		expect(items[0]?.progress).toBeGreaterThan(items[3]?.progress as number);
	});

	it("blends keyed data: a shared cell's colour moves halfway", () => {
		const scene = inChart(
			{ width: 8, height: 4 },
			cells.create({
				data: [{ c: "a", r: "x", n: 0 }],
				to: [{ c: "a", r: "x", n: 10 }],
				blend: 0.5,
				staging: "together",
				x: "c",
				y: "r",
				value: "n",
				rampMin: 0,
				rampMax: 10,
				ramp: ["#000000", "#ffffff"],
			}),
		);
		const [item] = cellItems(scene);
		expect(item?.fill).not.toBe("rgba(0, 0, 0, 1)");
		expect(item?.fill).not.toBe("rgba(255, 255, 255, 1)");
	});

	it("shows its tooltip per cell", () => {
		const layer = cells.create({
			data: small,
			x: "c",
			y: "r",
			value: "n",
			tooltip: true,
		});
		inChart({ width: 8, height: 4 }, layer);
		const rects = layer.children[0] as SceneNode;
		const itemLabel = rects.get("shared" as never) as
			| { itemLabel?: (item: number) => string | undefined }
			| undefined;
		expect(itemLabel?.itemLabel?.(0)).toBe("c: a, r: top, n: 0");
	});
});

describe("heatmap", () => {
	it("writes every value and honours the named row and column order", () => {
		const scene = mount(
			heatmap.create({
				data: [
					{ c: "b", r: "y", n: 2 },
					{ c: "a", r: "x", n: 1 },
				],
				x: "c",
				y: "r",
				value: "n",
				columns: ["a", "b"],
				rows: ["x", "y"],
				width: 4,
				height: 2,
			}),
		);
		expect(scene.texts().map((t) => t.text)).toEqual(
			expect.arrayContaining(["1", "2", "a", "b", "x", "y"]),
		);
		// Columns left to right as named; rows top to bottom.
		expect(labelOf(scene, "a").at.x).toBeLessThan(labelOf(scene, "b").at.x);
		expect(labelOf(scene, "x").at.y).toBeGreaterThan(labelOf(scene, "y").at.y);
	});

	it("puts its cells under the chart's guides at any z", () => {
		const data = [
			{ c: "a", r: "x", n: 1 },
			{ c: "b", r: "x", n: 2 },
		];
		const scene = mount(
			heatmap.create({
				width: 6,
				height: 3,
				data,
				x: "c",
				y: "r",
				value: "n",
				zIndex: 2,
			}),
		);
		const items = cellItems(scene);
		expect(items).toHaveLength(2);
		for (const item of items) expect(item.zIndex).toBe(2 + UNDER_AXES_Z_INDEX);
	});

	it("throws with both `to` and `cluster`", () => {
		expect(() => mount(heatmapOf({ cluster: true, to: grid }))).toThrow(
			/cluster/,
		);
	});
});

describe("heatmap cluster", () => {
	it("without cluster, keeps the data order, names left and bottom, no dendrograms", () => {
		const scene = mount(heatmapOf());
		expect(arms(scene)).toHaveLength(0);
		const ys = rows.map((r) => labelOf(scene, r).at.y);
		expect(ys).toEqual([...ys].sort((a, b) => b - a));
		const box = gridBox(scene);
		expect(labelOf(scene, "r1").at.x).toBeLessThan(box.minX);
		expect(labelOf(scene, "a").at.y).toBeLessThan(box.minY);
	});

	it('cluster="rows" puts similar rows together, with three merges of two arms', () => {
		const scene = mount(heatmapOf({ cluster: "rows" }));
		const order = [...rows].sort(
			(p, q) => labelOf(scene, q).at.y - labelOf(scene, p).at.y,
		);
		expect(order).toEqual(["r1", "r3", "r2", "r4"]);
		expect(arms(scene)).toHaveLength(6);
		// Columns untouched.
		expect(labelOf(scene, "a").at.y).toBeLessThan(gridBox(scene).minY);
	});

	it('cluster="rows": row names move right of the grid, the tree stands left of it', () => {
		const scene = mount(heatmapOf({ cluster: "rows" }));
		const box = gridBox(scene);
		expect(labelOf(scene, "r1").at.x).toBeGreaterThan(box.maxX);
		expect(arms(scene)).toHaveLength(6);
		for (const arm of arms(scene))
			expect(itemBox(arm).maxX).toBeLessThan(box.minX);
	});

	it("cluster: true also reorders the columns, a and c side by side", () => {
		const scene = mount(heatmapOf({ cluster: true }));
		const columnOrder = [...columns].sort(
			(p, q) => labelOf(scene, p).at.x - labelOf(scene, q).at.x,
		);
		expect(Math.abs(columnOrder.indexOf("a") - columnOrder.indexOf("c"))).toBe(
			1,
		);
		expect(arms(scene)).toHaveLength(6 + 4);
	});

	it("cluster: true puts the column tree on top", () => {
		const scene = mount(heatmapOf({ cluster: true }));
		const box = gridBox(scene);
		expect(labelOf(scene, "a").at.y).toBeLessThan(box.minY);
		const above = arms(scene).filter((arm) => itemBox(arm).minY > box.maxY);
		expect(above).toHaveLength(4);
	});

	it("reserves the dendrograms' margins: the title rises over the column tree", () => {
		const size = 0.9;
		const titled = (cluster: true | "rows") =>
			mount(
				heatmapOf({
					cluster,
					dendrogramSize: size,
					title: "Clustered",
					yLabel: "rows",
				}),
			);
		const scene = titled(true);
		const rowsOnly = titled("rows");
		const titleY = (s: Scene) => labelOf(s, "Clustered").at.y;
		// The column tree's band is gap + size deep; the title clears it.
		expect(titleY(scene) - titleY(rowsOnly)).toBeCloseTo(0.08 + size);
		const top = Math.max(...arms(scene).map((arm) => itemBox(arm).maxY));
		expect(titleY(scene)).toBeGreaterThan(top);
		// The rows' title (above the y axis, on the right) clears it too.
		expect(labelOf(scene, "rows").at.y).toBeGreaterThan(top);
		// The plot itself did not move: the band sits outside it (cells inset 0.03).
		expect(gridBox(scene).maxY).toBeCloseTo(2 - 0.03);
	});

	it("draws from frame.marginBox: past the axis names when they share the side", () => {
		const gap = 0.1;
		const size = 0.5;
		const { root } = clusterRows(
			columns.map((_, j) => values.map((r) => r[j] as number)),
		);
		const scene = inChart(
			{ width: 4, height: 4, xAxis: { line: false }, yAxis: { line: false } },
			cells.create({ data: grid, x: "column", y: "row", value: "v" }),
			dendrogram.create({
				tree: root,
				categories: columns,
				axis: "x",
				side: "bottom",
				gap,
				size,
			}),
		);
		const box = gridBox(scene);
		const names = Math.min(...columns.map((c) => labelOf(scene, c).at.y));
		const tree = arms(scene).map(itemBox);
		expect(tree).toHaveLength(4);
		// Below the column names, not over them.
		for (const arm of tree) {
			expect(arm.maxY).toBeLessThan(names);
			expect(arm.maxY).toBeLessThan(box.minY);
		}
		// Leaves `gap` into the band, the root `gap + size`.
		const band = scene.handle().coords.area();
		expect(band.minY).toBeCloseTo(-2);
		const leaves = Math.max(...tree.map((b) => b.maxY));
		const rootY = Math.min(...tree.map((b) => b.minY));
		expect(leaves - rootY).toBeCloseTo(size);
		expect(leaves).toBeLessThan(band.minY - gap + 1e-9);
	});

	it("leaves stand at their row's band centre; merges as far out as their height", () => {
		const size = 1;
		const scene = mount(heatmapOf({ cluster: "rows", dendrogramSize: size }));
		const box = gridBox(scene);
		const tree = clusterRows(values);
		const root = tree.root?.height ?? 1;
		const ends = arms(scene).map((arm) => {
			const line = arm.polylines[0] ?? [];
			return {
				from: line[0] as { x: number; y: number },
				to: line[line.length - 1] as { x: number; y: number },
			};
		});
		// Every arm starting at a leaf starts at a row name's height.
		const nameYs = rows.map((r) => labelOf(scene, r).at.y);
		const leafArms = ends.filter((e) =>
			nameYs.some((y) => Math.abs(y - e.from.y) < 1e-6),
		);
		expect(leafArms.length).toBeGreaterThanOrEqual(4);
		// Each merge's arms end at its height: the root's a whole `size` past
		// the leaves, which stand `gap` (0.08) off the plot's edge (the
		// cells are inset 0.03 inside it).
		const edge = box.minX - 0.03;
		const merges = [
			root,
			...(tree.root?.children?.flatMap((c) => (c.children ? [c.height] : [])) ??
				[]),
		];
		expect(merges).toHaveLength(3);
		for (const height of merges) {
			const x = edge - 0.08 - size * (height / root);
			expect(ends.filter((e) => Math.abs(e.to.x - x) < 1e-6)).toHaveLength(2);
		}
	});

	it("leaf arms start at a row's band centre", () => {
		const scene = mount(heatmapOf({ cluster: "rows" }));
		const nameYs = rows.map((r) => labelOf(scene, r).at.y);
		const leafArms = arms(scene).filter((arm) =>
			nameYs.some(
				(y) => Math.abs(y - (arm.polylines[0]?.[0]?.y as number)) < 1e-6,
			),
		);
		expect(leafArms.length).toBeGreaterThanOrEqual(4);
	});

	it("dendrogram: false reorders without drawing the trees", () => {
		const scene = mount(heatmapOf({ cluster: true, dendrogram: false }));
		expect(arms(scene)).toHaveLength(0);
		const order = [...rows].sort(
			(p, q) => labelOf(scene, q).at.y - labelOf(scene, p).at.y,
		);
		expect(order).toEqual(["r1", "r3", "r2", "r4"]);
		expect(labelOf(scene, "r1").at.x).toBeLessThan(gridBox(scene).minX);
	});

	it("replays the merges lowest first as the data reveals", () => {
		const map = heatmapOf({ cluster: "rows", progress: 0.5 });
		const scene = mount(map);
		// Frame half done, data not started: no arms yet.
		expect(arms(scene)).toHaveLength(0);
		map.set("progress", 0.7);
		scene.commit();
		const early = arms(scene);
		expect(early.length).toBeGreaterThan(0);
		expect(early.length).toBeLessThan(6);
		const reach = (arm: (typeof early)[number]) =>
			Math.max(
				itemBox(arm).maxX - itemBox(arm).minX,
				itemBox(arm).maxY - itemBox(arm).minY,
			);
		map.set("progress", 1);
		scene.commit();
		const all = arms(scene);
		expect(all).toHaveLength(6);
		expect(Math.max(...early.map(reach))).toBeLessThan(
			Math.max(...all.map(reach)),
		);
	});

	it("toggling cluster off and on keeps working (dropped trees are rebuilt)", () => {
		const map = heatmapOf({ cluster: "rows" });
		const scene = mount(map);
		expect(arms(scene)).toHaveLength(6);
		map.set("cluster", false);
		scene.commit();
		expect(arms(scene)).toHaveLength(0);
		map.set("cluster", "rows");
		scene.commit();
		expect(arms(scene)).toHaveLength(6);
	});

	it("scrubs and re-clusters without throwing", () => {
		const map = heatmapOf({ cluster: true, progress: 0 });
		const scene = mount(map);
		for (const p of [0.3, 0.6, 0.8, 1, 1, 0.5, 0, 1]) {
			map.set("progress", p);
			scene.commit();
		}
		map.set("linkage", "single");
		scene.commit();
		map.set(
			"data",
			grid.map((c) => ({ ...c, v: c.v * 2 })),
		);
		scene.commit();
		expect(arms(scene)).toHaveLength(10);
	});
});

describe("dendrogram by hand", () => {
	it("composes with chart and cells; the cells' row order wins", () => {
		const { root, order } = clusterRows(values);
		const scene = inChart(
			{
				width: 4,
				height: 4,
				yAxis: { line: false },
				xAxis: { line: false },
			},
			cells.create({ data: grid, x: "column", y: "row", value: "v" }),
			dendrogram.create({ tree: root, categories: rows, side: "left" }),
			dendrogram.create({
				tree: clusterRows(
					columns.map((_, j) => values.map((r) => r[j] as number)),
				).root,
				categories: columns,
				axis: "x",
			}),
		);
		// The frame unions the layers' categories in order: the cells' come
		// first, so the dendrogram adapts to their (unclustered) order.
		expect(scene.handle().yBand?.domain).toEqual(rows);
		expect(order).toEqual([0, 2, 1, 3]);
		// Its leaves still stand at their rows: four arms start at a row centre.
		const band = scene.handle().yBand;
		const centres = rows.map((r) =>
			scene
				.handle()
				.coords.coordsToPoint(
					0,
					(band?.start(r) ?? 0) + (band?.bandwidth ?? 0) / 2,
				),
		);
		const fromRows = arms(scene).filter((arm) =>
			centres.some(
				(c) => Math.abs((arm.polylines[0]?.[0]?.y as number) - c.y) < 1e-6,
			),
		);
		expect(fromRows.length).toBeGreaterThanOrEqual(4);
		expect(arms(scene)).toHaveLength(6 + 4);
	});

	it("an x dendrogram stands above the plot by default", () => {
		const scene = inChart(
			{
				width: 4,
				height: 4,
				yAxis: { position: "right", line: false },
				xAxis: { position: "top", line: false },
			},
			cells.create({ data: grid, x: "column", y: "row", value: "v" }),
			dendrogram.create({
				tree: clusterRows(values).root,
				categories: rows,
				side: "left",
			}),
			dendrogram.create({
				tree: clusterRows(
					columns.map((_, j) => values.map((r) => r[j] as number)),
				).root,
				categories: columns,
				axis: "x",
			}),
		);
		const box = gridBox(scene);
		const above = arms(scene).filter((arm) => itemBox(arm).minY > box.maxY);
		expect(above).toHaveLength(4);
	});
});
