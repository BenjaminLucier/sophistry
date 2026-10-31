/**
 * `tangentLine`: the tangent at a proportion of a sampled curve's arc length,
 * with the arc-length table kept across `proportion` changes.
 */

import { describe, expect, it } from "vitest";
import { Invalidate, themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import type { ShapeSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { tangentLine } from "./tangent";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

describe("tangentLine", () => {
	it("is a shape with proportion and length instanceable", () => {
		expect(tangentLine.name).toBe("TangentLine");
		expect(tangentLine.kind).toBe("primitive");
		expect(tangentLine.descriptor.proportion.instanceable).toBe(true);
		expect(tangentLine.descriptor.length.instanceable).toBe(true);
		expect(tangentLine.descriptor.proportion.invalidates).toBe(
			Invalidate.GEOMETRY,
		);
	});

	it("is the segment itself on a straight polyline, centred on the midpoint", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			tangentLine.create({
				points: [
					{ x: 0, y: 0 },
					{ x: 4, y: 4 },
				],
				length: Math.SQRT2 * 2,
			}),
		);
		commit();
		const [start, end] = (node.spec as ShapeSpec).polylines[0] ?? [];
		expect(start?.x).toBeCloseTo(1, 9);
		expect(start?.y).toBeCloseTo(1, 9);
		expect(end?.x).toBeCloseTo(3, 9);
		expect(end?.y).toBeCloseTo(3, 9);
	});

	it("follows a sampled function's slope, and keeps the curve across proportion changes", () => {
		const { graph, commit } = manualGraph();
		let calls = 0;
		const node = graph.root.add(
			tangentLine.create({
				function: (t) => {
					calls++;
					return { x: t, y: t * t };
				},
				from: -1,
				to: 1,
				proportion: 0.5,
			}),
		);
		commit();
		const [a, b] = (node.spec as ShapeSpec).polylines[0] ?? [];
		// At the vertex of the parabola the tangent is horizontal.
		expect((b?.y ?? 0) - (a?.y ?? 0)).toBeCloseTo(0, 6);
		const sampled = calls;
		node.set("proportion", 0.9);
		commit();
		expect(calls).toBe(sampled);
		const [c, d] = (node.spec as ShapeSpec).polylines[0] ?? [];
		expect((d?.y ?? 0) - (c?.y ?? 0)).toBeGreaterThan(0);
	});

	it("draws nothing without a curve", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(tangentLine.create({}));
		commit();
		expect(
			(node.spec as ShapeSpec | null)?.polylines.flat() ?? [],
		).toHaveLength(0);
	});
});
