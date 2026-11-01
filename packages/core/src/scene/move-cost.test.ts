/**
 * What moving a shape costs, pinned with run counts rather than a clock.
 *
 * A move is a new matrix, not a new outline (`ShapeSpec.local`), and it
 * reruns one node refresh per shape: no geometry, no style. These are the
 * properties that keep thousands of animated shapes cheap; if one regresses,
 * a test here says which.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Point } from "../geometry/index.js";
import { track } from "../reactive/index.js";
import { circle, ellipse, rect, square } from "../shapes/index.js";
import * as bake from "../spec/bake.js";
import type { ShapeSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import type { SceneNode } from "./types.js";

vi.mock("../spec/bake.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../spec/bake.js")>();
	return {
		...actual,
		bakeStrokeStyle: vi.fn(actual.bakeStrokeStyle),
		derivePolylines: vi.fn(actual.derivePolylines),
	};
});

const N = 20;
const FRAMES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];

afterEach(() => {
	vi.mocked(bake.bakeStrokeStyle).mockClear();
	vi.mocked(bake.derivePolylines).mockClear();
});

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	return { graph, commit: () => graph.commit() };
}

const specOf = (node: SceneNode) =>
	(node as unknown as { spec: ShapeSpec }).spec;

describe.each([
	{
		name: "circle by center",
		make: (at: { peek(): Point; subscribe(f: () => void): () => void }) =>
			circle.create({ center: at, radius: 0.5 }),
	},
	{
		name: "ellipse by center",
		make: (at: { peek(): Point; subscribe(f: () => void): () => void }) =>
			ellipse.create({ center: at, radiusX: 0.5, radiusY: 0.3 }),
	},
	{
		name: "rect by center",
		make: (at: { peek(): Point; subscribe(f: () => void): () => void }) =>
			rect.create({ center: at, width: 1, height: 0.5 }),
	},
	{
		name: "square by x/y",
		make: (at: { peek(): Point; subscribe(f: () => void): () => void }) =>
			square.create({
				size: 1,
				x: { peek: () => at.peek().x, subscribe: at.subscribe },
				y: { peek: () => at.peek().y, subscribe: at.subscribe },
			}),
	},
])("moving a $name", ({ make }) => {
	const scene = () => {
		const { graph, commit } = manualGraph();
		const t = track(0);
		const nodes = Array.from({ length: N }, (_, i) =>
			graph.root.add(
				make({
					peek: () => ({ x: i + t.peek(), y: i * 0.5 }),
					subscribe: (onStale) => t.subscribe(onStale),
				}),
			),
		);
		commit();
		return { graph, commit, nodes, t };
	};

	it("changes the transform and keeps the outline", () => {
		const { commit, nodes, t } = scene();
		const before = nodes.map(specOf);
		t.set(1);
		commit();
		nodes.forEach((node, i) => {
			const [a, b] = [before[i]?.local, specOf(node).local];
			expect(a && b).toBeTruthy();
			// The same arrays, so every cache keyed on them survives the move.
			expect(b?.curvePaths).toBe(a?.curvePaths);
			expect(b?.transform.e).toBeCloseTo((a?.transform.e ?? 0) + 1, 9);
		});
	});

	it("reruns one refresh per shape per frame, no geometry and no style", () => {
		const { graph, commit, nodes, t } = scene();
		vi.mocked(bake.bakeStrokeStyle).mockClear();
		const flatten = vi.mocked(bake.derivePolylines);
		flatten.mockClear();
		const refreshes = graph.stats.refreshes;
		for (const value of FRAMES) {
			t.set(value);
			commit();
		}
		expect(graph.stats.refreshes - refreshes).toBe(N * FRAMES.length);
		expect(bake.bakeStrokeStyle).not.toHaveBeenCalled();
		expect(flatten).not.toHaveBeenCalled();
		// (Control: a handle does flatten the outline, once.)
		nodes[0]?.bounds();
		nodes[0]?.bounds();
		expect(flatten).toHaveBeenCalledTimes(1);
	});
});

describe("restyling a shape", () => {
	it("reruns its style and spec, not its outline or matrix", () => {
		const { graph, commit } = manualGraph();
		const opacity = track(1);
		const node = graph.root.add(
			circle.create({ center: { x: 1, y: 1 }, radius: 0.5, opacity }),
		);
		commit();
		const before = specOf(node);
		vi.mocked(bake.bakeStrokeStyle).mockClear();
		for (const value of FRAMES) {
			opacity.set(value);
			commit();
		}
		const after = specOf(node);
		expect(after.local?.curvePaths).toBe(before.local?.curvePaths);
		// The same matrix object: the last-input cache kept it.
		expect(after.local?.transform).toBe(before.local?.transform);
		expect(bake.bakeStrokeStyle).toHaveBeenCalledTimes(FRAMES.length);
		expect(after.style.opacity).toBe(0.6);
	});

	it("a hidden shape restyles nothing until shown", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(circle.create({ radius: 1, visible: false }));
		commit();
		vi.mocked(bake.bakeStrokeStyle).mockClear();
		node.set("fill", "#f00");
		node.set("strokeWidth", 0.2);
		commit();
		expect(bake.bakeStrokeStyle).not.toHaveBeenCalled();
		node.set("visible", true);
		commit();
		expect(bake.bakeStrokeStyle).toHaveBeenCalledTimes(1);
		expect(specOf(node).style.fill).toBe("#f00");
	});
});
