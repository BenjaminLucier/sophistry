/**
 * Inline nodes in text: a scene node set into a line like a wide glyph,
 * placed on the baseline, scaled with the text's group, and laid out again
 * when it changes size.
 */

import { describe, expect, it } from "vitest";
import { circle } from "../shapes/circle.js";
import type { TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import { group } from "./group.js";
import { text } from "./text.js";

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	return { graph, commit: () => graph.commit() };
}

describe("inline nodes in text", () => {
	it("sets a node into the line, centred a little above the baseline", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 0.5 });
		const words = graph.root.add(
			text.create({
				text: ["a ", { inline: dot }, " b"],
				fontSize: 0.4,
				align: "left",
				baseline: "alphabetic",
			}),
		);
		commit();
		const spec = words.spec as TextSpec;
		const [before, after] = spec.fragments ?? [];
		expect(before?.text).toBe("a ");
		const box = dot.bounds();
		// After "a " and before " b".
		expect(box?.minX).toBeCloseTo(
			(before?.offset.x ?? 0) + (before?.width ?? 0),
		);
		expect(after?.offset.x).toBeCloseTo(box?.maxX ?? 0);
		// The baseline is on the anchor; the dot's centre 0.3 em above it.
		expect(((box?.minY ?? 0) + (box?.maxY ?? 0)) / 2).toBeCloseTo(0.12);
		// The block grew to hold it.
		expect(spec.box?.maxY).toBeGreaterThanOrEqual((box?.maxY ?? 0) - 1e-9);
	});

	it("puts the baseline where the node says", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 0.5 });
		graph.root.add(
			text.create({
				text: ["x", { inline: dot, baseline: 0 }],
				align: "left",
				baseline: "alphabetic",
			}),
		);
		commit();
		expect(dot.bounds()?.minY).toBeCloseTo(0);
	});

	it("scales the node with the text's group", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 0.5 });
		graph.root.add(
			group.create({
				scale: 2,
				children: [text.create({ text: ["x", { inline: dot }] })],
			}),
		);
		commit();
		const box = dot.bounds();
		expect((box?.maxX ?? 0) - (box?.minX ?? 0)).toBeCloseTo(2);
	});

	it("lays the line out again when the node changes size", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 0.5 });
		const words = graph.root.add(
			text.create({
				text: [{ inline: dot }, " b"],
				align: "left",
				baseline: "alphabetic",
			}),
		);
		commit();
		const first = (words.spec as TextSpec).fragments?.[0]?.offset.x ?? 0;
		dot.set("radius", 1);
		commit();
		const second = (words.spec as TextSpec).fragments?.[0]?.offset.x ?? 0;
		expect(second - first).toBeCloseTo(1);
	});

	it("owns its inline nodes: they are its children, and go when dropped", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 0.5 });
		const words = graph.root.add(text.create({ text: ["a", { inline: dot }] }));
		commit();
		expect(words.children).toEqual([dot]);
		words.set("text", "a");
		commit();
		expect(words.children).toEqual([]);
		expect(dot.disposed).toBe(true);
	});
});
