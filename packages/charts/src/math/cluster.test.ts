import { describe, expect, it } from "vitest";
import type { ClusterNode } from "./cluster.js";
import {
	clusterRows,
	distanceMatrix,
	leafOrder,
	linkageTree,
} from "./cluster.js";
import { hierarchyTreeLayout } from "./tree.js";

/** Merge heights, root first, depth-first. */
const heights = (node: ClusterNode | null): number[] =>
	node?.children
		? [node.height, ...heights(node.children[0]), ...heights(node.children[1])]
		: [];

describe("distanceMatrix", () => {
	it("measures euclidean, manhattan and correlation distances", () => {
		const rows = [
			[0, 0],
			[3, 4],
		];
		expect(distanceMatrix(rows)).toEqual([
			[0, 5],
			[5, 0],
		]);
		expect(distanceMatrix(rows, "manhattan")[0][1]).toBe(7);
		const together = distanceMatrix(
			[
				[1, 2, 3],
				[10, 20, 30],
				[3, 2, 1],
			],
			"correlation",
		);
		expect(together[0][1]).toBeCloseTo(0);
		expect(together[0][2]).toBeCloseTo(2);
	});

	it("skips gaps pairwise, scaling up to every column", () => {
		const d = distanceMatrix([
			[0, Number.NaN, 0],
			[1, 5, 1],
		]);
		// Over two of three columns: √((1 + 1) · 3/2).
		expect(d[0][1]).toBeCloseTo(Math.sqrt(3));
		expect(
			distanceMatrix([
				[Number.NaN, 1],
				[1, Number.NaN],
			])[0][1],
		).toBeNaN();
	});

	it("a constant row correlates with nothing", () => {
		const d = distanceMatrix(
			[
				[2, 2, 2],
				[1, 2, 3],
			],
			"correlation",
		);
		expect(d[0][1]).toBe(1);
	});
});

describe("linkageTree", () => {
	// Points on a line at 0, 1, 3 and 7.
	const at = [0, 1, 3, 7];
	const line = at.map((a) => at.map((b) => Math.abs(a - b)));

	it("single linkage merges by the closest pair", () => {
		const { root, order } = linkageTree(line, "single");
		expect(heights(root)).toEqual([4, 2, 1]);
		expect(order).toEqual([0, 1, 2, 3]);
		expect(root?.size).toBe(4);
	});

	it("complete linkage merges by the farthest pair", () => {
		expect(heights(linkageTree(line, "complete").root)).toEqual([7, 3, 1]);
	});

	it("average linkage merges by the mean pair (UPGMA), the default", () => {
		const { root } = linkageTree(line);
		expect(root?.height).toBeCloseTo(17 / 3);
		expect(root?.children?.[0].height).toBeCloseTo(2.5);
	});

	it("puts the cluster holding the lower row first, and breaks ties by row", () => {
		// Rows 0 and 3 are close; 1 and 2 are close; the pairs far apart.
		const d = [
			[0, 9, 9, 1],
			[9, 0, 1, 9],
			[9, 1, 0, 9],
			[1, 9, 9, 0],
		];
		const { root, order } = linkageTree(d, "single");
		// Both pairs at 1: (0, 3) merges first (lowest indices), then (1, 2).
		expect(order).toEqual([0, 3, 1, 2]);
		expect(root?.children?.[0].children?.map((c) => c.index)).toEqual([0, 3]);
	});

	it("reads a non-finite distance as the largest finite one", () => {
		const { root } = linkageTree(
			[
				[0, 1, Number.NaN],
				[1, 0, 4],
				[Number.NaN, 4, 0],
			],
			"complete",
		);
		expect(root?.height).toBe(4);
	});

	it("handles no rows and one row", () => {
		expect(linkageTree([])).toEqual({ root: null, order: [] });
		const one = linkageTree([[0]]);
		expect(one.order).toEqual([0]);
		expect(one.root).toEqual({ index: 0, height: 0, size: 1 });
	});
});

describe("clusterRows", () => {
	it("orders similar rows side by side", () => {
		const rows = [
			[1, 2, 3],
			[9, 9, 8],
			[1, 2, 4],
			[8, 9, 9],
		];
		const { order, root } = clusterRows(rows, { linkage: "complete" });
		expect(order).toEqual([0, 2, 1, 3]);
		expect(leafOrder(root as ClusterNode)).toEqual(order);
	});

	it("feeds hierarchyTreeLayout as a dendrogram", () => {
		const { root } = clusterRows([[0], [1], [3], [7]], { linkage: "single" });
		const nodes = hierarchyTreeLayout(root as ClusterNode, {
			layout: "cluster",
			distance: (n) => n.height,
			separation: 1,
			width: 4,
		});
		const leaves = nodes.filter((n) => n.leaf);
		expect(leaves.map((n) => n.datum.index)).toEqual([0, 1, 2, 3]);
		// One leaf per unit slot, at its centre, all at the far side.
		expect(leaves.map((n) => n.x)).toEqual([0.5, 1.5, 2.5, 3.5]);
		for (const leaf of leaves) expect(leaf.y).toBe(1);
		// The first merge (at 1 of 4) sits a quarter of the way in from the leaves.
		const first = nodes.find((n) => n.datum.height === 1);
		expect(first?.y).toBeCloseTo(0.75);
	});
});
