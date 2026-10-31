/**
 * `implicitFunction`: points land on the curve in scene units, every
 * component is drawn, the search honours `xRange`/`yRange`, and a new
 * coordinate system searches again (against a hand-made coordinate system).
 */

import { describe, expect, it } from "vitest";
import { Invalidate, themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import type { ShapeSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import type { CoordinateSystem } from "./coords";
import { coordsContext, createCartesianCoords } from "./coords";
import { implicitFunction } from "./implicit-function";

const theme = resolveTheme({ mode: "dark" });

function square(size: number, half: number): CoordinateSystem {
	return createCartesianCoords({
		xRange: [-half, half],
		yRange: [-half, half],
		width: size,
		height: size,
		center: { x: 0, y: 0 },
	});
}

function manualGraph(coords: CoordinateSystem) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	graph.root.provide(coordsContext, coords);
	return { graph, commit: () => graph.commit() };
}

const MARK = 7;
function marked(graph: SceneGraph, zIndex = MARK): ShapeSpec {
	const found = graph.frame.filter(
		(spec) => spec.kind === "shape" && spec.zIndex === zIndex,
	);
	expect(found).toHaveLength(1);
	return found[0] as ShapeSpec;
}

describe("implicitFunction", () => {
	it("is described for bindings", () => {
		expect(implicitFunction.name).toBe("ImplicitFunction");
		expect(implicitFunction.kind).toBe("composite");
		expect(implicitFunction.descriptor.function.invalidates).toBe(
			Invalidate.UPDATE,
		);
		expect(implicitFunction.descriptor.progress.invalidates).toBe(
			Invalidate.NONE,
		);
	});

	it("draws x² + y² − 1 = 0 as one closed loop on the unit circle", () => {
		const { graph, commit } = manualGraph(square(4, 2));
		graph.root.add(
			implicitFunction.create({
				function: (x, y) => x * x + y * y - 1,
				zIndex: MARK,
			}),
		);
		commit();
		const spec = marked(graph);
		expect(spec.curvePaths).toHaveLength(1);
		expect(spec.curvePaths?.[0]?.closed).toBe(true);
		for (const p of spec.polylines.flat()) {
			expect(Math.abs(Math.hypot(p.x, p.y) - 1)).toBeLessThan(1e-3);
		}
	});

	it("draws every component", () => {
		// size 8, half-range 4: a data unit is a scene unit.
		const { graph, commit } = manualGraph(square(8, 4));
		graph.root.add(
			implicitFunction.create({
				// Two unit circles at (±2, 0).
				function: (x, y) =>
					Math.min((x - 2) ** 2 + y * y, (x + 2) ** 2 + y * y) - 1,
				zIndex: MARK,
			}),
		);
		commit();
		const spec = marked(graph);
		expect(spec.curvePaths).toHaveLength(2);
		for (const p of spec.polylines.flat()) {
			const d = Math.min(Math.hypot(p.x - 2, p.y), Math.hypot(p.x + 2, p.y));
			expect(Math.abs(d - 1)).toBeLessThan(1e-2);
		}
	});

	it("searches only xRange/yRange when given, and draws nothing without a root", () => {
		const { graph, commit } = manualGraph(square(4, 2));
		graph.root.add(
			implicitFunction.create({
				function: (x, y) => x * x + y * y - 1,
				xRange: [0, 2],
				zIndex: MARK,
			}),
		);
		graph.root.add(
			implicitFunction.create({
				function: (x, y) => x * x + y * y + 1,
				zIndex: MARK + 1,
			}),
		);
		commit();
		const spec = marked(graph);
		expect(spec.curvePaths).toHaveLength(1);
		expect(spec.curvePaths?.[0]?.closed).toBe(false);
		for (const p of spec.polylines.flat())
			expect(p.x).toBeGreaterThanOrEqual(0);
		const empty = graph.frame.find(
			(s) => s.kind === "shape" && s.zIndex === MARK + 1,
		) as ShapeSpec | undefined;
		expect(empty?.polylines.flat() ?? []).toHaveLength(0);
	});

	it("searches again for a new coordinate system, not for a style change", () => {
		const { graph, commit } = manualGraph(square(4, 2));
		let calls = 0;
		const node = graph.root.add(
			implicitFunction.create({
				function: (x, y) => {
					calls++;
					return x * x + y * y - 1;
				},
				zIndex: MARK,
			}),
		);
		commit();
		const searched = calls;
		node.set("stroke", "#00ff00");
		commit();
		expect(calls).toBe(searched);
		expect(marked(graph).style.stroke).toBe("#00ff00");
		// Twice the scene units per data unit: the circle doubles.
		graph.root.provide(coordsContext, square(8, 2));
		commit();
		expect(calls).toBeGreaterThan(searched);
		for (const p of marked(graph).polylines.flat()) {
			expect(Math.abs(Math.hypot(p.x, p.y) - 2)).toBeLessThan(1e-2);
		}
	});
});
