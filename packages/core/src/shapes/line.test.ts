/**
 * The line family. `curvedArrow` /
 * `curvedDoubleArrow` aim their tip along the shaft's own analytic tangent
 * (`curveEndBearing`, built on `tangentAtT`) rather than the last span of a
 * flattened approximation of it, checked against the same primitives the
 * shapes use. Plus a spec test per definition: every line is built in
 * absolute coordinates, so the specs equal `bake()` of the same outline.
 */

import { describe, expect, it } from "vitest";
import type { CurvePath, Point } from "../geometry";
import {
	arcBetweenPointsCurvePath,
	measureCurve,
	polylineToCurvePath,
	tangentAtT,
} from "../geometry";
import { Invalidate } from "../scene/context";
import {
	arrow,
	curvedArrow,
	curvedDoubleArrow,
	dashedLine,
	dashedLinePattern,
	doubleArrow,
	line,
	tipGeometryAt,
	vector,
} from "./line";
import { darkTheme, expectBaked, manualGraph, shapeSpec } from "./test-graph";

/** Bearing a `"vee"` tip's own three-point polyline was built along: the
 * inverse of `arrowHeadAt`: `tip` is the middle point, and the tip points
 * away from the midpoint of its two wings. */
function veeBearing(vee: Point[]): number {
	const [left, tip, right] = vee as [Point, Point, Point];
	const midX = (left.x + right.x) / 2;
	const midY = (left.y + right.y) / 2;
	return Math.atan2(tip.y - midY, tip.x - midX);
}

const from: Point = { x: -1, y: 0 };
const to: Point = { x: 1, y: 0.4 };
const angle = Math.PI / 2; // a tight quarter-turn: where a chord/finite-difference estimate diverges most from the true tangent

function expectedBearing(curve: CurvePath, atStart: boolean): number {
	const tangent = tangentAtT(measureCurve(curve), atStart ? 0 : 1);
	return atStart
		? Math.atan2(-tangent.y, -tangent.x)
		: Math.atan2(tangent.y, tangent.x);
}

function veeOf(tip: CurvePath | undefined): Point[] {
	if (!tip) throw new Error("expected a tip curve path");
	expect(tip.segments.length).toBeGreaterThan(0);
	return [
		tip.start,
		(tip.segments[0] as { to: Point }).to,
		(tip.segments[1] as { to: Point }).to,
	];
}

describe("curvedArrow tip direction", () => {
	it("aims the end tip along the arc's analytic tangent, not its chord", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(curvedArrow.create({ from, to, angle }));
		commit();
		const spec = shapeSpec(node);
		const curve = arcBetweenPointsCurvePath(from, to, angle);
		// curvePaths: [shaft, tip] for a single-ended curved arrow.
		expect(spec.curvePaths).toHaveLength(2);
		// A chord-based estimate would be off by several degrees on a PI/2 turn;
		// the analytic tangent should match to floating-point precision.
		expect(veeBearing(veeOf(spec.curvePaths?.[1]))).toBeCloseTo(
			expectedBearing(curve, false),
			6,
		);
	});

	it("aims the start tip backwards along the tangent when tipAt is start", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			curvedArrow.create({ from, to, angle, tipAt: "start" }),
		);
		commit();
		const curve = arcBetweenPointsCurvePath(from, to, angle);
		expect(veeBearing(veeOf(shapeSpec(node).curvePaths?.[1]))).toBeCloseTo(
			expectedBearing(curve, true),
			6,
		);
	});
});

describe("curvedDoubleArrow tip direction", () => {
	it("aims both tips along the arc's analytic tangent at each end", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(curvedDoubleArrow.create({ from, to, angle }));
		commit();
		const spec = shapeSpec(node);
		const curve = arcBetweenPointsCurvePath(from, to, angle);
		// curvePaths: [shaft, endTip, startTip].
		expect(spec.curvePaths).toHaveLength(3);
		expect(veeBearing(veeOf(spec.curvePaths?.[1]))).toBeCloseTo(
			expectedBearing(curve, false),
			6,
		);
		expect(veeBearing(veeOf(spec.curvePaths?.[2]))).toBeCloseTo(
			expectedBearing(curve, true),
			6,
		);
	});
});

describe("line", () => {
	it("is described for bindings and instancing", () => {
		expect(line.name).toBe("Line");
		expect(line.descriptor.from.invalidates).toBe(Invalidate.GEOMETRY);
		expect(line.descriptor.to.instanceable).toBe(true);
	});

	it("matches bake() of the segment in absolute coordinates", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			line.create({ from: { x: 0, y: 0 }, to: { x: 2, y: 1 }, stroke: "#f00" }),
		);
		commit();
		expectBaked(
			node,
			{
				closed: false,
				curvePaths: [
					polylineToCurvePath(
						[
							{ x: 0, y: 0 },
							{ x: 2, y: 1 },
						],
						false,
					),
				],
			},
			{ stroke: "#f00" },
		);
	});

	it("draws nothing from a point to itself", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			line.create({ from: { x: 1, y: 1 }, to: { x: 1, y: 1 } }),
		);
		commit();
		expect(shapeSpec(node).polylines).toEqual([]);
	});

	it("keeps its outline for a translation and rebuilds it for an endpoint", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			line.create({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }),
		);
		commit();
		const curves = shapeSpec(node).local?.curvePaths;
		node.set("x", 3);
		commit();
		expect(shapeSpec(node).local?.curvePaths).toBe(curves);
		node.set("to", { x: 2, y: 0 });
		commit();
		expect(shapeSpec(node).local?.curvePaths).not.toBe(curves);
	});
});

describe("arrow", () => {
	it("is the shaft then a vee tip, with fillFrom 1", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			arrow.create({ from: { x: 0, y: 0 }, to: { x: 2, y: 0 } }),
		);
		commit();
		const shaft = polylineToCurvePath(
			[
				{ x: 0, y: 0 },
				{ x: 2, y: 0 },
			],
			false,
		);
		const tip = tipGeometryAt("vee", { x: 2, y: 0 }, 0, 0.28);
		expectBaked(node, {
			closed: false,
			curvePaths: [shaft, ...tip.curvePaths],
			fillFrom: 1,
		});
	});

	it("fills a closed tip with the stroke, then the theme foreground", () => {
		const { graph, commit } = manualGraph();
		const stroked = graph.root.add(
			arrow.create({
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
				tipShape: "triangle",
				stroke: "#00ff00",
			}),
		);
		const bare = graph.root.add(
			arrow.create({
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
				tipShape: "triangle",
			}),
		);
		const tipped = graph.root.add(
			arrow.create({
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
				tipShape: "triangle",
				tipFill: "#123456",
			}),
		);
		commit();
		expect(shapeSpec(stroked).closed).toBe(true);
		expect(shapeSpec(stroked).style.fill).toBe("#00ff00");
		expect(shapeSpec(bare).style.fill).toBe(darkTheme.palette.foreground);
		expect(shapeSpec(tipped).style.fill).toBe("#123456");
		// A vee is open: no fill is made up.
		tipped.set("tipShape", "vee");
		commit();
		expect(shapeSpec(tipped).style.fill).toBeNull();
	});

	it("puts tips at both ends for tipAt both and doubleArrow", () => {
		const { graph, commit } = manualGraph();
		const both = graph.root.add(
			arrow.create({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, tipAt: "both" }),
		);
		const double = graph.root.add(
			doubleArrow.create({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }),
		);
		commit();
		expect(shapeSpec(both).curvePaths).toHaveLength(3);
		expect(resolvedCurves(double)).toEqual(resolvedCurves(both));
	});

	it("vector starts at the origin", () => {
		const { graph, commit } = manualGraph();
		const fromOrigin = graph.root.add(vector.create({ to: { x: 1, y: 2 } }));
		const explicit = graph.root.add(
			arrow.create({ from: { x: 0, y: 0 }, to: { x: 1, y: 2 } }),
		);
		commit();
		expect(resolvedCurves(fromOrigin)).toEqual(resolvedCurves(explicit));
	});
});

function resolvedCurves(node: Parameters<typeof shapeSpec>[0]) {
	return shapeSpec(node).curvePaths;
}

describe("dashedLine", () => {
	it("fits a whole number of dashes and defaults to butt caps", () => {
		const { graph, commit } = manualGraph();
		const props = { from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, dashCount: 4 };
		const node = graph.root.add(dashedLine.create(props));
		commit();
		const style = shapeSpec(node).style;
		expect(style.lineCap).toBe("butt");
		// 4 dashes of ink 0.5 each, 3 gaps sharing the other 2 units.
		expect(dashedLinePattern(props)).toEqual([0.5, 2 / 3]);
		expect(style.dash).toEqual([0.5, 2 / 3]);
	});

	it("refits the pattern when an endpoint moves", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			dashedLine.create({
				from: { x: 0, y: 0 },
				to: { x: 4, y: 0 },
				dashCount: 2,
			}),
		);
		commit();
		node.set("to", { x: 8, y: 0 });
		commit();
		expect(shapeSpec(node).style.dash).toEqual([2, 4]);
	});
});
