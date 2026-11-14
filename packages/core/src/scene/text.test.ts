/**
 * The text node kind through `label`: its spec is what `bakeTextSpec` and
 * `bakeTextStyle` build for the same props, groups scale and turn it, its
 * handle is the measured box oriented for the scene's `yUp`, and a move
 * keeps the style.
 */

import { describe, expect, it } from "vitest";
import { bakeTextSpec, bakeTextStyle } from "../spec/bake.js";
import { labelBox } from "../spec/metrics.js";
import type { TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { Invalidate, themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import { group } from "./group.js";
import { defineText, label, type TextProps, textProps } from "./text.js";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

describe("label", () => {
	it("publishes what bakeTextSpec builds for the same props", () => {
		const { graph, commit } = manualGraph();
		const props = {
			text: "hello",
			x: 1,
			y: 2,
			fontSize: 0.5,
			color: "#f00",
			align: "left" as const,
			rotation: 0.2,
			zIndex: 3,
			progress: 0.5,
			halo: true,
		};
		const node = graph.root.add(label.create(props));
		commit();
		const style = bakeTextStyle({ ...props, fill: props.color }, theme, 1, 1);
		expect(node.spec).toEqual(
			bakeTextSpec({
				id: node.id,
				zIndex: 3,
				text: "hello",
				at: { x: 1, y: 2 },
				rotation: 0.2,
				matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
				style,
				progress: 0.5,
			}),
		);
	});

	it("an empty string, a hidden label or nothing revealed draws nothing", () => {
		const { graph, commit } = manualGraph();
		const empty = graph.root.add(label.create({ text: "" }));
		const hidden = graph.root.add(label.create({ text: "a", visible: false }));
		const unrevealed = graph.root.add(label.create({ text: "a", progress: 0 }));
		commit();
		expect([empty.spec, hidden.spec, unrevealed.spec]).toEqual([
			null,
			null,
			null,
		]);
		expect(graph.frame).toEqual([]);
	});

	it("a rotated group turns the baseline and scales the font", () => {
		const { graph, commit } = manualGraph();
		const node = label.create({ text: "a", x: 1, fontSize: 0.5 });
		graph.root.add(
			group.create({ rotation: Math.PI / 2, scale: 2, children: [node] }),
		);
		commit();
		const spec = node.spec as TextSpec;
		expect(spec.at.x).toBeCloseTo(0, 9);
		expect(spec.at.y).toBeCloseTo(2, 9);
		expect(spec.rotation).toBeCloseTo(Math.PI / 2, 9);
		expect(spec.style.fontSize).toBeCloseTo(1, 9);
	});

	it("a move keeps the style; a restyle keeps the anchor", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(label.create({ text: "a" }));
		commit();
		const first = node.spec as TextSpec;
		node.set("x", 2);
		commit();
		const moved = node.spec as TextSpec;
		expect(moved.style).toBe(first.style);
		expect(moved.at).toEqual({ x: 2, y: 0 });
		node.set("color", "#0f0");
		commit();
		expect((node.spec as TextSpec).at).toBe(moved.at);
		expect((node.spec as TextSpec).style.fill).toBe("#0f0");
	});

	it("a group's move keeps the style; its scale rebuilds it", () => {
		const { graph, commit } = manualGraph();
		const node = label.create({ text: "a" });
		const parent = graph.root.add(group.create({ children: [node] }));
		commit();
		const first = node.spec as TextSpec;
		parent.set("x", 3);
		commit();
		expect((node.spec as TextSpec).at).toEqual({ x: 3, y: 0 });
		expect((node.spec as TextSpec).style).toBe(first.style);
		parent.set("scale", 2);
		commit();
		expect((node.spec as TextSpec).style.fontSize).toBeCloseTo(
			first.style.fontSize * 2,
			9,
		);
	});

	it("its handle is the measured box at the anchor, flipped on a y-down scene", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			label.create({ text: "abc", x: 1, fontSize: 1, baseline: "top" }),
		);
		commit();
		const style = (node.spec as TextSpec).style;
		const box = labelBox("abc", style, true);
		expect(node.bounds()).toEqual({
			minX: box.minX + 1,
			minY: box.minY,
			maxX: box.maxX + 1,
			maxY: box.maxY,
		});
		const spec = node.spec;
		graph.setYUp(false);
		commit();
		// The spec is untouched: glyphs are drawn upright either way.
		expect(node.spec).toBe(spec);
		const flipped = labelBox("abc", style, false);
		expect(node.bounds()?.minY).toBeCloseTo(flipped.minY, 9);
		expect(node.bounds()?.maxY).toBeCloseTo(flipped.maxY, 9);
	});

	it("its handle box measures in local units through a scaled group", () => {
		const { graph } = manualGraph();
		const node = label.create({ text: "ab", fontSize: 1 });
		graph.root.add(group.create({ scale: 2, children: [node] }));
		const plain = label.create({ text: "ab", fontSize: 1 });
		graph.root.add(plain);
		expect(node.width()).toBeCloseTo(plain.width() * 2, 9);
		expect(node.localBounds()).toEqual(node.bounds());
	});
});

describe("defineText", () => {
	interface CounterProps extends TextProps {
		value?: number;
	}
	const counter = defineText<CounterProps>({
		name: "Counter",
		props: {
			...textProps,
			value: { default: 0, invalidates: Invalidate.GEOMETRY },
		},
		text: (props) => String(Math.round(props.value ?? 0)),
	});

	it("draws the string its function gives, rerun only for geometry props", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(counter.create({ value: 2.4 }));
		commit();
		expect((node.spec as TextSpec).text).toBe("2");
		const spec = node.spec;
		node.set("value", 1.6);
		commit();
		// Same string, same everything: the spec is kept.
		expect(node.spec).toBe(spec);
		node.set("value", 7);
		commit();
		expect((node.spec as TextSpec).text).toBe("7");
	});
});

describe("rich text", () => {
	it("keeps one plain line a single run", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(label.create({ text: "plain" }));
		commit();
		expect((node.spec as TextSpec).fragments).toBeUndefined();
	});

	it("lays out spans as fragments in their own styles", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			label.create({
				text: [
					"a ",
					{ text: "bold", fontWeight: 700, color: "#f00", underline: true },
				],
				fontSize: 0.5,
			}),
		);
		commit();
		const spec = node.spec as TextSpec;
		expect(spec.text).toBe("a bold");
		expect(spec.fragments?.map((f) => f.text)).toEqual(["a ", "bold"]);
		const bold = spec.fragments?.[1];
		expect(bold?.style.fontWeight).toBe(700);
		expect(bold?.style.fill).toBe("#f00");
		expect(bold?.style.fontSize).toBe(0.5);
		expect(bold?.underline).toBe(true);
		// Centred on the anchor, as one line would be.
		const box = spec.box as { minX: number; maxX: number };
		expect(box.minX).toBeCloseTo(-box.maxX);
	});

	it("wraps at a width in the node's units, scaled by its groups", () => {
		const { graph, commit } = manualGraph();
		const scaled = graph.root.add(group.create({ scale: 2 }));
		const node = scaled.add(
			label.create({
				text: "one two three four",
				width: 1.2,
				fontSize: 0.3,
				align: "left",
			}),
		);
		commit();
		const spec = node.spec as TextSpec;
		const lines = new Set(spec.fragments?.map((f) => f.offset.y));
		expect(lines.size).toBeGreaterThan(1);
		expect(spec.box?.maxX).toBeCloseTo(2.4);
		// The handle goes through the group back to the same scene box.
		const bounds = node.bounds();
		expect((bounds?.maxX ?? 0) - (bounds?.minX ?? 0)).toBeCloseTo(2.4);
	});

	it("breaks at newlines and puts the first baseline on the anchor", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			label.create({ text: "a\nb", baseline: "alphabetic", fontSize: 1 }),
		);
		commit();
		const spec = node.spec as TextSpec;
		expect(spec.fragments?.[0]?.offset.y).toBeCloseTo(0);
		expect(spec.fragments?.[1]?.offset.y).toBeCloseTo(-1.3);
	});
});
