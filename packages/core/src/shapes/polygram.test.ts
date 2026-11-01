/**
 * Polygons, polygrams, paths and plots. `star`/`regularPolygram` name their geometry angle
 * `startAngle` and `cross` leaves scaling to `ShapeProps.scale`, so
 * `rotation`/`scale` apply exactly once. Plus spec tests per definition.
 */

import { describe, expect, it } from "vitest";
import {
	pathDataToCurvePath,
	plotPolyline,
	polylineToCurvePath,
	regularPolygon,
} from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import { cross } from "./matchers.js";
import { path, plot } from "./path.js";
import { polygon } from "./polygon.js";
import { polygram, regularPolygram, star } from "./polygram.js";
import { openRing } from "./rect.js";
import { expectBaked, manualGraph, shapeSpec } from "./test-graph.js";

function firstPoint(node: Parameters<typeof shapeSpec>[0]) {
	const first = shapeSpec(node).polylines[0]?.[0];
	if (!first) throw new Error("expected a point");
	return first;
}

describe("single application of rotation/scale", () => {
	it("star: rotation turns the shape once about its centre", () => {
		// 4 spikes is point-symmetric, so the bbox centre is the star's centre.
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			star.create({
				outerRadius: 2,
				innerRadius: 1,
				points: 4,
				rotation: Math.PI,
			}),
		);
		commit();
		const first = firstPoint(node);
		// Default first spike is at +y; a half turn puts it at -y.
		expect(first.x).toBeCloseTo(0, 6);
		expect(first.y).toBeCloseTo(-2, 6);
	});

	it("star: startAngle places the first spike in the geometry", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			star.create({ outerRadius: 2, innerRadius: 1, points: 4, startAngle: 0 }),
		);
		commit();
		const first = firstPoint(node);
		expect(first.x).toBeCloseTo(2, 6);
		expect(first.y).toBeCloseTo(0, 6);
	});

	it("regularPolygram: rotation turns the shape once about its centre", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			regularPolygram.create({
				radius: 2,
				sides: 4,
				density: 1,
				rotation: Math.PI,
			}),
		);
		commit();
		const first = firstPoint(node);
		expect(first.x).toBeCloseTo(0, 6);
		expect(first.y).toBeCloseTo(-2, 6);
	});

	it("cross: scale grows the X once about the target centre", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			cross.create({
				target: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
				scale: 2,
			}),
		);
		commit();
		const xs = shapeSpec(node)
			.polylines.flat()
			.map((point) => point.x);
		expect(Math.max(...xs)).toBeCloseTo(2, 6);
		expect(Math.min(...xs)).toBeCloseTo(-2, 6);
	});
});

describe("polygrams", () => {
	it("regularPolygram {6/2} is two loops", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			regularPolygram.create({ radius: 1, sides: 6 }),
		);
		commit();
		expect(shapeSpec(node).curvePaths).toHaveLength(2);
		expect(shapeSpec(node).closed).toBe(true);
	});

	it("polygram closes each vertex group", () => {
		const { graph, commit } = manualGraph();
		const triangle = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
		];
		const node = graph.root.add(
			polygram.create({ vertexGroups: [triangle, triangle] }),
		);
		commit();
		expectBaked(node, {
			closed: true,
			curvePaths: [
				polylineToCurvePath(triangle, true),
				polylineToCurvePath(triangle, true),
			],
		});
	});
});

describe("polygon", () => {
	it("a regular polygon is built about the origin and moved by its centre", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			polygon.create({ sides: 5, radius: 2, center: { x: 1, y: 1 } }),
		);
		commit();
		expect(polygon.descriptor.center.invalidates).toBe(Invalidate.TRANSFORM);
		expectBaked(
			node,
			{
				closed: true,
				curvePaths: [
					polylineToCurvePath(openRing(regularPolygon(0, 0, 2, 5)), true),
				],
			},
			{},
			{ x: 1, y: 1 },
		);
		const curves = shapeSpec(node).local?.curvePaths;
		node.set("center", { x: 3, y: 0 });
		commit();
		expect(shapeSpec(node).local?.curvePaths).toBe(curves);
	});

	it("explicit points sit where they are, ignoring the centre", () => {
		const { graph, commit } = manualGraph();
		const points = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 2 },
		];
		const node = graph.root.add(
			polygon.create({ points, center: { x: 5, y: 5 } }),
		);
		commit();
		expectBaked(node, {
			closed: true,
			curvePaths: [polylineToCurvePath(points, true)],
		});
	});
});

describe("path and plot", () => {
	it("path takes curvePoints, then points, then pathData", () => {
		const { graph, commit } = manualGraph();
		const fromData = graph.root.add(
			path.create({ pathData: "M0 0 L1 1 L2 0 Z" }),
		);
		const fromPoints = graph.root.add(
			path.create({
				points: [
					{ x: 0, y: 0 },
					{ x: 1, y: 1 },
				],
				pathData: "M5 5 L6 6",
			}),
		);
		const empty = graph.root.add(path.create({}));
		commit();
		expectBaked(fromData, {
			closed: true,
			curvePaths: pathDataToCurvePath("M0 0 L1 1 L2 0 Z"),
		});
		expectBaked(fromPoints, {
			closed: false,
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 1, y: 1 },
				],
			],
		});
		expect(shapeSpec(empty).polylines).toEqual([]);
	});

	it("plot samples its function", () => {
		const { graph, commit } = manualGraph();
		const fn = (t: number) => ({ x: t, y: t * t });
		const node = graph.root.add(
			plot.create({ function: fn, from: -1, to: 1, samples: 8 }),
		);
		commit();
		expectBaked(node, {
			closed: false,
			curvePaths: [polylineToCurvePath(plotPolyline(fn, -1, 1, 8), false)],
		});
	});
});
