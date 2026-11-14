/**
 * Paint order is tree order: z ties paint in the order nodes sit in the tree
 * (depth first, composites' children in place), not the order they were
 * made or attached in. Tab order (the interactive nodes' `treeIndex`) follows
 * the same order.
 */

import { describe, expect, it } from "vitest";
import type { DrawSpec, TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { defineComposite } from "./composite.js";
import { themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import { group } from "./group.js";
import type { BaseNode } from "./node.js";
import { text } from "./text.js";

function manualGraph() {
	const frames: (readonly DrawSpec[])[] = [];
	const graph = new SceneGraph({
		schedule: () => {},
		onFrame: (frame) => frames.push(frame),
	});
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	const commit = () => graph.commit();
	const texts = () => graph.frame.map((spec) => (spec as TextSpec).text);
	return { graph, frames, commit, texts };
}

/** A composite: two labels from one definition, as axes and friends are. */
const pair = defineComposite<object>({
	name: "Pair",
	props: {},
	setup: () => [text.create({ text: "b" }), text.create({ text: "c" })],
});

describe("tree order of scene nodes", () => {
	it("matches tree order for plain siblings and composites", () => {
		const { graph, commit, texts } = manualGraph();
		graph.root.setChildren([
			text.create({ text: "a" }),
			pair.create(),
			text.create({ text: "d" }),
		]);
		commit();
		expect(texts()).toEqual(["a", "b", "c", "d"]);
	});

	it("a node added later between siblings sits where it is inserted, not at the end", () => {
		const { graph, commit, texts } = manualGraph();
		const a = graph.root.add(text.create({ text: "a" }));
		const c = graph.root.add(text.create({ text: "c" }));
		commit();
		const b = graph.root.add(text.create({ text: "b" }), c);
		commit();
		expect(texts()).toEqual(["a", "b", "c"]);
		b.dispose();
		commit();
		expect(texts()).toEqual(["a", "c"]);
		// A node made first but placed first comes first.
		graph.root.add(text.create({ text: "first" }), a);
		commit();
		expect(texts()).toEqual(["first", "a", "c"]);
	});

	it("showing a hidden node puts it back at its tree position", () => {
		const { graph, commit, texts } = manualGraph();
		const b = text.create({ text: "b", visible: false });
		graph.root.setChildren([
			text.create({ text: "a" }),
			b,
			text.create({ text: "c" }),
		]);
		commit();
		expect(texts()).toEqual(["a", "c"]);
		b.set("visible", true);
		commit();
		expect(texts()).toEqual(["a", "b", "c"]);
	});

	it("reordering children reorders the specs, though nothing is made or disposed", () => {
		const { graph, commit, texts } = manualGraph();
		const x = text.create({ text: "x" });
		const y = text.create({ text: "y" });
		const z = text.create({ text: "z" });
		graph.root.setChildren([x, y, z]);
		commit();
		const specs = new Set(graph.frame);
		graph.root.setChildren([z, x, y]);
		commit();
		expect(texts()).toEqual(["z", "x", "y"]);
		// The same specs, re-sequenced.
		expect(new Set(graph.frame)).toEqual(specs);
		graph.root.setChildren([y, z, x]);
		commit();
		expect(texts()).toEqual(["y", "z", "x"]);
		expect([x, y, z].some((node) => node.disposed)).toBe(false);
	});

	it("nodes inside groups paint in depth-first order", () => {
		const { graph, commit, texts } = manualGraph();
		graph.root.setChildren([
			text.create({ text: "a" }),
			group.create({
				children: [
					text.create({ text: "b" }),
					group.create({ children: [text.create({ text: "c" })] }),
				],
			}),
			text.create({ text: "d" }),
		]);
		commit();
		expect(texts()).toEqual(["a", "b", "c", "d"]);
	});

	it("keeps the frame array while nothing about membership or order changed", () => {
		const { graph, commit, frames } = manualGraph();
		graph.root.setChildren([
			text.create({ text: "a" }),
			text.create({ text: "b" }),
		]);
		commit();
		const first = graph.frame;
		expect(commit()).toBe(false);
		expect(graph.frame).toBe(first);
		expect(frames).toHaveLength(1);
	});
});

describe("paint order through the collector", () => {
	it("ties at equal z paint in tree order, and z still dominates", () => {
		const { graph, commit, texts } = manualGraph();
		const b = text.create({ text: "b", visible: false });
		graph.root.setChildren([
			text.create({ text: "a", zIndex: 1 }),
			b,
			text.create({ text: "c" }),
			text.create({ text: "d", zIndex: 1 }),
		]);
		commit();
		expect(texts()).toEqual(["c", "a", "d"]);
		b.set("visible", true);
		commit();
		// z=0 nodes first in tree order (b before c), then z=1 (a, d).
		expect(texts()).toEqual(["b", "c", "a", "d"]);
	});
});

describe("tab order follows tree order too", () => {
	const noop = () => {};
	/** Interactive nodes' texts by tree index: the order the focus ring visits. */
	const tabOrder = (graph: SceneGraph) =>
		[...graph.interactive]
			.sort((a, b) => a.treeIndex - b.treeIndex)
			.map((node: BaseNode) => (node.spec as TextSpec).text);

	it("a node inserted later takes its tab position from the tree", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(text.create({ text: "a", onTap: noop }));
		const c = graph.root.add(text.create({ text: "c", onTap: noop }));
		commit();
		expect(tabOrder(graph)).toEqual(["a", "c"]);
		graph.root.add(text.create({ text: "b", onTap: noop }), c);
		commit();
		expect(tabOrder(graph)).toEqual(["a", "b", "c"]);
	});

	it("reordering children reorders the tab stops", () => {
		const { graph, commit } = manualGraph();
		const nodes = ["x", "y", "z"].map((name) =>
			text.create({ text: name, onTap: noop }),
		);
		graph.root.setChildren(nodes);
		commit();
		expect(tabOrder(graph)).toEqual(["x", "y", "z"]);
		graph.root.setChildren([...nodes].reverse());
		commit();
		expect(tabOrder(graph)).toEqual(["z", "y", "x"]);
	});
});
