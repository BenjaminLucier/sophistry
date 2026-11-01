/**
 * `labeledDot` and `networkGraph` size their discs from text measured in
 * pixels, so they measure again when an ancestor's scale changes (a tracked
 * `ctx.space()` read), not only when one of their own props does.
 */

import { describe, expect, it, vi } from "vitest";
import { networkGraph } from "../network/network-graph.js";
import { themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import { group } from "../scene/group.js";
import { resolveTheme } from "../themes/index.js";
import { labeledDot } from "./dot.js";

const measured = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../spec/metrics.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../spec/metrics.js")>();
	return {
		...original,
		labelBox: (...args: Parameters<typeof original.labelBox>) => {
			measured.calls++;
			return original.labelBox(...args);
		},
	};
});

function mount(...nodes: Parameters<SceneGraph["root"]["add"]>[0][]) {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	for (const node of nodes) graph.root.add(node);
	graph.commit();
	return graph;
}

describe("measuring text in pixels follows the enclosing scale", () => {
	it("labeledDot measures again when a group above it zooms", () => {
		const zoom = group.create({
			scale: 1,
			children: [labeledDot.create({ text: "42" })],
		});
		const graph = mount(zoom);
		const first = measured.calls;
		expect(first).toBeGreaterThan(0);
		zoom.set("scale", 2);
		graph.commit();
		expect(measured.calls).toBeGreaterThan(first);
	});

	it("a labelled network graph measures again; an unlabelled one is not rebuilt", () => {
		const props = { vertices: [1, 2], edges: [[1, 2]] as [number, number][] };
		const labelled = group.create({
			scale: 1,
			children: [networkGraph.create({ ...props, labels: true })],
		});
		const graph = mount(labelled);
		const first = measured.calls;
		labelled.set("scale", 2);
		graph.commit();
		expect(measured.calls).toBeGreaterThan(first);

		const bare = group.create({
			scale: 1,
			children: [networkGraph.create(props)],
		});
		const other = mount(bare);
		const before = measured.calls;
		bare.set("scale", 2);
		other.commit();
		expect(measured.calls).toBe(before);
	});
});
