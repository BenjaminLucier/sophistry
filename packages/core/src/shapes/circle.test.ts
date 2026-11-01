/**
 * `circle` and `ellipse`: the outline is built about the origin and placed by
 * `center` through the matrix, and the spec matches `bake()` for the same
 * outline placed by `x`/`y` (see `expectBaked`).
 */

import { describe, expect, it } from "vitest";
import { arcCurvePath, ellipseCurvePath } from "../geometry/index.js";
import { Invalidate, themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import { bake, plainShapeSpec } from "../spec/bake.js";
import type { ShapeSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { circle, ellipse } from "./circle.js";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

/** The spec with its lazy scene-unit getters resolved and `local` dropped. */
function resolved(spec: ShapeSpec) {
	const { local: _local, ...rest } = plainShapeSpec(spec);
	return rest;
}

describe("circle", () => {
	it("is named and described for bindings and codegen", () => {
		expect(circle.name).toBe("Circle");
		expect(circle.kind).toBe("primitive");
		expect(circle.container).toBe(false);
		expect(circle.descriptor.radius.invalidates).toBe(Invalidate.GEOMETRY);
		expect(circle.descriptor.center.invalidates).toBe(Invalidate.TRANSFORM);
		expect(circle.descriptor.fill.instanceable).toBe(true);
	});

	it("matches bake() for a centred circle placed by x/y", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			circle.create({
				radius: 2,
				center: { x: 1, y: -1 },
				fill: "#f00",
				strokeWidth: 0.1,
			}),
		);
		commit();
		const geometry = {
			closed: true,
			curvePaths: [{ ...arcCurvePath(0, 0, 2, 0, Math.PI * 2), closed: true }],
		};
		const expected = bake(
			geometry,
			{ matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, opacity: 1 },
			{ fill: "#f00", strokeWidth: 0.1 },
			theme,
			{ id: node.id, x: 1, y: -1 },
		);
		expect(resolved(node.spec as ShapeSpec)).toEqual(expected);
	});

	it("rotates about its own centre by default", () => {
		const { graph } = manualGraph();
		const node = graph.root.add(
			circle.create({ radius: 1, center: { x: 3, y: 0 }, rotation: 1 }),
		);
		expect(node.center()?.x).toBeCloseTo(3, 6);
		expect(node.center()?.y).toBeCloseTo(0, 6);
	});
});

describe("ellipse", () => {
	it("matches bake() and turns by tilt in radians", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			ellipse.create({
				radiusX: 2,
				radiusY: 1,
				tilt: Math.PI / 2,
				center: { x: 0, y: 1 },
			}),
		);
		commit();
		const expected = bake(
			{ closed: true, curvePaths: [ellipseCurvePath(0, 0, 2, 1, 90)] },
			{ matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, opacity: 1 },
			{},
			theme,
			{ id: node.id, y: 1 },
		);
		expect(resolved(node.spec as ShapeSpec)).toEqual(expected);
		// A quarter turn: taller than wide.
		expect(node.height()).toBeCloseTo(4, 2);
		expect(node.width()).toBeCloseTo(2, 2);
	});

	it("reruns its outline for a semi-axis, not for a move", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(ellipse.create({ radiusX: 2, radiusY: 1 }));
		commit();
		const curves = (node.spec as ShapeSpec).local?.curvePaths;
		node.set("center", { x: 4, y: 4 });
		commit();
		expect((node.spec as ShapeSpec).local?.curvePaths).toBe(curves);
		node.set("radiusY", 3);
		commit();
		expect((node.spec as ShapeSpec).local?.curvePaths).not.toBe(curves);
	});
});
