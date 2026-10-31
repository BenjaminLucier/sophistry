import { describe, expect, it } from "vitest";
import type { HierarchyRect } from "./hierarchy";
import {
	packLayout,
	partitionLayout,
	treemapLayout,
	treemapRows,
} from "./hierarchy";

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

const accessors = {
	value: (d: Node) => d.size ?? 0,
	label: (d: Node) => d.name,
};

const area = (r: HierarchyRect<unknown>) => (r.x1 - r.x0) * (r.y1 - r.y0);
const byName = <N extends { label: string }>(nodes: N[], name: string) => {
	const node = nodes.find((n) => n.label === name);
	if (!node) throw new Error(`no node ${name}`);
	return node;
};

describe("treemapLayout", () => {
	it("gives leaves areas proportional to their values, filling the box", () => {
		const nodes = treemapLayout(tree, { ...accessors, width: 4, height: 2 });
		const leaves = nodes.filter((n) => n.leaf);
		expect(leaves).toHaveLength(5);
		const total = leaves.reduce((s, n) => s + area(n), 0);
		expect(total).toBeCloseTo(8, 9);
		for (const leaf of leaves) {
			expect(area(leaf) / total).toBeCloseTo(leaf.value / 16, 9);
		}
	});

	it("nests children inside their parents", () => {
		const nodes = treemapLayout(tree, {
			...accessors,
			width: 4,
			height: 3,
			padding: 0.05,
			paddingTop: 0.3,
		});
		for (const node of nodes) {
			if (node.parent < 0) continue;
			const parent = nodes[node.parent];
			expect(node.x0).toBeGreaterThanOrEqual(parent.x0 - 1e-9);
			expect(node.x1).toBeLessThanOrEqual(parent.x1 + 1e-9);
			expect(node.y0).toBeGreaterThanOrEqual(parent.y0 - 1e-9);
			expect(node.y1).toBeLessThanOrEqual(parent.y1 + 1e-9);
		}
		// The header gap sits at the top of every parent below the root.
		const a = byName(nodes, "a");
		const top = Math.min(
			...nodes.filter((n) => n.parent === nodes.indexOf(a)).map((n) => n.y0),
		);
		expect(top - a.y0).toBeCloseTo(0.3, 9);
	});

	it("returns nodes in pre-order with depth, path, value and branch", () => {
		const nodes = treemapLayout(tree, { ...accessors, sort: false });
		expect(nodes.map((n) => n.label)).toEqual([
			"root",
			"a",
			"a1",
			"a2",
			"b",
			"c",
			"c1",
			"c2",
		]);
		expect(nodes.map((n) => n.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		const c2 = byName(nodes, "c2");
		expect(c2.depth).toBe(2);
		expect(c2.path).toEqual(["root", "c", "c2"]);
		expect(c2.branch).toBe(2);
		expect(byName(nodes, "c").value).toBe(7);
		expect(nodes[0].value).toBe(16);
		expect(nodes[0].branch).toBe(-1);
		expect(nodes[0].height).toBe(2);
	});

	it("sorts siblings by value by default, keeping branch from input order", () => {
		const nodes = treemapLayout(tree, accessors);
		const top = nodes.filter((n) => n.depth === 1).map((n) => n.label);
		expect(top).toEqual(["c", "a", "b"]);
		expect(byName(nodes, "c").branch).toBe(2);
		expect(byName(nodes, "a").branch).toBe(0);
	});

	it("drops zero, negative and non-finite leaves quietly", () => {
		const nodes = treemapLayout(
			{
				name: "r",
				children: [
					{ name: "x", size: 2 },
					{ name: "y", size: -1 },
					{ name: "z", size: Number.NaN },
				],
			} satisfies Node,
			accessors,
		);
		expect(nodes.map((n) => n.label)).toEqual(["r", "x"]);
	});

	it("is empty for an all-zero tree or an empty box", () => {
		expect(treemapLayout({ name: "r", children: [] }, accessors)).toEqual([]);
		expect(treemapLayout(tree, { ...accessors, width: 0 })).toEqual([]);
	});

	it("reads number leaves as their own value", () => {
		const nodes = treemapLayout({ children: [3, 1] });
		expect(nodes.filter((n) => n.leaf).map((n) => n.value)).toEqual([3, 1]);
	});

	it("supports the other tiles", () => {
		const dice = treemapLayout(tree, { ...accessors, tile: "dice" });
		const top = dice.filter((n) => n.depth === 1);
		// Dice lays siblings side by side, full height.
		for (const n of top) {
			expect(n.y0).toBe(0);
			expect(n.y1).toBe(1);
		}
	});

	it("throws on a cycle", () => {
		const loop: Node = { name: "loop", children: [] };
		loop.children?.push(loop);
		expect(() => treemapLayout(loop, accessors)).toThrow(/cycle/);
	});
});

describe("partitionLayout", () => {
	it("gives one equal depth band per level and spans children exactly", () => {
		const nodes = partitionLayout(tree, { ...accessors, width: 1, height: 3 });
		for (const node of nodes) {
			expect(node.y0).toBeCloseTo(node.depth, 9);
			expect(node.y1).toBeCloseTo(node.depth + 1, 9);
		}
		for (const parent of nodes.filter((n) => !n.leaf)) {
			const kids = nodes.filter((n) => nodes[n.parent] === parent);
			expect(Math.min(...kids.map((k) => k.x0))).toBeCloseTo(parent.x0, 9);
			expect(Math.max(...kids.map((k) => k.x1))).toBeCloseTo(parent.x1, 9);
		}
	});

	it("sizes breadth by value", () => {
		const nodes = partitionLayout(tree, accessors);
		const b = byName(nodes, "b");
		expect(b.x1 - b.x0).toBeCloseTo(3 / 16, 9);
		expect(nodes[0].x0).toBe(0);
		expect(nodes[0].x1).toBe(1);
	});
});

describe("packLayout", () => {
	it("packs leaves with area proportional to value, nested in their parents", () => {
		const nodes = packLayout(tree, { ...accessors, size: 2, padding: 0.01 });
		const root = nodes[0];
		expect(root.r).toBeCloseTo(1, 9);
		expect(root.x).toBeCloseTo(1, 9);
		expect(root.y).toBeCloseTo(1, 9);
		for (const node of nodes) {
			if (node.parent < 0) continue;
			const parent = nodes[node.parent];
			const d = Math.hypot(node.x - parent.x, node.y - parent.y);
			expect(d + node.r).toBeLessThanOrEqual(parent.r + 1e-9);
		}
		// Siblings at the same level keep area ∝ value (padding aside, which
		// is applied before scaling and so slightly perturbs it).
		const a1 = byName(nodes, "a1");
		const a2 = byName(nodes, "a2");
		expect((a1.r / a2.r) ** 2).toBeCloseTo(2, 1);
		// No sibling overlap.
		const leaves = nodes.filter((n) => n.leaf);
		for (const p of leaves) {
			for (const q of leaves) {
				if (p === q) continue;
				expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(
					p.r + q.r - 1e-9,
				);
			}
		}
	});

	it("drops zero-valued leaves before packing", () => {
		const nodes = packLayout({ children: [2, 0, 1] });
		expect(nodes.filter((n) => n.leaf)).toHaveLength(2);
		expect(packLayout({ children: [0] })).toEqual([]);
	});
});

describe("treemapRows and keepRows", () => {
	type Flat = { name: string; size?: number; children?: Flat[] };
	const flat = (sizes: Record<string, number>): Flat => ({
		name: "root",
		children: Object.entries(sizes).map(([name, size]) => ({ name, size })),
	});
	const before = flat({ a: 6, b: 6, c: 4, d: 3, e: 2, f: 2, g: 1 });
	// Values reorder: a fresh squarify sorts and re-rows them.
	const after = flat({ a: 1, b: 2, c: 2, d: 3, e: 4, f: 6, g: 6 });
	const box = { ...accessors, width: 6, height: 4 };
	const leaves = (nodes: HierarchyRect<Flat>[]) =>
		Object.fromEntries(nodes.filter((n) => n.leaf).map((n) => [n.label, n]));

	it("records squarify's rows per parent, and replays them exactly", () => {
		const rows = treemapRows(before, box);
		const root = rows.get(JSON.stringify(["root"]));
		expect(root?.flatMap((row) => row.labels).sort()).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
			"f",
			"g",
		]);
		const plain = treemapLayout(before, box);
		const replayed = treemapLayout(before, { ...box, keepRows: rows });
		expect(replayed).toHaveLength(plain.length);
		replayed.forEach((node, i) => {
			for (const k of ["x0", "x1", "y0", "y1"] as const)
				expect(node[k]).toBeCloseTo(plain[i][k], 9);
		});
	});

	it("lays a new tree out in the old rows: same row-mates, areas by the new values", () => {
		const rows = treemapRows(before, box);
		const kept = leaves(treemapLayout(after, { ...box, keepRows: rows }));
		const total = 24;
		for (const [name, size] of Object.entries({ a: 1, f: 6, g: 6 })) {
			const n = kept[name];
			expect((n.x1 - n.x0) * (n.y1 - n.y0)).toBeCloseTo((24 * size) / total, 9);
		}
		// Every recorded row still shares its band (top/bottom for a row across, left/right for a column).
		for (const row of rows.get(JSON.stringify(["root"])) ?? []) {
			const tiles = row.labels.map((label) => kept[label]);
			for (const tile of tiles) {
				if (row.dice) {
					expect(tile.y0).toBeCloseTo(tiles[0].y0, 9);
					expect(tile.y1).toBeCloseTo(tiles[0].y1, 9);
				} else {
					expect(tile.x0).toBeCloseTo(tiles[0].x0, 9);
					expect(tile.x1).toBeCloseTo(tiles[0].x1, 9);
				}
			}
		}
		// Not a fresh squarify of `after`: the trade-off.
		const fresh = leaves(treemapLayout(after, box));
		expect(
			Object.keys(kept).some(
				(name) => Math.abs(kept[name].x0 - fresh[name].x0) > 1e-6,
			),
		).toBe(true);
	});

	it("drops children that left and squarifies new ones into the rest", () => {
		const rows = treemapRows(before, box);
		const changed = flat({ a: 6, b: 6, c: 4, d: 3, e: 2, f: 2, h: 3 });
		const kept = leaves(treemapLayout(changed, { ...box, keepRows: rows }));
		expect(Object.keys(kept).sort()).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
			"f",
			"h",
		]);
		const sum = Object.values(kept).reduce(
			(acc, n) => acc + (n.x1 - n.x0) * (n.y1 - n.y0),
			0,
		);
		expect(sum).toBeCloseTo(24, 9);
		const h = kept.h;
		expect((h.x1 - h.x0) * (h.y1 - h.y0)).toBeCloseTo((24 * 3) / 26, 9);
	});
});
