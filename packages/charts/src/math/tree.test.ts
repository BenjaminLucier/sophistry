import { describe, expect, it } from "vitest";
import type { TreeNode } from "./tree";
import {
	hierarchyTreeLayout,
	radialTreeLink,
	radialTreePoint,
	treeLink,
} from "./tree";

type Node = { name: string; size?: number; children?: Node[] };

const tree: Node = {
	name: "root",
	children: [
		{
			name: "a",
			children: [
				{ name: "a1", size: 4 },
				{ name: "a2", size: 0 },
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
						{ name: "c2y", size: 5 },
					],
				},
			],
		},
	],
};

const label = (d: Node) => d.name;

const byName = <T>(nodes: TreeNode<T>[], name: string) => {
	const node = nodes.find((n) => n.label === name);
	if (!node) throw new Error(`no node ${name}`);
	return node;
};

describe("hierarchyTreeLayout", () => {
	it("keeps every node, in pre-order, with parent positions", () => {
		const nodes = hierarchyTreeLayout(tree, { label });
		expect(nodes.map((n) => n.label)).toEqual([
			"root",
			"a",
			"a1",
			"a2",
			"b",
			"c",
			"c1",
			"c2",
			"c2x",
			"c2y",
		]);
		expect(nodes.map((n) => n.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(nodes.map((n) => n.parent)).toEqual([-1, 0, 1, 1, 0, 0, 5, 5, 7, 7]);
		expect(nodes.map((n) => n.depth)).toEqual([0, 1, 2, 2, 1, 1, 2, 2, 3, 3]);
		expect(byName(nodes, "c2y").path).toEqual(["root", "c", "c2", "c2y"]);
		expect(nodes.map((n) => n.branch)).toEqual([-1, 0, 0, 0, 1, 2, 2, 2, 2, 2]);
		expect(nodes[0].height).toBe(3);
		expect(nodes.filter((n) => n.leaf).map((n) => n.label)).toEqual([
			"a1",
			"a2",
			"b",
			"c1",
			"c2x",
			"c2y",
		]);
	});

	it("values are leaf counts without a value accessor, sums with one", () => {
		const counted = hierarchyTreeLayout(tree, { label });
		expect(byName(counted, "root").value).toBe(6);
		expect(byName(counted, "c").value).toBe(3);
		expect(byName(counted, "a2").value).toBe(1);

		const summed = hierarchyTreeLayout(tree, {
			label,
			value: (d) => d.size ?? 0,
		});
		expect(byName(summed, "root").value).toBe(15);
		expect(byName(summed, "c2").value).toBe(7);
		// A zero-valued leaf is kept, unlike in a treemap.
		expect(byName(summed, "a2").value).toBe(0);
		expect(summed).toHaveLength(10);
	});

	it("tidy: one depth per level, parents centred over their children", () => {
		const nodes = hierarchyTreeLayout(tree, { label, width: 4, height: 3 });
		for (const n of nodes) {
			expect(n.y).toBeCloseTo(n.depth, 9);
			expect(n.x).toBeGreaterThanOrEqual(0);
			expect(n.x).toBeLessThanOrEqual(4);
		}
		for (const parent of nodes.filter((n) => !n.leaf)) {
			const position = nodes.indexOf(parent);
			const kids = nodes.filter((n) => n.parent === position);
			const xs = kids.map((k) => k.x);
			expect(parent.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 9);
			// Siblings in order along the breadth axis.
			for (let i = 1; i < xs.length; i++)
				expect(xs[i]).toBeGreaterThan(xs[i - 1]);
		}
		// Leaves at different depths in a tidy tree.
		expect(byName(nodes, "b").y).toBeCloseTo(1, 9);
		expect(byName(nodes, "c2y").y).toBeCloseTo(3, 9);
	});

	it("cluster: every leaf at the far depth, the root at 0", () => {
		const nodes = hierarchyTreeLayout(tree, {
			label,
			layout: "cluster",
			width: 2,
			height: 5,
		});
		expect(nodes[0].y).toBe(0);
		for (const leaf of nodes.filter((n) => n.leaf)) {
			expect(leaf.y).toBeCloseTo(5, 9);
		}
		// Parents sit strictly between root and leaves, deeper ones further out.
		const c = byName(nodes, "c");
		const c2 = byName(nodes, "c2");
		expect(c.y).toBeGreaterThan(0);
		expect(c2.y).toBeGreaterThan(c.y);
		expect(c2.y).toBeLessThan(5);
		// Leaves evenly spread along breadth, siblings one gap apart, cousins two.
		const leaves = nodes.filter((n) => n.leaf).map((n) => n.x);
		const gaps = leaves.slice(1).map((x, i) => x - leaves[i]);
		expect(gaps[0]).toBeCloseTo(gaps[2] / 2, 9); // a1–a2 siblings, b–c1 cousins
	});

	it("separation 1 spaces every neighbour evenly", () => {
		const nodes = hierarchyTreeLayout(tree, {
			label,
			layout: "cluster",
			separation: 1,
		});
		const leaves = nodes.filter((n) => n.leaf).map((n) => n.x);
		const gaps = leaves.slice(1).map((x, i) => x - leaves[i]);
		for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 9);
	});

	it("keeps data order unless asked to sort", () => {
		const unsorted = hierarchyTreeLayout(tree, {
			label,
			value: (d) => d.size ?? 0,
		});
		expect(unsorted.filter((n) => n.depth === 1).map((n) => n.label)).toEqual([
			"a",
			"b",
			"c",
		]);
		const sorted = hierarchyTreeLayout(tree, {
			label,
			value: (d) => d.size ?? 0,
			sort: true,
		});
		expect(sorted.filter((n) => n.depth === 1).map((n) => n.label)).toEqual([
			"c",
			"a",
			"b",
		]);
		// Branch colours follow input order regardless.
		expect(byName(sorted, "c").branch).toBe(2);
	});

	it("handles a lone root, an empty box and cycles", () => {
		const lone = hierarchyTreeLayout({ name: "x" }, { width: 2, height: 1 });
		expect(lone).toHaveLength(1);
		expect(lone[0]).toMatchObject({ x: 1, y: 0, leaf: true, value: 1 });
		expect(hierarchyTreeLayout(tree, { width: 0 })).toEqual([]);
		expect(hierarchyTreeLayout(tree, { height: Number.NaN })).toEqual([]);
		const loop: Node = { name: "loop", children: [] };
		loop.children?.push(loop);
		expect(() => hierarchyTreeLayout(loop)).toThrow(/cycle/);
	});

	it("reads children through an accessor", () => {
		const nodes = hierarchyTreeLayout(
			{ id: 1, kids: [{ id: 2 }, { id: 3 }] } as {
				id: number;
				kids?: unknown[];
			},
			{
				children: (d) => d.kids as { id: number }[] | undefined,
				label: (d) => String(d.id),
			},
		);
		expect(nodes.map((n) => n.label)).toEqual(["1", "2", "3"]);
	});
});

describe("treeLink", () => {
	const parent = { x: 0.5, y: 0 };
	const child = { x: 0.1, y: 1 };

	it("elbow: along breadth at the parent's depth, then along depth", () => {
		expect(treeLink(parent, child, "elbow")).toEqual([
			{ x: 0.5, y: 0 },
			{ x: 0.1, y: 0 },
			{ x: 0.1, y: 1 },
		]);
		// A child straight below needs no corner.
		expect(treeLink(parent, { x: 0.5, y: 1 }, "elbow")).toHaveLength(2);
	});

	it("curve: sampled cubic from parent to child, leaving along depth", () => {
		const points = treeLink(parent, child, "curve", { samples: 11 });
		expect(points).toHaveLength(11);
		expect(points[0]).toEqual(parent);
		expect(points[10].x).toBeCloseTo(child.x, 12);
		expect(points[10].y).toBeCloseTo(child.y, 12);
		// Symmetric about the middle: halfway in both axes.
		expect(points[5].x).toBeCloseTo(0.3, 12);
		expect(points[5].y).toBeCloseTo(0.5, 12);
		// Tangent at the ends runs along depth: breadth barely moves at first.
		expect(Math.abs(points[1].x - parent.x)).toBeLessThan(
			Math.abs(points[1].y - parent.y),
		);
		// Monotone in depth.
		for (let i = 1; i < points.length; i++)
			expect(points[i].y).toBeGreaterThanOrEqual(points[i - 1].y);
	});

	it("defaults to 24 samples", () => {
		expect(treeLink(parent, child, "curve")).toHaveLength(24);
	});
});

describe("hierarchyTreeLayout distance", () => {
	type Merge = { name: string; d?: number; children?: Merge[] };
	// ((a, b) at 1, c) at 4: a dendrogram with merge heights.
	const merges: Merge = {
		name: "root",
		d: 4,
		children: [
			{
				name: "ab",
				d: 1,
				children: [{ name: "a" }, { name: "b" }],
			},
			{ name: "c" },
		],
	};

	it("places nodes by distance: the root at 0, distance 0 at the far side", () => {
		const nodes = hierarchyTreeLayout(merges, {
			layout: "cluster",
			label: (d) => d.name,
			distance: (d) => d.d ?? 0,
			height: 2,
		});
		expect(byName(nodes, "root").y).toBe(0);
		expect(byName(nodes, "ab").y).toBeCloseTo(2 * (3 / 4));
		for (const leaf of ["a", "b", "c"]) expect(byName(nodes, leaf).y).toBe(2);
		expect(byName(nodes, "ab").distance).toBe(1);
		expect(byName(nodes, "root").distance).toBe(4);
		expect(byName(nodes, "a").distance).toBe(0);
	});

	it("raises a missing or too-low distance to its tallest child's", () => {
		const nodes = hierarchyTreeLayout(
			{
				name: "root",
				d: 0.5, // below its child "ab"
				children: [
					{ name: "ab", d: 2, children: [{ name: "a" }, { name: "b" }] },
					{ name: "c", children: [{ name: "c1", d: 1 }] }, // no distance
				],
			} as Merge,
			{ label: (d) => d.name, distance: (d) => d.d ?? Number.NaN },
		);
		expect(byName(nodes, "root").distance).toBe(2);
		expect(byName(nodes, "root").y).toBe(0);
		expect(byName(nodes, "ab").y).toBe(0);
		expect(byName(nodes, "c").distance).toBe(1);
		expect(byName(nodes, "c1").distance).toBe(1);
		expect(byName(nodes, "c").y).toBeCloseTo(0.5);
	});

	it("without distance, distance is the height in levels", () => {
		const nodes = hierarchyTreeLayout(tree, { label });
		expect(byName(nodes, "root").distance).toBe(3);
		expect(byName(nodes, "c2x").distance).toBe(0);
	});
});

describe("radial trees", () => {
	it("radial divides the gap between neighbours by depth", () => {
		const options = { label, width: 10, layout: "cluster" as const };
		const flat = hierarchyTreeLayout(tree, options);
		const radial = hierarchyTreeLayout(tree, { ...options, radial: true });
		const gap = (nodes: TreeNode<Node>[], a: string, b: string) =>
			Math.abs(byName(nodes, a).x - byName(nodes, b).x);
		// Cousin leaves b → c1 (c1 at depth 2) and c1 → c2x (c2x at depth 3):
		// the same gap flat, 2/2 against 2/3 radially.
		expect(gap(flat, "c1", "c2x") / gap(flat, "b", "c1")).toBeCloseTo(1);
		expect(gap(radial, "c1", "c2x") / gap(radial, "b", "c1")).toBeCloseTo(
			2 / 3,
		);
	});

	it("radialTreePoint reads x as an angle clockwise from 12 o'clock", () => {
		const top = radialTreePoint(0, 2, { x: 1, y: 1 });
		expect(top.x).toBeCloseTo(1);
		expect(top.y).toBeCloseTo(3);
		const right = radialTreePoint(Math.PI / 2, 2);
		expect(right.x).toBeCloseTo(2);
		expect(right.y).toBeCloseTo(0);
	});

	it("an elbow runs round the parent's circle, then out to the child", () => {
		const points = radialTreeLink(
			{ x: 0, y: 1 },
			{ x: Math.PI / 2, y: 2 },
			"elbow",
		);
		const last = points[points.length - 1];
		expect(last.x).toBeCloseTo(2);
		expect(last.y).toBeCloseTo(0);
		// Every point but the last is on the unit circle.
		for (const p of points.slice(0, -1))
			expect(Math.hypot(p.x, p.y)).toBeCloseTo(1);
		expect(points.length).toBeGreaterThan(10);
	});

	it("a curve leaves the parent and reaches the child", () => {
		const points = radialTreeLink({ x: 0, y: 1 }, { x: 1, y: 2 }, "curve", {
			samples: 8,
			center: { x: 5, y: 0 },
		});
		expect(points).toHaveLength(8);
		expect(points[0].x).toBeCloseTo(5);
		expect(points[0].y).toBeCloseTo(1);
		expect(points[7].x).toBeCloseTo(5 + 2 * Math.sin(1));
		expect(points[7].y).toBeCloseTo(2 * Math.cos(1));
	});
});
