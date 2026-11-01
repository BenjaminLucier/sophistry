/**
 * `group` with `clip`: the region is baked into scene units through the
 * group's own matrix, nested regions stack up into a list, every node under
 * one clipping group shares that list by identity, and the list follows a
 * bound region. (`clipRings`/`clipBounds` are in `spec/clip.test.ts`, picking
 * through a clip in `interact/hit.test.ts`, painting in the renderer's tests.)
 */

import { describe, expect, it } from "vitest";
import { track } from "../reactive/index.js";
import { rect } from "../shapes/index.js";
import { type ClipShape, clipBounds } from "../spec/clip.js";
import type { ShapeSpec, TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import { group } from "./group.js";
import { label } from "./text.js";

const unit = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	return { graph, commit: () => graph.commit() };
}

describe("group clip", () => {
	it("bakes the region through the group's own transform", () => {
		const { graph, commit } = manualGraph();
		const child = rect.create({ width: 1, height: 1 });
		graph.root.add(
			group.create({
				x: 10,
				scale: 2,
				origin: { x: 0, y: 0 },
				clip: unit,
				children: [child],
			}),
		);
		commit();
		const [region] = (child.spec as ShapeSpec).clip ?? [];
		expect(region?.rings[0]).toEqual([
			{ x: 10, y: 0 },
			{ x: 12, y: 0 },
			{ x: 12, y: 2 },
			{ x: 10, y: 2 },
		]);
	});

	it("nested clips stack outermost first; siblings share the list", () => {
		const { graph, commit } = manualGraph();
		const box = rect.create({ width: 1, height: 1 });
		const text = label.create({ text: "hi" });
		graph.root.add(
			group.create({
				clip: unit,
				children: [
					group.create({
						clip: { minX: 0.5, minY: 0, maxX: 2, maxY: 2 },
						children: [box, group.create({ x: 3, children: [text] })],
					}),
				],
			}),
		);
		commit();
		const rectSpec = box.spec as ShapeSpec;
		const textSpec = text.spec as TextSpec;
		expect(rectSpec.clip).toHaveLength(2);
		expect(rectSpec.clip?.[0]?.rings[0]?.[1]).toEqual({ x: 1, y: 0 });
		// A transform-only group between adds nothing and passes the list on.
		expect(textSpec.clip).toBe(rectSpec.clip);
	});

	it("an unclipped node carries no clip at all", () => {
		const { graph, commit } = manualGraph();
		const box = graph.root.add(rect.create({ width: 1, height: 1 }));
		const text = graph.root.add(label.create({ text: "a" }));
		commit();
		expect("clip" in (box.spec as ShapeSpec)).toBe(false);
		expect("clip" in (text.spec as TextSpec)).toBe(false);
	});

	it("follows a bound region, and moves with the group without rebuilding the outline", () => {
		const { graph, commit } = manualGraph();
		const right = track(1);
		const region = {
			peek: (): ClipShape => ({
				minX: 0,
				minY: 0,
				maxX: right.peek(),
				maxY: 1,
			}),
			subscribe: (onStale: () => void) => right.subscribe(onStale),
		};
		const child = rect.create({ width: 1, height: 1 });
		const clipped = graph.root.add(
			group.create({ clip: region, children: [child] }),
		);
		commit();
		expect(clipBounds((child.spec as ShapeSpec).clip)?.maxX).toBe(1);
		const outline = (child.spec as ShapeSpec).local?.curvePaths;
		right.set(0.25);
		commit();
		expect(clipBounds((child.spec as ShapeSpec).clip)?.maxX).toBe(0.25);
		expect((child.spec as ShapeSpec).local?.curvePaths).toBe(outline);
		clipped.set("x", 2);
		commit();
		expect(clipBounds((child.spec as ShapeSpec).clip)?.maxX).toBe(2.25);
	});

	it("removing the clip removes it from every child", () => {
		const { graph, commit } = manualGraph();
		const child = rect.create({ width: 1, height: 1 });
		const clipped = graph.root.add(
			group.create({ clip: unit, children: [child] }),
		);
		commit();
		expect((child.spec as ShapeSpec).clip).toHaveLength(1);
		clipped.set("clip", undefined);
		commit();
		expect("clip" in (child.spec as ShapeSpec)).toBe(false);
	});
});
