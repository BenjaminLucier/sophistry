/**
 * `functionGraph`, `parametricGraph`, `polarGraph` and `sampleRuns`: the
 * curve is sampled in data space and mapped through the coordinate system in
 * context; style props reach the drawn shape without re-sampling, and a new
 * coordinate system re-samples.
 */

import { describe, expect, it } from "vitest";
import type { Point } from "../geometry";
import { polylineToCurvePath } from "../geometry";
import { track } from "../reactive";
import { Invalidate, themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import type { ShapeSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import type { CoordinateSystem } from "./coords";
import { coordsContext, createCartesianCoords } from "./coords";
import {
	functionGraph,
	graphHandle,
	parametricGraph,
	polarGraph,
	sampleRuns,
} from "./function-graph";

const theme = resolveTheme({ mode: "dark" });

/** x in [-4, 4] over 8 units, y in [-2, 2] over 4: one data unit, one scene unit. */
function unitCoords(): CoordinateSystem {
	return createCartesianCoords({
		xRange: [-4, 4],
		yRange: [-2, 2],
		width: 8,
		height: 4,
		center: { x: 0, y: 0 },
	});
}

function manualGraph(coords: CoordinateSystem = unitCoords()) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	graph.root.provide(coordsContext, coords);
	return { graph, commit: () => graph.commit() };
}

/** The graph's drawn shape spec (the one shape in the frame). */
function shapeOf(graph: SceneGraph): ShapeSpec {
	const shapes = graph.frame.filter((spec) => spec.kind === "shape");
	expect(shapes).toHaveLength(1);
	return shapes[0] as ShapeSpec;
}

function scene(coords: CoordinateSystem, runs: Point[][]): Point[][] {
	return runs.map((run) => run.map((at) => coords.coordsToPoint(at.x, at.y)));
}

describe("sampleRuns", () => {
	const coords = unitCoords();

	it("samples the domain evenly, ends included", () => {
		const runs = sampleRuns(coords, (x) => ({ x, y: x / 4 }), -4, 4, {
			samples: 8,
		});
		expect(runs).toHaveLength(1);
		expect(runs[0]?.map((p) => p.x)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
	});

	it("splits at a named discontinuity without evaluating it", () => {
		const seen: number[] = [];
		const runs = sampleRuns(
			coords,
			(x) => {
				seen.push(x);
				return { x, y: 1 / x };
			},
			-4,
			4,
			{ discontinuities: [0], clip: false },
		);
		expect(runs).toHaveLength(2);
		expect(seen).not.toContain(0);
	});

	it("splits at non-finite samples and at implausible jumps", () => {
		const nan = sampleRuns(
			coords,
			(x) => ({ x, y: x > 0 && x < 1 ? Number.NaN : 0 }),
			-4,
			4,
			{ samples: 16 },
		);
		expect(nan).toHaveLength(2);
		const step = sampleRuns(
			coords,
			(x) => ({ x, y: x < 0 ? -1.5 : 1.5 }),
			-4,
			4,
			{
				samples: 15,
			},
		);
		expect(step).toHaveLength(2);
	});

	it("clips to the plotting area, closing each run on the boundary", () => {
		const runs = sampleRuns(coords, (x) => ({ x, y: x }), -4, 4);
		expect(runs).toHaveLength(1);
		const run = runs[0] as Point[];
		const limit = 2 + 4 * 0.02;
		for (const p of run) expect(Math.abs(p.y)).toBeLessThanOrEqual(limit);
		expect(run[0]?.y).toBeCloseTo(-limit, 2);
		expect(run.at(-1)?.y).toBeCloseTo(limit, 2);
		// clip: false keeps every sample.
		const all = sampleRuns(coords, (x) => ({ x, y: x }), -4, 4, {
			clip: false,
		});
		expect(all[0]?.at(-1)?.y).toBe(4);
	});

	it("keeps the sampling direction", () => {
		const runs = sampleRuns(coords, (x) => ({ x, y: 0 }), 4, -4, {
			samples: 4,
		});
		expect(runs[0]?.map((p) => p.x)).toEqual([4, 2, 0, -2, -4]);
	});
});

describe("functionGraph", () => {
	it("is a composite with sampling props that rerun update and style props that don't", () => {
		expect(functionGraph.name).toBe("FunctionGraph");
		expect(functionGraph.kind).toBe("composite");
		expect(functionGraph.descriptor.function.invalidates).toBe(
			Invalidate.UPDATE,
		);
		expect(functionGraph.descriptor.samples.default).toBe(160);
		expect(functionGraph.descriptor.stroke.invalidates).toBe(Invalidate.NONE);
		expect(functionGraph.descriptor.onTap.kind).toBe("event");
	});

	it("draws sampleRuns mapped to scene units over the axes' x range", () => {
		const coords = createCartesianCoords({
			xRange: [-2, 2],
			yRange: [-1, 3],
			width: 8,
			height: 4,
			center: { x: 1, y: 0 },
		});
		const { graph, commit } = manualGraph(coords);
		const f = (x: number) => x * x;
		graph.root.add(functionGraph.create({ function: f, strokeWidth: 0.1 }));
		commit();
		const expected = scene(
			coords,
			sampleRuns(coords, (x) => ({ x, y: f(x) }), -2, 2),
		);
		const spec = shapeOf(graph);
		expect(spec.closed).toBe(false);
		expect(spec.curvePaths).toEqual(
			expected.map((run) => polylineToCurvePath(run, false)),
		);
		expect(spec.style.strokeWidth).toBeCloseTo(0.1, 12);
	});

	it("passes style through without re-sampling, and re-samples for a new function", () => {
		const { graph, commit } = manualGraph();
		let calls = 0;
		const node = graph.root.add(
			functionGraph.create({
				function: (x) => {
					calls++;
					return x / 2;
				},
			}),
		);
		commit();
		const sampled = calls;
		const curves = shapeOf(graph).curvePaths;
		const progress = track(1);
		node.set("progress", progress);
		node.set("stroke", "#ff0000");
		progress.set(0.25);
		commit();
		expect(calls).toBe(sampled);
		expect(shapeOf(graph).progress).toBe(0.25);
		expect(shapeOf(graph).style.stroke).toBe("#ff0000");
		expect(shapeOf(graph).curvePaths).toBe(curves);
		node.set("function", (x) => -x);
		commit();
		expect(shapeOf(graph).curvePaths).not.toBe(curves);
	});

	it("re-samples when a new coordinate system is provided", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(functionGraph.create({ function: (x) => x / 4 }));
		commit();
		expect(shapeOf(graph).polylines[0]?.[0]?.x).toBeCloseTo(-4, 9);
		graph.root.provide(
			coordsContext,
			createCartesianCoords({
				xRange: [-4, 4],
				yRange: [-2, 2],
				width: 4,
				height: 4,
				center: { x: 0, y: 0 },
			}),
		);
		commit();
		expect(shapeOf(graph).polylines[0]?.[0]?.x).toBeCloseTo(-2, 9);
	});

	it("honours from/to and hands back curve points by input", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			functionGraph.create({ function: (x) => x / 4, from: 0, to: 2 }),
		);
		commit();
		const points = shapeOf(graph).polylines.flat();
		expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(0, 9);
		expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(2, 9);
		expect(graphHandle(node).pointAt(2)).toEqual({ x: 2, y: 0.5 });
		expect(graphHandle(node).pointOnBounds({ x: 1, y: 0 })?.x).toBeCloseTo(
			2,
			6,
		);
	});

	it("throws outside a coordinate system", () => {
		const graph = new SceneGraph({ schedule: () => {} });
		graph.root.provide(themeContext, theme);
		graph.root.add(functionGraph.create({ function: (x) => x }));
		expect(() => graph.commit()).toThrow(/FunctionGraph/);
	});
});

describe("parametricGraph", () => {
	it("samples the parameter and clips sideways too", () => {
		const coords = unitCoords();
		const { graph, commit } = manualGraph(coords);
		const curve = (t: number) => ({ x: 6 * Math.cos(t), y: Math.sin(t) });
		graph.root.add(
			parametricGraph.create({ function: curve, from: 0, to: Math.PI }),
		);
		commit();
		const expected = scene(coords, sampleRuns(coords, curve, 0, Math.PI));
		expect(shapeOf(graph).polylines).toEqual(expected);
		for (const p of shapeOf(graph).polylines.flat())
			expect(Math.abs(p.x)).toBeLessThanOrEqual(4.17);
	});
});

describe("polarGraph", () => {
	it("draws r = 1 as the unit circle over a full turn by default", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(polarGraph.create({ function: () => 1 }));
		commit();
		const points = shapeOf(graph).polylines.flat();
		expect(points.length).toBeGreaterThan(300);
		for (const p of points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 9);
		expect(points[0]?.x).toBeCloseTo(1, 9);
		expect(points.at(-1)?.x).toBeCloseTo(1, 9);
		// Counter-clockwise: θ runs from 0 upwards.
		expect(points[10]?.y).toBeGreaterThan(0);
		const top = graphHandle(node).pointAt(Math.PI / 2);
		expect(top.x).toBeCloseTo(0, 9);
		expect(top.y).toBeCloseTo(1, 9);
	});

	it("draws a cardioid r = 1 + cos θ in plain axes, with the axes' scaling", () => {
		// x: 2 data units per scene unit; y: 1 data unit per scene unit.
		const { graph, commit } = manualGraph(
			createCartesianCoords({
				xRange: [-4, 4],
				yRange: [-2, 2],
				width: 4,
				height: 4,
				center: { x: 0, y: 0 },
			}),
		);
		graph.root.add(polarGraph.create({ function: (t) => 1 + Math.cos(t) }));
		commit();
		const points = shapeOf(graph).polylines.flat();
		expect(points.length).toBeGreaterThan(300);
		for (const p of points) {
			const x = p.x * 2;
			const y = p.y;
			const r = Math.hypot(x, y);
			// On a cardioid, r = 1 + cos θ = 1 + x / r, i.e. r² = r + x.
			expect(r * r - r - x).toBeCloseTo(0, 6);
		}
		// The far point, r = 2 at θ = 0, is at data (2, 0).
		expect(Math.max(...points.map((p) => p.x * 2))).toBeCloseTo(2, 9);
	});

	it("honours from/to, and progress passes through as a shape prop", () => {
		const { graph, commit } = manualGraph(
			createCartesianCoords({
				xRange: [-2, 2],
				yRange: [-2, 2],
				width: 4,
				height: 4,
				center: { x: 0, y: 0 },
			}),
		);
		graph.root.add(
			polarGraph.create({
				function: () => 1,
				from: 0,
				to: Math.PI,
				progress: 0.5,
			}),
		);
		commit();
		expect(shapeOf(graph).progress).toBe(0.5);
		for (const p of shapeOf(graph).polylines.flat())
			expect(p.y).toBeGreaterThanOrEqual(-1e-12);
	});

	it("uses a polar system's own polarToPoint for curve points", () => {
		const base = unitCoords();
		const polar = {
			...base,
			polarToPoint: (radius: number, angle: number) => ({
				x: 10 + radius * Math.cos(angle),
				y: radius * Math.sin(angle),
			}),
		};
		const { graph, commit } = manualGraph(polar);
		const node = graph.root.add(polarGraph.create({ function: () => 1 }));
		commit();
		expect(graphHandle(node).pointAt(0).x).toBeCloseTo(11, 9);
	});
});
