/**
 * `networkGraph` and `diGraph`: one node per vertex and edge (plus labels),
 * edges trimmed to the discs, a two-phase reveal bound straight to the parts,
 * and a layout that only re-runs when the graph or its options change.
 * Driving `progress` on a large graph touches nothing but the parts'
 * `progress`.
 */

import { describe, expect, it } from "vitest";
import type {
	GraphData,
	GraphLayoutOptions,
	Point,
	VertexId,
} from "../geometry";
import { edgeKey, graphLayouts } from "../geometry";
import { track } from "../reactive";
import { Invalidate, themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import type { SceneNode } from "../scene/types";
import { circle } from "../shapes/circle";
import type { ShapeSpec, TextSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { diGraph, networkGraph, networkHandle } from "./network-graph";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return {
		graph,
		commit: () => graph.commit(),
		shapes: () => graph.frame.filter((s): s is ShapeSpec => s.kind === "shape"),
		texts: () => graph.frame.filter((s): s is TextSpec => s.kind === "text"),
	};
}

const square = {
	vertices: [1, 2, 3, 4],
	edges: [
		[1, 2],
		[2, 3],
		[3, 4],
		[4, 1],
	] as [number, number][],
	layout: "circular" as const,
};

/** Discs are closed; edges are open. */
const discs = (shapes: ShapeSpec[]) => shapes.filter((s) => s.closed);
const edges = (shapes: ShapeSpec[]) => shapes.filter((s) => !s.closed);

describe("networkGraph", () => {
	it("is a composite whose progress binds rather than rebuilds", () => {
		expect(networkGraph.name).toBe("NetworkGraph");
		expect(networkGraph.kind).toBe("composite");
		expect(networkGraph.container).toBe(true);
		expect(networkGraph.descriptor.progress.invalidates).toBe(Invalidate.NONE);
		expect(networkGraph.descriptor.vertices.invalidates).toBe(
			Invalidate.UPDATE,
		);
		expect(diGraph.descriptor.directed.default).toBe(true);
	});

	it("draws edges then vertices, each edge trimmed to the discs", () => {
		const { graph, commit, shapes } = manualGraph();
		const node = graph.root.add(networkGraph.create(square));
		commit();
		expect(discs(shapes())).toHaveLength(4);
		expect(edges(shapes())).toHaveLength(4);
		// Tree order: the four edges first.
		expect(
			node.children.slice(0, 4).every((child) => child.type === "Line"),
		).toBe(true);
		const handle = networkHandle(node);
		const a = handle.positionOf(1) as Point;
		const b = handle.positionOf(2) as Point;
		const [from, to] = edges(shapes())[0]?.polylines[0] ?? [];
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const drawn = Math.hypot(
			(to?.x ?? 0) - (from?.x ?? 0),
			(to?.y ?? 0) - (from?.y ?? 0),
		);
		expect(drawn).toBeCloseTo(length - 2 * (0.16 + 0.02), 9);
		expect(edges(shapes())[0]?.style.stroke).toBe(theme.palette.muted);
		expect(discs(shapes())[0]?.style.fill).toBe(theme.palette.accent);
	});

	it("labels vertices, growing the disc to fit, and labels edges from configs", () => {
		const { graph, commit, texts } = manualGraph();
		const node = graph.root.add(
			networkGraph.create({
				...square,
				labels: { 1: "start" },
				edgeConfigs: { [edgeKey(2, 1)]: { label: "w", stroke: "#ff0000" } },
			}),
		);
		commit();
		expect(
			texts()
				.map((t) => t.text)
				.sort(),
		).toEqual(["start", "w"]);
		expect(networkHandle(node).radiusOf(1)).toBeGreaterThan(0.16);
		expect(networkHandle(node).radiusOf(2)).toBe(0.16);
		// Undirected: the reverse key matched edge (1, 2).
		const edge = networkHandle(node).edgeHandle(1, 2) as SceneNode<{
			stroke?: string;
		}>;
		expect(edge.get("stroke")).toBe("#ff0000");
		expect(networkHandle(node).edgeHandle(2, 1)).toBe(edge);
	});

	it("splits progress: vertices first, then edges, with an edge's own cap", () => {
		const { graph, commit, shapes } = manualGraph();
		graph.root.add(
			networkGraph.create({
				...square,
				progress: 0.25,
				edgeConfigs: { [edgeKey(1, 2)]: { progress: 0.3 } },
			}),
		);
		commit();
		for (const disc of discs(shapes()))
			expect(disc.progress).toBeCloseTo(0.5, 12);
		for (const edge of edges(shapes())) expect(edge.progress).toBe(0);
	});

	it("drives progress on a large graph without re-running the layout or any outline", () => {
		const { graph, commit, shapes } = manualGraph();
		let layouts = 0;
		const counting = (data: GraphData, options: GraphLayoutOptions) => {
			layouts++;
			return graphLayouts.circular(data, options);
		};
		const vertices = Array.from({ length: 80 }, (_, i) => i);
		const progress = track(0);
		graph.root.add(
			networkGraph.create({
				vertices,
				edges: vertices.slice(1).map((v) => [v - 1, v] as [number, number]),
				layout: counting,
				progress,
			}),
		);
		commit();
		// The local outline arrays: the identity the renderer's caches key on.
		const outlines = shapes().map((s) => s.local?.curvePaths);
		expect(outlines.every((curves) => curves !== undefined)).toBe(true);
		for (let step = 1; step <= 8; step++) {
			progress.set(step / 8);
			commit();
		}
		expect(layouts).toBe(1);
		shapes().forEach((spec, index) => {
			expect(spec.local?.curvePaths).toBe(outlines[index]);
		});
		for (const spec of shapes()) expect(spec.progress).toBe(1);
	});

	it("re-runs the layout only for the graph, not for a restyle", () => {
		const { graph, commit, shapes } = manualGraph();
		let layouts = 0;
		const counting = (data: GraphData, options: GraphLayoutOptions) => {
			layouts++;
			return graphLayouts.circular(data, options);
		};
		const node = graph.root.add(
			networkGraph.create({ ...square, layout: counting }),
		);
		commit();
		const children = [...node.children];
		node.set("vertexConfigs", { 3: { color: "#00ff00" } });
		commit();
		expect(layouts).toBe(1);
		expect(node.children).toEqual(children);
		expect(discs(shapes())[2]?.style.fill).toBe("#00ff00");
		node.set("vertices", [1, 2, 3, 4, 5]);
		commit();
		expect(layouts).toBe(2);
		expect(discs(shapes())).toHaveLength(5);
	});

	it("caps drawn vertices but positions every one", () => {
		const { graph, commit, shapes } = manualGraph();
		const vertices = Array.from({ length: 405 }, (_, i) => i);
		const node = graph.root.add(
			networkGraph.create({ vertices, edges: [], layout: "grid" }),
		);
		commit();
		expect(discs(shapes())).toHaveLength(400);
		expect(networkHandle(node).vertexIds()).toHaveLength(405);
		expect(networkHandle(node).vertexHandle(404)).toBeUndefined();
	});

	it("draws vertices with renderVertex, keeping the node it returns", () => {
		const { graph, commit, shapes } = manualGraph();
		const calls: VertexId[] = [];
		const node = graph.root.add(
			networkGraph.create({
				...square,
				renderVertex: (vertex, previous) => {
					calls.push(vertex.id);
					const disc =
						(previous as ReturnType<typeof circle.create> | undefined) ??
						circle.create({ radius: 0.05 });
					return disc.update({ center: vertex.at, progress: vertex.progress });
				},
			}),
		);
		commit();
		const first = networkHandle(node).vertexHandle(1);
		expect(discs(shapes())).toHaveLength(4);
		node.set("vertexConfig", { color: "#123456" });
		commit();
		expect(networkHandle(node).vertexHandle(1)).toBe(first);
		expect(calls).toHaveLength(8);
	});

	it("places its children after the graph", () => {
		const { graph, commit } = manualGraph();
		const extra = circle.create({ radius: 1 });
		const node = graph.root.add(
			networkGraph.create({ ...square, children: [extra] }),
		);
		commit();
		expect(node.children.at(-1)).toBe(extra);
	});
});

describe("diGraph", () => {
	it("draws arrows and keeps (u, v) apart from (v, u)", () => {
		const { graph, commit, shapes } = manualGraph();
		const node = graph.root.add(
			diGraph.create({
				...square,
				edgeConfigs: { [edgeKey(2, 1)]: { stroke: "#ff0000" } },
			}),
		);
		commit();
		const arrows = node.children.filter((child) => child.type === "Arrow");
		expect(arrows).toHaveLength(4);
		expect(networkHandle(node).edgeHandle(2, 1)).toBeUndefined();
		expect(shapes().some((s) => s.style.stroke === "#ff0000")).toBe(false);
		node.set("directed", false);
		commit();
		expect(node.children.filter((child) => child.type === "Line")).toHaveLength(
			4,
		);
	});
});
