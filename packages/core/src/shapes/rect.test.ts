/**
 * `rect` and `square`: positioned by their centre, matching `bake()` for the
 * same outline placed by `x`/`y`.
 */

import { describe, expect, it } from "vitest";
import { polylineToCurvePath, rectPolyline } from "../geometry";
import { themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import { bake, plainShapeSpec } from "../spec/bake";
import type { ShapeSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { openRing, rect, square } from "./rect";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

function resolved(spec: ShapeSpec) {
	const { local: _local, id: _id, ...rest } = plainShapeSpec(spec);
	return rest;
}

describe("rect", () => {
	it("matches bake() for a box about the origin placed by x/y", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			rect.create({
				width: 4,
				height: 2,
				center: { x: 1, y: 2 },
				fill: "#00f",
			}),
		);
		commit();
		const geometry = {
			closed: true,
			curvePaths: [
				polylineToCurvePath(openRing(rectPolyline(-2, -1, 4, 2, 0)), true),
			],
		};
		const expected = bake(
			geometry,
			{ matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, opacity: 1 },
			{ fill: "#00f" },
			theme,
			{ id: node.id, x: 1, y: 2 },
		);
		expect({ ...resolved(node.spec as ShapeSpec), id: node.id }).toEqual(
			expected,
		);
		expect(node.bounds()).toEqual({ minX: -1, minY: 1, maxX: 3, maxY: 3 });
	});

	it("rounds its corners with cornerRadius", () => {
		const { graph, commit } = manualGraph();
		const sharp = graph.root.add(rect.create({ width: 2, height: 2 }));
		const round = graph.root.add(
			rect.create({ width: 2, height: 2, cornerRadius: 0.5 }),
		);
		commit();
		const segments = (node: typeof sharp) =>
			(node.spec as ShapeSpec).local?.curvePaths?.[0]?.segments.length ?? 0;
		expect(segments(sharp)).toBe(3);
		expect(segments(round)).toBeGreaterThan(4);
	});

	it("openRing drops a repeated closing point only", () => {
		const ring = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 0 },
		];
		expect(openRing(ring)).toHaveLength(2);
		expect(openRing(ring.slice(0, 2))).toHaveLength(2);
		expect(openRing([])).toEqual([]);
	});
});

describe("square", () => {
	it("draws the rect of equal sides", () => {
		const { graph, commit } = manualGraph();
		const a = graph.root.add(
			square.create({ size: 2, center: { x: 1, y: 0 }, cornerRadius: 0.2 }),
		);
		const b = graph.root.add(
			rect.create({
				width: 2,
				height: 2,
				center: { x: 1, y: 0 },
				cornerRadius: 0.2,
			}),
		);
		commit();
		expect(resolved(a.spec as ShapeSpec)).toEqual(
			resolved(b.spec as ShapeSpec),
		);
		expect(square.name).toBe("Square");
	});
});
