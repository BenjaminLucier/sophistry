/**
 * `bulletedList` and `title`: a list of text nodes with hanging bullets,
 * centred on its anchor with a handle onto the whole box and revealed an item
 * at a time, and a title pinned to the top of the frame with its rule.
 */

import { describe, expect, it } from "vitest";
import { track } from "../reactive/index.js";
import { frameContext, themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import { measureLabel } from "../spec/metrics.js";
import type { DrawSpec, TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { bulletedList, title } from "./text-presets.js";

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme());
	return { graph, commit: () => graph.commit() };
}

const texts = (specs: readonly DrawSpec[]) =>
	specs.flatMap((s) => (s.kind === "text" ? [s] : [])) as TextSpec[];

const font = {
	fontSize: 0.4,
	fontFamily: "sans-serif",
	fontWeight: 500,
	italic: false,
	letterSpacing: 0,
};

describe("bulletedList", () => {
	it("puts a bullet before each item and hangs wrapped lines past it", () => {
		const { graph, commit } = manualGraph();
		const one = measureLabel("alpha", font).width;
		const list = graph.root.add(
			bulletedList.create({
				items: ["alpha beta", "gamma"],
				fontSize: 0.4,
				width: one * 1.5 + 0.24,
			}),
		);
		commit();
		const specs = texts(graph.frame);
		expect(specs.map((l) => l.text)).toEqual(["•", "alpha beta", "•", "gamma"]);
		const [bullet, item, , last] = specs;
		// The item wraps onto two lines, both past the bullet.
		const fragments = item?.fragments ?? [];
		expect(fragments.map((f) => f.text)).toEqual(["alpha", "beta"]);
		expect(item?.at.x).toBeCloseTo((bullet?.at.x ?? 0) + 0.24, 9);
		expect(fragments[0]?.offset.x).toBeCloseTo(fragments[1]?.offset.x ?? 1, 9);
		// Bullet and first line share a baseline.
		expect(bullet?.at.y).toBeCloseTo(item?.at.y ?? 1, 9);
		expect(last?.at.y).toBeLessThan(item?.at.y ?? 0);
		const box = list.bounds();
		expect(box && (box.minY + box.maxY) / 2).toBeCloseTo(0, 9);
	});

	it("reveals an item at a time, its bullet with it", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(bulletedList.create({ items: ["a", "b"], progress: 0.5 }));
		commit();
		expect(texts(graph.frame).map((l) => l.text)).toEqual(["•", "a"]);
	});

	it("takes spans in its items", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(
			bulletedList.create({
				items: [["plain ", { text: "bold", fontWeight: 700 }]],
			}),
		);
		commit();
		const item = texts(graph.frame)[1];
		expect(item?.fragments?.[1]?.style.fontWeight).toBe(700);
	});
});

describe("title", () => {
	it("sits at the top of the frame with a rule under it", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(title.create({ text: "Chain rule" }));
		commit();
		const [heading] = texts(graph.frame);
		expect(heading?.text).toBe("Chain rule");
		expect(heading?.at.x).toBeCloseTo(0, 9);
		expect(heading?.at.y).toBeLessThan(4.5);
		expect(heading?.at.y).toBeGreaterThan(3);
		const rule = graph.frame.find((s) => s.kind === "shape");
		const points = (rule?.kind === "shape" ? rule.polylines.flat() : []) as {
			x: number;
			y: number;
		}[];
		expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(-7, 9);
		expect(Math.max(...points.map((p) => p.y))).toBeLessThan(
			heading?.at.y ?? 0,
		);
	});

	it("can match the rule to the text, or drop it", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(title.create({ text: "Wide", matchUnderlineToText: true }));
		commit();
		const rule = graph.frame.find((s) => s.kind === "shape");
		const xs = (rule?.kind === "shape" ? rule.polylines.flat() : []).map(
			(p) => (p as { x: number }).x,
		);
		expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(4);
		const bare = manualGraph();
		const node = bare.graph.root.add(
			title.create({ text: "Bare", underline: false }),
		);
		bare.commit();
		expect(bare.graph.frame.filter((s) => s.kind === "shape")).toHaveLength(0);
		node.set("underline", true);
		bare.commit();
		expect(bare.graph.frame.filter((s) => s.kind === "shape")).toHaveLength(1);
	});

	it("follows the frame, and its handle is the text's box", () => {
		const { graph, commit } = manualGraph();
		const frame = track({ minX: -8, minY: -4.5, maxX: 8, maxY: 4.5 });
		graph.root.provide(frameContext, frame);
		const node = graph.root.add(title.create({ text: "Moving" }));
		commit();
		const box = node.bounds();
		const heading = texts(graph.frame)[0];
		expect(box && (box.minX + box.maxX) / 2).toBeCloseTo(heading?.at.x ?? 0, 9);
		frame.set({ minX: 2, minY: -4.5, maxX: 18, maxY: 4.5 });
		commit();
		expect(texts(graph.frame)[0]?.at.x).toBeCloseTo(10, 9);
		// Disposed, it stops following the frame.
		node.dispose();
		frame.set({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
		commit();
		expect(graph.frame).toEqual([]);
	});
});
