/**
 * The `zIndex`/`visible`/`progress` passthrough a composite gives every
 * primitive it draws, so the whole composite can be depth-sorted, hidden or
 * revealed through one prop exactly as a leaf shape can.
 *
 * A composite binds each child's
 * prop to `ctx.prop(...)`: the children follow the composite's prop with no
 * `update` at all, and an unset prop leaves the child's own default.
 */

import { describe, expect, it, vi } from "vitest";
import { track } from "../reactive";
import { circle, rect } from "../shapes";
import type { ShapeSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { defineComposite } from "./composite";
import { Invalidate, themeContext } from "./context";
import { SceneGraph } from "./graph";
import type { SceneNode } from "./types";

interface BadgeProps {
	zIndex?: number;
	visible?: boolean;
	progress?: number;
}

function badge() {
	const update = vi.fn(() => undefined);
	const definition = defineComposite<BadgeProps>({
		name: "Badge",
		props: {
			// Read only through `ctx.prop`: no update needed.
			zIndex: { default: 0, invalidates: Invalidate.NONE },
			visible: { default: true, invalidates: Invalidate.NONE },
			progress: { default: 1, invalidates: Invalidate.NONE },
		},
		setup: (ctx) => {
			const passthrough = {
				zIndex: ctx.prop("zIndex"),
				visible: ctx.prop("visible"),
				progress: ctx.prop("progress"),
			};
			return [
				circle.create({ radius: 1, ...passthrough }),
				rect.create({ width: 1, height: 1, ...passthrough }),
			];
		},
		update,
	});
	return { definition, update };
}

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	return { graph, commit: () => graph.commit() };
}

const specs = (nodes: readonly SceneNode[]) =>
	nodes.map((node) => (node as unknown as { spec: ShapeSpec | null }).spec);

describe("passthrough via ctx.prop", () => {
	it("children read the composite's current zIndex/visible/progress, not the first value", () => {
		const { definition, update } = badge();
		const { graph, commit } = manualGraph();
		const z = track(1);
		const node = graph.root.add(
			definition.create({ zIndex: z, visible: true, progress: 0.5 }),
		);
		commit();
		expect(specs(node.children).map((spec) => spec?.zIndex)).toEqual([1, 1]);
		expect(specs(node.children).map((spec) => spec?.progress)).toEqual([
			0.5, 0.5,
		]);

		// A copied value would stay 1; a bound one follows.
		z.set(2);
		node.set("progress", 0.9);
		commit();
		expect(specs(node.children).map((spec) => spec?.zIndex)).toEqual([2, 2]);
		expect(specs(node.children).map((spec) => spec?.progress)).toEqual([
			0.9, 0.9,
		]);
		expect(graph.frame.map((spec) => spec.zIndex)).toEqual([2, 2]);

		node.set("visible", false);
		commit();
		expect(specs(node.children)).toEqual([null, null]);
		expect(graph.frame).toEqual([]);
		expect(update).not.toHaveBeenCalled();
	});

	it("leaves unset fields to the children's own defaults", () => {
		const { definition } = badge();
		const { graph, commit } = manualGraph();
		const node = graph.root.add(definition.create());
		commit();
		const [first] = specs(node.children);
		expect(first?.zIndex).toBe(0);
		expect(first?.progress).toBe(1);
		expect(graph.frame).toHaveLength(2);
	});

	it("disposing the composite ends the children's bindings to it", () => {
		const { definition } = badge();
		const { graph, commit } = manualGraph();
		const node = graph.root.add(definition.create({ zIndex: 1 }));
		commit();
		const children = [...node.children];
		node.dispose();
		expect(children.every((child) => child.disposed)).toBe(true);
		expect(graph.needsCommit()).toBe(true);
		commit();
		expect(graph.frame).toEqual([]);
	});
});
