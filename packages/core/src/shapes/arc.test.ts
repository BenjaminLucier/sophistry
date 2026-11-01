/**
 * The arc family, angle marks and beziers: they are built where they sit,
 * so each spec equals `bake()` of the same outline, and a zero sweep draws
 * nothing.
 */

import { describe, expect, it } from "vitest";
import {
	angleArcCurvePath,
	annularSectorCurvePath,
	annulusCurvePaths,
	arcBetweenPointsCurvePath,
	arcCurvePath,
	elbowPolyline,
	polylineToCurvePath,
	quadraticToCubic,
	rightAngleMarkPolyline,
	sectorCurvePath,
} from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import { angle, elbow, resolveAngleAnchor, rightAngle } from "./angle.js";
import {
	annularSector,
	annulus,
	arc,
	arcBetweenPoints,
	sector,
} from "./arc.js";
import { cubicBezier, quadraticBezier } from "./bezier.js";
import { expectBaked, manualGraph, shapeSpec } from "./test-graph.js";

describe("arc family", () => {
	it("describes its props as outline inputs", () => {
		expect(arc.name).toBe("Arc");
		expect(arc.descriptor.center.invalidates).toBe(Invalidate.GEOMETRY);
		expect(arc.descriptor.angle.instanceable).toBe(true);
		expect(sector.name).toBe("Sector");
	});

	it("arc matches bake() about its centre", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			arc.create({
				center: { x: 1, y: 2 },
				radius: 2,
				startAngle: 0.5,
				angle: 1,
			}),
		);
		commit();
		expectBaked(node, {
			closed: false,
			curvePaths: [arcCurvePath(1, 2, 2, 0.5, 1.5)],
		});
	});

	it("draws nothing with no sweep", () => {
		const { graph, commit } = manualGraph();
		const open = graph.root.add(arc.create({ radius: 1, angle: 0 }));
		const slice = graph.root.add(sector.create({ radius: 1, angle: 0 }));
		const band = graph.root.add(
			annularSector.create({ innerRadius: 1, outerRadius: 2, angle: 0 }),
		);
		commit();
		for (const node of [open, slice, band]) {
			expect(shapeSpec(node).polylines).toEqual([]);
			expect(shapeSpec(node).closed).toBe(false);
		}
	});

	it("sector, annulus and annular sector are closed", () => {
		const { graph, commit } = manualGraph();
		const slice = graph.root.add(sector.create({ radius: 1, fill: "red" }));
		const ring = graph.root.add(
			annulus.create({
				innerRadius: 1,
				outerRadius: 2,
				center: { x: 1, y: 0 },
			}),
		);
		const band = graph.root.add(
			annularSector.create({ innerRadius: 1, outerRadius: 2, startAngle: 1 }),
		);
		commit();
		expectBaked(
			slice,
			{
				closed: true,
				curvePaths: [sectorCurvePath(0, 0, 1, 0, Math.PI / 2)],
			},
			{ fill: "red" },
		);
		expectBaked(ring, {
			closed: true,
			curvePaths: annulusCurvePaths(1, 0, 1, 2),
		});
		expectBaked(band, {
			closed: true,
			curvePaths: [annularSectorCurvePath(0, 0, 1, 2, 1, 1 + Math.PI / 2)],
		});
	});

	it("arcBetweenPoints turns a quarter by default", () => {
		const { graph, commit } = manualGraph();
		const from = { x: -1, y: 0 };
		const to = { x: 1, y: 0 };
		const node = graph.root.add(arcBetweenPoints.create({ from, to }));
		commit();
		expectBaked(node, {
			closed: false,
			curvePaths: [arcBetweenPointsCurvePath(from, to, Math.PI / 2)],
		});
	});
});

describe("angle marks", () => {
	it("resolves two segments to their crossing", () => {
		const resolvedAnchor = resolveAngleAnchor({
			line1: { from: { x: -1, y: 0 }, to: { x: 1, y: 0 } },
			line2: { from: { x: 0, y: -1 }, to: { x: 0, y: 1 } },
		});
		expect(resolvedAnchor.vertex).toEqual({ x: 0, y: 0 });
		expect(resolvedAnchor.from).toEqual({ x: 2, y: 0 });
		expect(resolvedAnchor.to).toEqual({ x: 0, y: 2 });
	});

	it("angle, rightAngle and elbow match bake() of their marks", () => {
		const { graph, commit } = manualGraph();
		const vertex = { x: 1, y: 1 };
		const arcMark = graph.root.add(angle.create({ vertex, otherAngle: true }));
		const square = graph.root.add(rightAngle.create({ vertex, size: 0.5 }));
		const corner = graph.root.add(elbow.create({ vertex, angle: 1 }));
		commit();
		expectBaked(arcMark, {
			closed: false,
			curvePaths: [
				angleArcCurvePath(vertex, { x: 2, y: 1 }, { x: 1, y: 2 }, 0.6, {
					otherAngle: true,
					quadrant: undefined,
				}),
			],
		});
		expectBaked(square, {
			closed: false,
			curvePaths: [
				polylineToCurvePath(
					rightAngleMarkPolyline(vertex, { x: 1, y: 0 }, { x: 0, y: 1 }, 0.5),
					false,
				),
			],
		});
		expectBaked(corner, {
			closed: false,
			curvePaths: [polylineToCurvePath(elbowPolyline(vertex, 0.3, 1), false)],
		});
	});
});

describe("beziers", () => {
	it("cubic and quadratic match bake() of one segment", () => {
		const { graph, commit } = manualGraph();
		const from = { x: 0, y: 0 };
		const control = { x: 1, y: 2 };
		const to = { x: 2, y: 0 };
		const cubic = graph.root.add(
			cubicBezier.create({ from, control1: control, control2: control, to }),
		);
		const quadratic = graph.root.add(
			quadraticBezier.create({ from, control, to }),
		);
		commit();
		expectBaked(cubic, {
			closed: false,
			curvePaths: [
				{
					start: from,
					segments: [{ c1: control, c2: control, to }],
					closed: false,
				},
			],
		});
		const [p0, c1, c2, p1] = quadraticToCubic(from, control, to);
		expectBaked(quadratic, {
			closed: false,
			curvePaths: [
				{ start: p0, segments: [{ c1, c2, to: p1 }], closed: false },
			],
		});
	});
});
