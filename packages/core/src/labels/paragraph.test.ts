/**
 * `wrapText`, `paragraph`, `bulletedList` and `title`: greedy wrapping by measured width, blocks stacked
 * down from the top and centred on their anchor with a handle onto the whole
 * box, line-by-line reveal, hanging bullets, and a title pinned to the top of
 * the frame with its rule.
 */

import { describe, expect, it } from "vitest";
import { track } from "../reactive/index.js";
import { frameContext, themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import { DELTA } from "../spec/layout.js";
import { measureLabel } from "../spec/metrics.js";
import type { DrawSpec, TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { bulletedList, paragraph, title, wrapText } from "./paragraph.js";

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

describe("wrapText", () => {
	it("fits words greedily to the measure and keeps newlines", () => {
		const one = measureLabel("lorem", font).width;
		const lines = wrapText("lorem ipsum dolor\n\nsit", font, one * 2.5);
		expect(lines[lines.length - 2]).toBe("");
		expect(lines[lines.length - 1]).toBe("sit");
		for (const line of lines)
			expect(measureLabel(line, font).width).toBeLessThanOrEqual(one * 2.5);
		expect(lines.join(" ").replace(/\s+/g, " ").trim()).toBe(
			"lorem ipsum dolor sit",
		);
	});

	it("breaks only at newlines without a measure, and gives a long word its own line", () => {
		expect(wrapText("a   b\nc", font)).toEqual(["a b", "c"]);
		expect(wrapText("tiny enormousword tiny", font, 0.01)).toEqual([
			"tiny",
			"enormousword",
			"tiny",
		]);
	});
});

describe("paragraph", () => {
	it("stacks its lines down from the top, left-aligned, centred on its anchor", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			paragraph.create({
				text: "first\nsecond\nthird",
				fontSize: 0.4,
				x: 1,
				y: 2,
			}),
		);
		commit();
		const lines = texts(graph.frame);
		expect(lines.map((l) => l.text)).toEqual(["first", "second", "third"]);
		expect(lines[0]?.at.y).toBeGreaterThan(lines[1]?.at.y ?? 0);
		expect(lines[1]?.at.y).toBeCloseTo(2, 9);
		for (const line of lines) expect(line.style.align).toBe("left");
		expect(new Set(lines.map((l) => l.at.x)).size).toBe(1);
		const box = node.bounds();
		expect(box && (box.minY + box.maxY) / 2).toBeCloseTo(2, 9);
		expect(box && (box.minX + box.maxX) / 2).toBeCloseTo(1, 9);
		expect(box && box.maxY - box.minY).toBeCloseTo(3 * 0.4 * 1.3, 9);
	});

	it("is as wide as its measure when given one, and aligns within it", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			paragraph.create({ text: "short", width: 6, align: "right" }),
		);
		commit();
		const [line] = texts(graph.frame);
		expect(line?.at.x).toBeCloseTo(3, 9);
		expect(line?.style.align).toBe("right");
		expect(node.width()).toBeCloseTo(6, 9);
	});

	it("writes line by line", () => {
		const { graph, commit } = manualGraph();
		const progress = track(0.5);
		graph.root.add(paragraph.create({ text: "a\nb\nc\nd", progress }));
		commit();
		expect(texts(graph.frame).map((l) => l.text)).toEqual(["a", "b"]);
		progress.set(0.625);
		commit();
		const half = texts(graph.frame);
		expect(half).toHaveLength(3);
		expect(half[2]?.progress).toBeCloseTo(0.5, 9);
	});

	it("a reveal or a move re-places its lines without re-wrapping them", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			paragraph.create({ text: "one two three", width: 1 }),
		);
		commit();
		const children = [...node.children];
		node.update({ x: 1, progress: 0.5 });
		commit();
		expect(node.children).toEqual(children);
		node.set("text", "one");
		commit();
		expect(node.children).toHaveLength(1);
		expect(node.children[0]).toBe(children[0]);
	});

	it("takes place, like a label", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			paragraph.create({ text: "x", place: { [DELTA]: { x: 2, y: -1 } } }),
		);
		commit();
		expect(node.center()?.x).toBeCloseTo(2, 9);
		expect(node.center()?.y).toBeCloseTo(-1, 9);
	});
});

describe("bulletedList", () => {
	it("puts a bullet before each item and hangs wrapped lines past it", () => {
		const { graph, commit } = manualGraph();
		const one = measureLabel("alpha", font).width;
		graph.root.add(
			bulletedList.create({
				items: ["alpha beta", "gamma"],
				fontSize: 0.4,
				width: one * 1.5 + 0.24,
			}),
		);
		commit();
		const lines = texts(graph.frame);
		expect(lines.map((l) => l.text)).toEqual([
			"•",
			"alpha",
			"beta",
			"•",
			"gamma",
		]);
		const [bullet, alpha, beta] = lines;
		expect(alpha?.at.x).toBeCloseTo((bullet?.at.x ?? 0) + 0.24, 9);
		expect(beta?.at.x).toBeCloseTo(alpha?.at.x ?? 0, 9);
		expect(bullet?.at.y).toBeCloseTo(alpha?.at.y ?? 0, 9);
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
