/**
 * Test helpers for the shape tests: a headless graph committed by hand, the
 * specs it publishes, and the spec `bake()` gives for the
 * same outline. Test-only: not in the barrel.
 */

import { expect } from "vitest";
import { clockContext, themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import type { SceneNode } from "../scene/types";
import type { ShapeGeometry, StrokeStyleInput } from "../spec/bake";
import { bake, plainShapeSpec } from "../spec/bake";
import type { DrawSpec, ShapeSpec, TextSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import type { Theme } from "../themes/types";
import { type Clock, createClock } from "../tween/clock";

export const darkTheme = resolveTheme({ mode: "dark" });

/** A graph whose commits run only when the test calls `commit()`. */
export function manualGraph(options: { theme?: Theme; clock?: Clock } = {}) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, options.theme ?? darkTheme);
	const clock = options.clock ?? createClock();
	graph.root.provide(clockContext, clock);
	return { graph, clock, commit: () => graph.commit() };
}

/** Every spec the subtree under `node` publishes, in tree order. */
export function specsOf(node: SceneNode): DrawSpec[] {
	const out: DrawSpec[] = [];
	const visit = (current: SceneNode) => {
		const spec = (current as { spec?: DrawSpec | null }).spec;
		if (spec) out.push(spec);
		const children = (current as { children?: readonly SceneNode[] }).children;
		if (children) for (const child of children) visit(child);
	};
	visit(node);
	return out;
}

/** The shape specs under `node`. */
export function shapeSpecsOf(node: SceneNode): ShapeSpec[] {
	return specsOf(node).filter(
		(spec): spec is ShapeSpec => spec.kind === "shape",
	);
}

/** The text specs under `node`. */
export function textSpecsOf(node: SceneNode): TextSpec[] {
	return specsOf(node).filter((spec): spec is TextSpec => spec.kind === "text");
}

/** The node's own shape spec; throws when it has none. */
export function shapeSpec(node: SceneNode): ShapeSpec {
	const spec = (node as { spec?: DrawSpec | null }).spec;
	if (spec?.kind !== "shape") throw new Error("expected a shape spec");
	return spec;
}

/** The spec with its lazy scene-unit getters resolved and `local` dropped. */
export function resolved(spec: ShapeSpec) {
	const { local: _local, ...rest } = plainShapeSpec(spec);
	return rest;
}

/**
 * Expects `node`'s spec to be what `bake()` gives for `geometry` and
 * `style`.
 */
export function expectBaked(
	node: SceneNode,
	geometry: ShapeGeometry,
	style: StrokeStyleInput = {},
	options: { x?: number; y?: number; zIndex?: number; theme?: Theme } = {},
): void {
	const expected = bake(
		geometry,
		{ matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, opacity: 1 },
		style,
		options.theme ?? darkTheme,
		{ id: node.id, x: options.x, y: options.y, zIndex: options.zIndex },
	);
	expect(resolved(shapeSpec(node))).toEqual(expected);
}
