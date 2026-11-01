/**
 * The graph annotations: each reads the coordinate system in context, draws
 * the expected nodes (order, z and defaults), and re-runs when the
 * axes publish a new system.
 */

import { describe, expect, it } from "vitest";
import type { Point } from "../geometry/index.js";
import { track } from "../reactive/index.js";
import { Invalidate, themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import type { ShapeSpec, TextSpec } from "../spec/types.js";
import type { CoordinateSystem } from "./coords.js";
import {
	coordsContext,
	createCartesianCoords,
	UNDER_AXES_Z_INDEX,
} from "./coords.js";
import { sampleRuns } from "./function-graph.js";
import {
	angleOfTangent,
	areaUnderGraph,
	horizontalLineToGraph,
	inputToGraphPoint,
	riemannRectangles,
	secantSlopeGroup,
	slopeOfSecant,
	tangentToGraph,
	verticalLineToGraph,
} from "./graph-annotations.js";
import { theme } from "./test-scene.js";

/** x in [-4, 4], y in [-2, 2], one data unit per scene unit. */
function unitCoords(scale = 1): CoordinateSystem {
	return createCartesianCoords({
		xRange: [-4, 4],
		yRange: [-2, 2],
		width: 8 * scale,
		height: 4 * scale,
		center: { x: 0, y: 0 },
	});
}

function manualGraph(coords: CoordinateSystem = unitCoords()) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	graph.root.provide(coordsContext, coords);
	return {
		graph,
		commit: () => graph.commit(),
		shapes: () => graph.frame.filter((s): s is ShapeSpec => s.kind === "shape"),
		texts: () => graph.frame.filter((s): s is TextSpec => s.kind === "text"),
	};
}

const parabola = (x: number) => x * x;

describe("graph maths", () => {
	const coords = unitCoords(2);

	it("maps an input to its graph point", () => {
		expect(inputToGraphPoint(coords, parabola, 1)).toEqual(
			coords.coordsToPoint(1, 1),
		);
	});

	it("takes the secant slope in data units", () => {
		expect(slopeOfSecant(parabola, 1, 0.5)).toBeCloseTo(2.5, 12);
		expect(slopeOfSecant(parabola, 1, 0)).toBeNaN();
	});

	it("takes the tangent angle in scene units", () => {
		// Square scaling: slope 2 at x = 1.
		expect(angleOfTangent(coords, parabola, 1)).toBeCloseTo(Math.atan(2), 6);
		// x stretched twice as much as y: the angle flattens.
		const wide = createCartesianCoords({
			xRange: [-4, 4],
			yRange: [-2, 2],
			width: 16,
			height: 4,
			center: { x: 0, y: 0 },
		});
		expect(angleOfTangent(wide, parabola, 1)).toBeCloseTo(Math.atan(1), 6);
	});
});

describe("areaUnderGraph", () => {
	it("is described for bindings", () => {
		expect(areaUnderGraph.name).toBe("AreaUnderGraph");
		expect(areaUnderGraph.descriptor.function.invalidates).toBe(
			Invalidate.UPDATE,
		);
		expect(areaUnderGraph.descriptor.fillOpacity.default).toBe(0.3);
	});

	it("fills one closed ring per run against the baseline, under the axes", () => {
		const coords = unitCoords();
		const { graph, commit, shapes } = manualGraph(coords);
		graph.root.add(
			areaUnderGraph.create({ function: (x) => x / 4, from: -2, to: 2 }),
		);
		commit();
		const [region] = shapes();
		expect(shapes()).toHaveLength(1);
		expect(region?.zIndex).toBe(UNDER_AXES_Z_INDEX);
		expect(region?.closed).toBe(true);
		expect(region?.style.fill).toBe(theme.palette.series[0]);
		expect(region?.style.fillOpacity).toBe(0.3);
		const [run] = sampleRuns(coords, (x) => ({ x, y: x / 4 }), -2, 2, {
			samples: 160,
		});
		const ringPoints = region?.polylines[0] as Point[];
		expect(ringPoints).toHaveLength((run?.length ?? 0) * 2 + 1);
		expect(ringPoints[0]).toEqual(ringPoints.at(-1));
		// The lower edge sits on the x axis.
		expect(ringPoints[(run?.length ?? 0) + 1]?.y).toBe(0);
	});

	it("splits at a discontinuity and follows its zIndex on top of the offset", () => {
		const { graph, commit, shapes } = manualGraph();
		const node = graph.root.add(
			areaUnderGraph.create({
				function: (x) => 1 / x,
				discontinuities: [0],
				from: -2,
				to: 2,
			}),
		);
		commit();
		expect(shapes()[0]?.polylines).toHaveLength(2);
		node.set("zIndex", 2);
		commit();
		expect(shapes()[0]?.zIndex).toBe(2 + UNDER_AXES_Z_INDEX);
	});

	it("re-runs for a new coordinate system", () => {
		const { graph, commit, shapes } = manualGraph();
		graph.root.add(
			areaUnderGraph.create({ function: () => 1, from: 0, to: 1 }),
		);
		commit();
		const maxX = () =>
			Math.max(...(shapes()[0]?.polylines.flat() ?? []).map((p) => p.x));
		expect(maxX()).toBeCloseTo(1, 9);
		graph.root.provide(coordsContext, unitCoords(2));
		commit();
		expect(maxX()).toBeCloseTo(2, 9);
	});
});

describe("riemannRectangles", () => {
	it("draws positives and negatives as one node each, negatives in negativeFill", () => {
		const { graph, commit, shapes } = manualGraph();
		graph.root.add(
			riemannRectangles.create({
				function: (x) => x,
				from: -2,
				to: 2,
				count: 4,
				sample: "midpoint",
				negativeFill: "#0000ff",
			}),
		);
		commit();
		const [positive, negative] = shapes();
		expect(shapes()).toHaveLength(2);
		expect(positive?.polylines).toHaveLength(2);
		expect(negative?.polylines).toHaveLength(2);
		expect(negative?.style.fill).toBe("#0000ff");
		expect(positive?.style.fill).toBe(theme.palette.series[0]);
		expect(positive?.zIndex).toBe(UNDER_AXES_Z_INDEX);
		expect(positive?.style.fillOpacity).toBe(0.45);
		// The first positive rectangle spans [0, 1] up to f(0.5).
		expect(positive?.polylines[0]).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 0.5 },
			{ x: 0, y: 0.5 },
			{ x: 0, y: 0 },
		]);
	});

	it("keeps a side's outline when an update leaves it unchanged", () => {
		const { graph, commit, shapes } = manualGraph();
		const count = track(4);
		graph.root.add(
			riemannRectangles.create({ function: () => 1, from: 0, to: 2, count }),
		);
		commit();
		const negative = shapes()[1]?.polylines;
		count.set(8);
		commit();
		expect(shapes()[0]?.polylines).toHaveLength(8);
		expect(shapes()[1]?.polylines).toBe(negative);
	});
});

describe("verticalLineToGraph and horizontalLineToGraph", () => {
	it("drops a dashed line from the axis to the curve", () => {
		const { graph, commit, shapes } = manualGraph();
		graph.root.add(verticalLineToGraph.create({ function: parabola, x: 1 }));
		commit();
		const [segment] = shapes();
		expect(shapes()).toHaveLength(1);
		expect(segment?.polylines[0]).toEqual([
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		]);
		expect(segment?.style.stroke).toBe(theme.palette.muted);
		expect(segment?.style.dash).not.toBeNull();
	});

	it("adds a dot on the curve and a label at the foot, and goes solid", () => {
		const { graph, commit, shapes, texts } = manualGraph();
		const node = graph.root.add(
			verticalLineToGraph.create({
				function: parabola,
				x: 1,
				dot: true,
				label: "t",
			}),
		);
		commit();
		expect(shapes()).toHaveLength(2);
		expect(texts()).toHaveLength(1);
		expect(texts()[0]?.text).toBe("t");
		// The label sits below the foot.
		expect(texts()[0]?.at.y ?? 0).toBeLessThan(0);
		node.set("solid", true);
		commit();
		expect(shapes()[0]?.style.dash).toBeNull();
		node.set("x", 1.5);
		commit();
		expect(shapes()[0]?.polylines[0]?.[1]?.y).toBeCloseTo(2.25, 12);
	});

	it("runs a horizontal line from the y axis, indexed by the input", () => {
		const { graph, commit, shapes } = manualGraph();
		graph.root.add(horizontalLineToGraph.create({ function: parabola, x: 1 }));
		commit();
		expect(shapes()[0]?.polylines[0]).toEqual([
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		]);
	});
});

describe("secantSlopeGroup", () => {
	it("draws the legs, the secant and two dots by default", () => {
		const { graph, commit, shapes, texts } = manualGraph();
		graph.root.add(
			secantSlopeGroup.create({ function: parabola, x: 0, dx: 1 }),
		);
		commit();
		expect(shapes()).toHaveLength(5);
		expect(texts()).toHaveLength(0);
		const [run, rise, secant] = shapes();
		expect(run?.polylines[0]).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		]);
		expect(rise?.polylines[0]).toEqual([
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		]);
		expect(run?.style.stroke).toBe(theme.palette.accent);
		// Slope 1, through (0.5, 0.5), as long as the plot is wide.
		const [from, to] = secant?.polylines[0] ?? [];
		expect(
			((to?.y ?? 0) - (from?.y ?? 0)) / ((to?.x ?? 0) - (from?.x ?? 0)),
		).toBeCloseTo(1, 9);
		expect(
			Math.hypot((to?.x ?? 0) - (from?.x ?? 0), (to?.y ?? 0) - (from?.y ?? 0)),
		).toBeCloseTo(8, 9);
	});

	it("labels the legs, and drops triangle and dots on request", () => {
		const { graph, commit, shapes, texts } = manualGraph();
		const node = graph.root.add(
			secantSlopeGroup.create({
				function: parabola,
				x: 0,
				dxLabel: "Δx",
				dyLabel: "Δy",
			}),
		);
		commit();
		expect(texts().map((t) => t.text)).toEqual(["Δx", "Δy"]);
		node.update({ triangle: false, dots: false });
		commit();
		expect(shapes()).toHaveLength(1);
		expect(texts()).toHaveLength(0);
	});

	it("becomes the tangent as dx reaches 0", () => {
		const coords = unitCoords();
		const { graph, commit, shapes } = manualGraph(coords);
		graph.root.add(
			secantSlopeGroup.create({
				function: parabola,
				x: 1,
				dx: 0,
				triangle: false,
				dots: false,
			}),
		);
		commit();
		const [from, to] = shapes()[0]?.polylines[0] ?? [];
		const angle = Math.atan2(
			(to?.y ?? 0) - (from?.y ?? 0),
			(to?.x ?? 0) - (from?.x ?? 0),
		);
		expect(angle).toBeCloseTo(angleOfTangent(coords, parabola, 1), 9);
	});
});

describe("tangentToGraph", () => {
	it("is a third of the plot wide, along the central difference", () => {
		const coords = unitCoords();
		const { graph, commit, shapes } = manualGraph(coords);
		const x = track(1);
		graph.root.add(tangentToGraph.create({ function: parabola, x }));
		commit();
		const [from, to] = shapes()[0]?.polylines[0] ?? [];
		expect(
			Math.hypot((to?.x ?? 0) - (from?.x ?? 0), (to?.y ?? 0) - (from?.y ?? 0)),
		).toBeCloseTo(8 / 3, 9);
		expect(
			((to?.y ?? 0) - (from?.y ?? 0)) / ((to?.x ?? 0) - (from?.x ?? 0)),
		).toBeCloseTo(2, 4);
		x.set(0);
		commit();
		const [a, b] = shapes()[0]?.polylines[0] ?? [];
		expect((b?.y ?? 0) - (a?.y ?? 0)).toBeCloseTo(0, 6);
	});
});
