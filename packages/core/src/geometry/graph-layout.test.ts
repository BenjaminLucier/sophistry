import { describe, expect, it } from "vitest";
import type { GraphData, GraphLayoutSpec } from "./graph-layout.js";
import {
	circularLayout,
	edgeKey,
	explicitLayout,
	gridLayout,
	partiteLayout,
	pathEdges,
	resolveGraphLayout,
	shellLayout,
	springGrowth,
	springLayout,
	springTrajectory,
	treeLayout,
} from "./graph-layout.js";

function expectFinite(points: Iterable<{ x: number; y: number }>) {
	for (const p of points) {
		expect(Number.isFinite(p.x)).toBe(true);
		expect(Number.isFinite(p.y)).toBe(true);
	}
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
	const value = map.get(key);
	if (value === undefined) throw new Error(`missing key: ${String(key)}`);
	return value;
}

const triangle: GraphData = {
	vertices: ["a", "b", "c"],
	edges: [
		{ source: "a", target: "b" },
		{ source: "b", target: "c" },
		{ source: "c", target: "a" },
	],
};

describe("empty and single-vertex graphs", () => {
	const empty: GraphData = { vertices: [], edges: [] };
	const single: GraphData = { vertices: ["only"], edges: [] };

	for (const [name, layout] of Object.entries({
		circular: circularLayout,
		grid: gridLayout,
		shell: shellLayout,
		tree: treeLayout,
		spring: springLayout,
		partite: partiteLayout,
	})) {
		it(`${name} layout: empty graph gives empty map`, () => {
			expect(layout(empty, {}).size).toBe(0);
		});

		it(`${name} layout: single vertex sits at center (default origin)`, () => {
			const result = layout(single, {});
			expect(result.size).toBe(1);
			const p = result.get("only");
			expect(p).toBeDefined();
			expect(Number.isFinite(p?.x)).toBe(true);
			expect(Number.isFinite(p?.y)).toBe(true);
		});
	}
});

describe("circularLayout", () => {
	// `fit: "none"` with no `center` bypasses `finish`'s bounding-box recentring
	// (see `finish` in graph-layout.ts), so the raw unit-circle coordinates come
	// back untouched — the fitted (default "contain") coordinates are *not*
	// equidistant from {0,0}, since the box is centred on the bounding box's
	// midpoint, not the ring's true centre, whenever the sample points aren't
	// symmetric about the origin (true for an odd vertex count).

	it("places vertices evenly on a ring, equidistant from center", () => {
		const result = circularLayout(triangle, { fit: "none" });
		const points = [...result.values()];
		const radii = points.map((p) => Math.hypot(p.x, p.y));
		for (const r of radii) expect(r).toBeCloseTo(radii[0], 6);
	});

	it("clockwise flips the direction of travel", () => {
		const ccw = circularLayout(triangle, { fit: "none" });
		const cw = circularLayout(triangle, { fit: "none", clockwise: true });
		const a = mustGet(ccw, "a");
		const aCw = mustGet(cw, "a");
		// first vertex position should be the same (both start at startAngle)
		expect(a.x).toBeCloseTo(aCw.x, 6);
		expect(a.y).toBeCloseTo(aCw.y, 6);
		const b = mustGet(ccw, "b");
		const bCw = mustGet(cw, "b");
		expect(b.x).not.toBeCloseTo(bCw.x, 3);
	});
});

describe("gridLayout", () => {
	it("lays out vertices row-major with default sqrt(n) columns", () => {
		const graph: GraphData = { vertices: ["a", "b", "c", "d"], edges: [] };
		const result = gridLayout(graph, { fit: "none" });
		const a = mustGet(result, "a");
		const b = mustGet(result, "b");
		// columns = ceil(sqrt(4)) = 2, so a and b are on the same row.
		expect(a.y).toBeCloseTo(b.y, 6);
		expect(b.x).toBeGreaterThan(a.x);
	});

	it("respects an explicit columns count", () => {
		const graph: GraphData = { vertices: ["a", "b", "c"], edges: [] };
		const result = gridLayout(graph, { columns: 1, fit: "none" });
		const a = mustGet(result, "a");
		const b = mustGet(result, "b");
		expect(a.x).toBeCloseTo(b.x, 6);
		expect(b.y).toBeLessThan(a.y); // rows run downward
	});
});

describe("shellLayout", () => {
	it("a single-vertex ring sits at the centre", () => {
		const graph: GraphData = { vertices: ["root", "a", "b"], edges: [] };
		const result = shellLayout(graph, {
			partitions: [["root"], ["a", "b"]],
			fit: "none",
		});
		const root = mustGet(result, "root");
		expect(root.x).toBeCloseTo(0, 6);
		expect(root.y).toBeCloseTo(0, 6);
	});

	it("degrades honestly for disconnected/unreachable vertices (finite output)", () => {
		const graph: GraphData = { vertices: ["a", "b", "c"], edges: [] };
		const result = shellLayout(graph, {});
		expectFinite(result.values());
	});
});

describe("treeLayout", () => {
	it("root sits at the top level; children are one level down", () => {
		const graph: GraphData = {
			vertices: ["root", "a", "b"],
			edges: [
				{ source: "root", target: "a" },
				{ source: "root", target: "b" },
			],
		};
		const result = treeLayout(graph, { root: "root", fit: "none" });
		const root = mustGet(result, "root");
		const a = mustGet(result, "a");
		const b = mustGet(result, "b");
		// default direction is "down", meaning y decreases with depth
		expect(a.y).toBeLessThan(root.y);
		expect(b.y).toBeLessThan(root.y);
		expect(a.x).not.toBeCloseTo(b.x, 6);
	});

	it("lays out a graph with a cycle as a BFS spanning tree without throwing", () => {
		const cyclic: GraphData = {
			vertices: ["a", "b", "c"],
			edges: [
				{ source: "a", target: "b" },
				{ source: "b", target: "c" },
				{ source: "c", target: "a" },
			],
		};
		const result = treeLayout(cyclic, {});
		expect(result.size).toBe(3);
		expectFinite(result.values());
	});

	it("does not re-place a second root that sits in the first root's component", () => {
		const chain: GraphData = {
			vertices: ["a", "b", "c"],
			edges: [
				{ source: "a", target: "b" },
				{ source: "b", target: "c" },
			],
		};
		const result = treeLayout(chain, { root: ["a", "b"], fit: "none" });
		const a = mustGet(result, "a");
		const b = mustGet(result, "b");
		const c = mustGet(result, "c");
		expect(b.y).toBeLessThan(a.y);
		expect(c.y).toBeLessThan(b.y);
	});

	it("packs a forest side by side without overlapping roots", () => {
		const forest: GraphData = {
			vertices: ["a", "b", "c", "d"],
			edges: [{ source: "a", target: "b" }],
			// c, d form a second, disconnected component
		};
		forest.edges = [...forest.edges, { source: "c", target: "d" }];
		const result = treeLayout(forest, { fit: "none" });
		const a = mustGet(result, "a");
		const c = mustGet(result, "c");
		expect(a.x).not.toBeCloseTo(c.x, 3);
	});
});

describe("fit modes", () => {
	it("'stretch' fills the box exactly on each axis independently, distorting proportions", () => {
		// A 2x1 grid (one row, two columns) has a span of 1 in x and 0 in y.
		// Use a taller graph instead so both axes have a real span to distort.
		const graph: GraphData = { vertices: ["a", "b", "c", "d"], edges: [] };
		// grid with 2 columns: (0,0) (1,0) / (0,-1) (1,-1) -> spanX=1, spanY=1 in
		// layout space. Stretch into a very wide, short box: scaleX should differ
		// hugely from scaleY, unlike "contain" which keeps them equal.
		const stretched = gridLayout(graph, {
			columns: 2,
			fit: "stretch",
			scale: { width: 20, height: 2 },
		});
		const contained = gridLayout(graph, {
			columns: 2,
			fit: "contain",
			scale: { width: 20, height: 2 },
		});

		const a = mustGet(stretched, "a");
		const b = mustGet(stretched, "b");
		const c = mustGet(stretched, "c");
		// x-span across the box should be close to the full requested width (20),
		// and y-span close to the full requested height (2) -- "stretch" fills both.
		expect(Math.abs(b.x - a.x)).toBeCloseTo(20, 6);
		expect(Math.abs(a.y - c.y)).toBeCloseTo(2, 6);

		const aContained = mustGet(contained, "a");
		const bContained = mustGet(contained, "b");
		const cContained = mustGet(contained, "c");
		// "contain" uses one uniform scale factor (limited by the smaller axis),
		// so it does NOT fill the wide box on x the way "stretch" does.
		expect(Math.abs(bContained.x - aContained.x)).toBeLessThan(20);
		expect(Math.abs(aContained.y - cContained.y)).toBeCloseTo(2, 6);
	});

	it("a degenerate single-axis span under 'stretch' falls back to no scale (1), not Infinity/NaN", () => {
		// All vertices on one row: spanY === 0 in layout space.
		const graph: GraphData = { vertices: ["a", "b", "c"], edges: [] };
		const result = gridLayout(graph, {
			columns: 3,
			fit: "stretch",
			scale: { width: 9, height: 5 },
		});
		expectFinite(result.values());
		const a = mustGet(result, "a");
		const b = mustGet(result, "b");
		// All three share the same row (spanY=0), so the y coordinates must be
		// identical and finite rather than NaN/Infinity from a 0-span scale factor.
		expect(a.y).toBeCloseTo(b.y, 9);
		expect(Number.isFinite(a.y)).toBe(true);
	});

	it("a degenerate single-axis span under 'contain' also falls back sanely", () => {
		const graph: GraphData = { vertices: ["a", "b", "c"], edges: [] };
		const result = gridLayout(graph, {
			columns: 3,
			fit: "contain",
			scale: { width: 9, height: 5 },
		});
		expectFinite(result.values());
	});
});

describe("directed graphs and pickRoots", () => {
	it("prefers an indegree-0 vertex as the tree root when directed and no root is given", () => {
		// Declaration order is a, b, c but the actual source of the chain is c:
		// c -> b -> a. Undirected BFS would find any of them as "first"; the
		// directed root-picking branch in pickRoots should still land on c.
		const graph: GraphData = {
			vertices: ["a", "b", "c"],
			edges: [
				{ source: "c", target: "b" },
				{ source: "b", target: "a" },
			],
			directed: true,
		};
		const result = treeLayout(graph, { fit: "none" });
		const a = mustGet(result, "a");
		const b = mustGet(result, "b");
		const c = mustGet(result, "c");
		// default direction "down": y decreases with depth from the root.
		expect(c.y).toBeGreaterThan(b.y);
		expect(b.y).toBeGreaterThan(a.y);
	});

	it("without `directed`, the same edges pick the first-declared vertex of the component as root", () => {
		const graph: GraphData = {
			vertices: ["a", "b", "c"],
			edges: [
				{ source: "c", target: "b" },
				{ source: "b", target: "a" },
			],
			// directed omitted -> falls back to "first vertex in declaration order"
		};
		const result = treeLayout(graph, { fit: "none" });
		const a = mustGet(result, "a");
		const c = mustGet(result, "c");
		// "a" is declared first, so it should be the root (top level, greatest y).
		expect(a.y).toBeGreaterThan(c.y);
	});
});

describe("partiteLayout", () => {
	it("groups columns along the direction axis", () => {
		const graph: GraphData = {
			vertices: ["a", "b", "c"],
			edges: [],
		};
		const result = partiteLayout(graph, {
			partitions: [["a"], ["b", "c"]],
			direction: "right",
			fit: "none",
		});
		const a = mustGet(result, "a");
		const b = mustGet(result, "b");
		expect(b.x).toBeGreaterThan(a.x);
	});
});

describe("explicitLayout", () => {
	it("returns caller coordinates unchanged with fit 'none' and no center", () => {
		const graph: GraphData = { vertices: ["a", "b"], edges: [] };
		const positions = new Map([
			["a", { x: 3, y: 4 }],
			["b", { x: -1, y: -1 }],
		]);
		const result = explicitLayout(graph, { positions });
		expect(result.get("a")).toEqual({ x: 3, y: 4 });
		expect(result.get("b")).toEqual({ x: -1, y: -1 });
	});

	it("places a vertex with a missing position on a ring around the known ones", () => {
		const graph: GraphData = { vertices: ["a", "b"], edges: [] };
		const positions = new Map([["a", { x: 0, y: 0 }]]);
		const result = explicitLayout(graph, { positions });
		expect(result.get("a")).toEqual({ x: 0, y: 0 });
		const b = mustGet(result, "b");
		expect(Number.isFinite(b.x)).toBe(true);
		expect(Number.isFinite(b.y)).toBe(true);
	});

	it("supports a plain Record in addition to a Map", () => {
		const graph: GraphData = { vertices: ["a"], edges: [] };
		const result = explicitLayout(graph, { positions: { a: { x: 5, y: 6 } } });
		expect(result.get("a")).toEqual({ x: 5, y: 6 });
	});

	it("a non-finite position is treated as missing rather than propagated", () => {
		const graph: GraphData = { vertices: ["a"], edges: [] };
		const result = explicitLayout(graph, {
			positions: new Map([["a", { x: Number.NaN, y: 0 }]]),
		});
		const p = mustGet(result, "a");
		expect(Number.isFinite(p.x)).toBe(true);
		expect(Number.isFinite(p.y)).toBe(true);
	});
});

describe("springLayout", () => {
	it("is deterministic: same graph and options give byte-identical positions", () => {
		const a = springLayout(triangle, { iterations: 50 });
		const b = springLayout(triangle, { iterations: 50 });
		for (const id of triangle.vertices) {
			expect(a.get(id)).toEqual(b.get(id));
		}
	});

	it("keeps a disconnected graph's components inside the fitted box", () => {
		const disconnected: GraphData = {
			vertices: ["a", "b", "c", "d"],
			edges: [{ source: "a", target: "b" }],
		};
		const result = springLayout(disconnected, { scale: 4, iterations: 100 });
		for (const p of result.values()) {
			expect(Math.abs(p.x)).toBeLessThanOrEqual(2 + 1e-6);
			expect(Math.abs(p.y)).toBeLessThanOrEqual(2 + 1e-6);
		}
	});

	it("drops self-loops and duplicate edges without crashing", () => {
		const graph: GraphData = {
			vertices: ["a", "b"],
			edges: [
				{ source: "a", target: "a" },
				{ source: "a", target: "b" },
				{ source: "a", target: "b" },
			],
		};
		const result = springLayout(graph, { iterations: 20 });
		expect(result.size).toBe(2);
		expectFinite(result.values());
	});

	it("appends vertices named only by an edge", () => {
		const graph: GraphData = {
			vertices: ["a"],
			edges: [{ source: "a", target: "b" }],
		};
		const result = springLayout(graph, { iterations: 10 });
		expect(result.size).toBe(2);
		expect(result.has("b")).toBe(true);
	});
});

describe("springTrajectory", () => {
	it("last frame equals what springLayout returns for the same options", () => {
		const options = { iterations: 30, seed: 1 };
		const trajectory = springTrajectory(triangle, options);
		const finalLayout = springLayout(triangle, options);
		const lastFrame = trajectory[trajectory.length - 1];
		for (const id of triangle.vertices) {
			const a = mustGet(lastFrame, id);
			const b = mustGet(finalLayout, id);
			expect(a.x).toBeCloseTo(b.x, 9);
			expect(a.y).toBeCloseTo(b.y, 9);
		}
	});

	it("has iterations+1 frames without samples thinning", () => {
		const trajectory = springTrajectory(triangle, { iterations: 10 });
		expect(trajectory.length).toBe(11);
	});

	it("thins to `samples` frames when given", () => {
		const trajectory = springTrajectory(triangle, {
			iterations: 50,
			samples: 5,
		});
		expect(trajectory.length).toBe(5);
	});

	it("empty graph gives no frames", () => {
		expect(springTrajectory({ vertices: [], edges: [] }, {})).toEqual([]);
	});
});

describe("springGrowth", () => {
	it("returns one entry per vertex arrival", () => {
		const steps = springGrowth(triangle, { iterations: 20 });
		expect(steps.length).toBe(3);
		expect(steps[0].size).toBe(1);
		expect(steps[steps.length - 1].size).toBe(3);
	});

	it("empty graph gives no steps", () => {
		expect(springGrowth({ vertices: [], edges: [] }, {})).toEqual([]);
	});
});

describe("resolveGraphLayout", () => {
	it("resolves a name to the matching built-in", () => {
		expect(resolveGraphLayout("circular")).toBe(circularLayout);
	});

	it("passes a function straight through", () => {
		const custom = () => new Map();
		expect(resolveGraphLayout(custom)).toBe(custom);
	});

	it("falls back to spring when undefined", () => {
		expect(resolveGraphLayout(undefined)).toBe(springLayout);
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() => resolveGraphLayout("nonexistent" as GraphLayoutSpec)).toThrow(
			/Unknown graph layout "nonexistent"/,
		);
	});

	it("a custom layout is passed as a value, unchanged", () => {
		const mine = () => new Map();
		expect(resolveGraphLayout(mine)).toBe(mine);
	});
});

describe("edgeKey / pathEdges", () => {
	it("edgeKey separates ids with a space, not a dash", () => {
		expect(edgeKey("a", "b")).toBe("a b");
	});

	it("edgeKey does not collide for ids containing spaces", () => {
		expect(edgeKey("a b", "c")).not.toBe(edgeKey("a", "b c"));
		expect(edgeKey("a\\", "b")).not.toBe(edgeKey("a", "\\b"));
		expect(edgeKey("a b", "c")).toBe("a\\ b c");
	});

	it("pathEdges turns a walk into consecutive pairs", () => {
		expect(pathEdges(["a", "b", "c"])).toEqual([
			["a", "b"],
			["b", "c"],
		]);
	});

	it("pathEdges of a single vertex is empty", () => {
		expect(pathEdges(["a"])).toEqual([]);
	});
});
