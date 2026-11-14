/**
 * `box`: the outermost box centred on its anchor, nested boxes laid out by
 * the outermost one, text wrapping inside and inheriting the box's text
 * style, scene nodes scaled into their cells, paint, and relayout when a
 * nested style or a text's content changes.
 */

import {
	circle,
	pixelsPerUnitContext,
	resolveTheme,
	text,
	themeContext,
} from "@sophistry/core";
import type { ShapeSpec, TextSpec } from "@sophistry/core/internal";
import { SceneGraph } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { box } from "./box.js";

/** 100 design pixels per scene unit, and a 16 × 9 frame: 1600 × 900 px. */
function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	graph.root.provide(pixelsPerUnitContext, 100);
	return { graph, commit: () => graph.commit() };
}

describe("box", () => {
	it("centres the outermost box on its anchor, sized in design pixels", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			box.create({ x: 1, y: 2, style: { width: 200, height: 100 } }),
		);
		commit();
		const bounds = node.bounds();
		expect(bounds?.minX).toBeCloseTo(0);
		expect(bounds?.maxX).toBeCloseTo(2);
		expect(bounds?.minY).toBeCloseTo(1.5);
		expect(bounds?.maxY).toBeCloseTo(2.5);
	});

	it("lays nested boxes out top to bottom, left to right", () => {
		const { graph, commit } = manualGraph();
		const first = box.create({ style: { width: 100, height: 50 } });
		const second = box.create({ style: { width: 100, height: 80 } });
		const root = graph.root.add(
			box.create({
				style: { padding: 10, gap: 20, alignItems: "flex-start" },
				children: [first, second],
			}),
		);
		commit();
		const outer = root.bounds();
		// 10 + 100 + 20 + 100 + 10 wide, 10 + 80 + 10 tall.
		expect((outer?.maxX ?? 0) - (outer?.minX ?? 0)).toBeCloseTo(2.4);
		expect((outer?.maxY ?? 0) - (outer?.minY ?? 0)).toBeCloseTo(1);
		const a = first.bounds();
		const b = second.bounds();
		expect(a?.minX).toBeCloseTo((outer?.minX ?? 0) + 0.1);
		expect(b?.minX).toBeCloseTo((outer?.minX ?? 0) + 1.3);
		// The top is the top: y runs down inside a box.
		expect(a?.maxY).toBeCloseTo((outer?.maxY ?? 0) - 0.1);
		expect(a?.minY).toBeCloseTo((outer?.maxY ?? 0) - 0.6);
	});

	it("wraps text at the box's width and grows to fit it", () => {
		const { graph, commit } = manualGraph();
		const words = text.create({
			text: "one two three four five six seven eight",
			fontSize: 20,
		});
		const root = graph.root.add(
			box.create({ style: { width: 200, padding: 10 }, children: [words] }),
		);
		commit();
		const spec = words.spec as TextSpec;
		const lines = new Set(spec.fragments?.map((f) => f.offset.y.toFixed(6)));
		expect(lines.size).toBeGreaterThan(1);
		// The text is in pixels: 20 px is 0.2 scene units.
		expect(spec.style.fontSize).toBeCloseTo(0.2);
		const outer = root.bounds();
		const height = (outer?.maxY ?? 0) - (outer?.minY ?? 0);
		expect(height).toBeCloseTo(0.2 + lines.size * 0.2 * 1.3, 5);
		// Its block hangs from the content box's top left corner.
		expect(spec.at.x).toBeCloseTo((outer?.minX ?? 0) + 0.1);
		expect(spec.at.y).toBeCloseTo((outer?.maxY ?? 0) - 0.1);
	});

	it("hands its text style down to the text inside", () => {
		const { graph, commit } = manualGraph();
		const words = text.create({ text: "hi" });
		graph.root.add(
			box.create({
				style: { color: "#ff0000", fontSize: 30, fontWeight: 700 },
				children: [box.create({ children: [words] })],
			}),
		);
		commit();
		const style = (words.spec as TextSpec).style;
		expect(style.fill).toBe("#ff0000");
		expect(style.fontSize).toBeCloseTo(0.3);
		expect(style.fontWeight).toBe(700);
	});

	it("places a scene node in its cell beside other items", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 0.5, center: { x: 3, y: -2 } });
		const root = graph.root.add(
			box.create({
				style: { flexDirection: "row", gap: 50, padding: 10 },
				children: [box.create({ style: { width: 200, height: 100 } }), dot],
			}),
		);
		commit();
		const outer = root.bounds();
		const inner = dot.bounds();
		// 10 + 200 + 50 in from the left, 10 down from the top.
		expect(inner?.minX).toBeCloseTo((outer?.minX ?? 0) + 2.6, 2);
		expect(inner?.maxY).toBeCloseTo((outer?.maxY ?? 0) - 0.1, 2);
		// Laying out again leaves it where it is.
		root.set("style", { flexDirection: "row", gap: 50, padding: 10 });
		commit();
		expect(dot.bounds()?.minX).toBeCloseTo(inner?.minX ?? 0, 6);
	});

	it("scales a scene node into its cell, keeping scene units", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 0.5 });
		const root = graph.root.add(
			box.create({ style: { padding: 20 }, children: [dot] }),
		);
		commit();
		const outer = root.bounds();
		// A unit-wide circle is 100 px wide in its cell.
		expect((outer?.maxX ?? 0) - (outer?.minX ?? 0)).toBeCloseTo(1.4);
		const inner = dot.bounds();
		expect(inner?.minX).toBeCloseTo((outer?.minX ?? 0) + 0.2, 2);
		expect(inner?.maxY).toBeCloseTo((outer?.maxY ?? 0) - 0.2, 2);
		expect((inner?.maxX ?? 0) - (inner?.minX ?? 0)).toBeCloseTo(1, 2);
	});

	it("paints a background and a border ring", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(
			box.create({
				style: {
					width: 200,
					height: 100,
					background: "#123456",
					borderWidth: 4,
					borderColor: "#ffffff",
					borderRadius: 16,
				},
			}),
		);
		commit();
		const shapes = graph.frame.filter(
			(spec): spec is ShapeSpec => spec.kind === "shape",
		);
		expect(shapes).toHaveLength(2);
		const [background, border] = shapes;
		expect(background?.style.fill).toBe("#123456");
		expect(border?.style.fill).toBe("#ffffff");
		// The ring: the outer outline and the inner one, wound the other way.
		expect(border?.local?.curvePaths?.length ?? border?.polylines.length).toBe(
			2,
		);
	});

	it("lays out again when a nested box's style changes", () => {
		const { graph, commit } = manualGraph();
		const inner = box.create({ style: { width: 100, height: 100 } });
		const root = graph.root.add(box.create({ children: [inner] }));
		commit();
		inner.set("style", { width: 300, height: 100 });
		commit();
		const outer = root.bounds();
		expect((outer?.maxX ?? 0) - (outer?.minX ?? 0)).toBeCloseTo(3);
	});

	it("lays out again when its text changes", () => {
		const { graph, commit } = manualGraph();
		const words = text.create({ text: "short", fontSize: 20 });
		const root = graph.root.add(
			box.create({ style: { width: 200 }, children: [words] }),
		);
		commit();
		const before = root.bounds();
		words.set(
			"text",
			"a much longer line of text that has to wrap onto more lines",
		);
		commit();
		const after = root.bounds();
		expect((after?.maxY ?? 0) - (after?.minY ?? 0)).toBeGreaterThan(
			(before?.maxY ?? 0) - (before?.minY ?? 0) + 0.2,
		);
	});

	it("keeps its own children list, without its paint", () => {
		const { graph, commit } = manualGraph();
		const words = text.create({ text: "a" });
		const root = graph.root.add(
			box.create({ style: { background: "#000000" }, children: [words] }),
		);
		commit();
		expect(root.children).toEqual([words]);
	});
});
