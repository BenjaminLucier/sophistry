/**
 * `decimalNumber`, `integer` and `variable`: one text spec per drawn
 * character, placed in tabular slots
 * (the specs are rebuilt here from `formatDecimal`/`layoutGlyphs`), column
 * nodes kept across value changes, the handle's run box and per-character
 * boxes, and `variable`'s three parts sharing one reveal.
 */

import { describe, expect, it } from "vitest";
import { track } from "../reactive";
import { Invalidate, themeContext } from "../scene/context";
import { SceneGraph } from "../scene/graph";
import { group } from "../scene/group";
import { bakeTextStyle } from "../spec/bake";
import { labelBox } from "../spec/metrics";
import type { TextSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { decimalNumber, integer, variable } from "./decimal-number";
import { formatDecimal, layoutGlyphs, MINUS } from "./digits";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

const texts = (frame: readonly unknown[]) =>
	(frame as TextSpec[]).filter((spec) => spec.kind === "text");

describe("decimalNumber", () => {
	it("emits one text spec per character, in tabular slots centred on the anchor", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(decimalNumber.create({ value: -Math.PI, x: 1, y: 2 }));
		commit();
		const style = bakeTextStyle({ align: "center" }, theme, 1, 1);
		const formatted = formatDecimal(-Math.PI);
		const run = layoutGlyphs(formatted.text, style, {
			numericEnd: formatted.numericEnd,
		});
		const left = -run.width / 2;
		expect(texts(graph.frame)).toEqual(
			run.slots.map((slot) => ({
				kind: "text",
				id: expect.any(Number),
				zIndex: 0,
				text: slot.char,
				at: { x: 1 + left + slot.center, y: 2 },
				rotation: 0,
				style: { ...style, letterSpacing: 0 },
				progress: 1,
			})),
		);
		expect(texts(graph.frame).map((spec) => spec.text)).toEqual([
			MINUS,
			"3",
			".",
			"1",
			"4",
		]);
	});

	it("formats with every NumberFormat option", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			decimalNumber.create({
				value: 12345.678,
				decimalPlaces: 1,
				groupDigits: true,
				sign: true,
				unit: " m",
			}),
		);
		commit();
		expect(node.text()).toBe("+12,345.7 m");
		// The space in the unit is a character too.
		expect(
			texts(graph.frame)
				.map((spec) => spec.text)
				.join(""),
		).toBe("+12,345.7 m");
	});

	it("keeps each column's node across value changes, and an unchanged column's spec", () => {
		const { graph, commit } = manualGraph();
		const value = track(10.25);
		const node = graph.root.add(decimalNumber.create({ value }));
		commit();
		const children = [...node.children];
		const before = texts(graph.frame);
		value.set(10.26);
		commit();
		expect(node.children).toEqual(children);
		const after = texts(graph.frame);
		// "10.2" draws as it did; only the last digit changed.
		for (let i = 0; i < 4; i++) expect(after[i]).toBe(before[i]);
		expect(after[4]?.text).toBe("6");
		expect(after[4]).not.toBe(before[4]);
	});

	it("minIntegerDigits and reserveSign hold the run's width still", () => {
		const { graph, commit } = manualGraph();
		const value = track(9);
		const node = graph.root.add(
			decimalNumber.create({
				value,
				minIntegerDigits: 2,
				reserveSign: true,
			}),
		);
		commit();
		const width = node.width();
		value.set(-10);
		commit();
		expect(node.width()).toBeCloseTo(width, 9);
		// Reserved slots draw nothing.
		expect(texts(graph.frame).map((spec) => spec.text)).toEqual([
			MINUS,
			"1",
			"0",
			".",
			"0",
			"0",
		]);
	});

	it("reveals left to right by width, each glyph taking its share", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			decimalNumber.create({ value: 1234, decimalPlaces: 0, progress: 0.5 }),
		);
		commit();
		expect(texts(graph.frame).map((spec) => spec.progress)).toEqual([1, 1]);
		node.set("progress", 0.625);
		commit();
		const shares = texts(graph.frame).map((spec) => spec.progress);
		expect(shares).toHaveLength(3);
		expect(shares[2]).toBeCloseTo(0.5, 9);
		node.set("progress", 0);
		commit();
		expect(texts(graph.frame)).toEqual([]);
	});

	it("hidden draws nothing, but the handle still measures", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			decimalNumber.create({ value: 5, visible: false }),
		);
		commit();
		expect(graph.frame).toEqual([]);
		expect(node.width()).toBeGreaterThan(0);
	});

	it("digitStyle styles, nudges and scales single characters", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(
			decimalNumber.create({
				value: 42,
				decimalPlaces: 0,
				digitStyle: (slot) =>
					slot.place === 1
						? { color: "#ff0000", opacity: 0.5, dy: 0.25, scale: 2 }
						: undefined,
			}),
		);
		commit();
		const [tens, units] = texts(graph.frame);
		expect(tens?.style.fill).toBe("#ff0000");
		expect(tens?.style.opacity).toBeCloseTo(0.5, 9);
		expect(tens?.style.fontSize).toBeCloseTo(theme.defaults.fontSize * 2, 9);
		expect(tens?.at.y).toBeCloseTo(0.25, 9);
		expect(units?.style.fill).toBe(theme.palette.foreground);
		expect(units?.at.y).toBe(0);
	});

	it("align moves the run against its anchor", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			decimalNumber.create({ value: 7, decimalPlaces: 0, align: "left" }),
		);
		commit();
		expect(node.bounds()?.minX).toBeCloseTo(0, 9);
		node.set("align", "right");
		commit();
		expect(node.bounds()?.maxX).toBeCloseTo(0, 9);
	});

	it("its handle is the run's box; charBounds is one slot of it", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			decimalNumber.create({ value: 3.5, x: 2, y: 1, fontSize: 1 }),
		);
		commit();
		const style = bakeTextStyle({ align: "center", fontSize: 1 }, theme, 1, 1);
		const run = layoutGlyphs("3.50", style, { numericEnd: 4 });
		const box = labelBox("3.50", style, true);
		const bounds = node.bounds();
		expect(bounds?.minX).toBeCloseTo(2 - run.width / 2, 9);
		expect(bounds?.maxX).toBeCloseTo(2 + run.width / 2, 9);
		expect(bounds?.minY).toBeCloseTo(1 + box.minY, 9);
		expect(bounds?.maxY).toBeCloseTo(1 + box.maxY, 9);
		const first = node.charBounds(0);
		const slot = run.slots[0];
		expect(first?.minX).toBeCloseTo(2 - run.width / 2, 9);
		expect(first?.maxX).toBeCloseTo(
			2 - run.width / 2 + (slot?.advance ?? 0),
			9,
		);
		expect(node.charBounds(99)).toBeNull();
	});

	it("an enclosing group scales the glyphs and leaves the handle in local units", () => {
		const { graph, commit } = manualGraph();
		const scaled = decimalNumber.create({ value: 1.5, fontSize: 1 });
		graph.root.add(group.create({ scale: 2, children: [scaled] }));
		const plain = graph.root.add(
			decimalNumber.create({ value: 1.5, fontSize: 1 }),
		);
		commit();
		const [glyph] = texts(
			scaled.children.map(
				(child) => (child as unknown as { spec: TextSpec }).spec,
			),
		);
		expect(glyph?.style.fontSize).toBeCloseTo(2, 9);
		expect(scaled.width()).toBeCloseTo(plain.width() * 2, 9);
	});

	it("a rotation turns the run about its anchor", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(
			decimalNumber.create({
				value: 11,
				decimalPlaces: 0,
				align: "left",
				rotation: Math.PI / 2,
			}),
		);
		commit();
		const [first, second] = texts(graph.frame);
		expect(first?.rotation).toBeCloseTo(Math.PI / 2, 9);
		expect(first?.at.x).toBeCloseTo(0, 9);
		expect(second?.at.x).toBeCloseTo(0, 9);
		expect((second?.at.y ?? 0) > (first?.at.y ?? 0)).toBe(true);
	});

	it("follows a bound value with one relayout per commit", () => {
		const { graph, commit } = manualGraph();
		const value = track(0);
		const node = graph.root.add(decimalNumber.create({ value }));
		commit();
		value.set(1);
		value.set(2);
		value.set(3);
		expect(node.text()).toBe("3.00");
		commit();
		expect(
			texts(graph.frame)
				.map((spec) => spec.text)
				.join(""),
		).toBe("3.00");
	});

	it("declares every prop as rerunning its layout", () => {
		for (const entry of Object.values(decimalNumber.descriptor)) {
			expect(entry.invalidates & Invalidate.UPDATE).toBe(Invalidate.UPDATE);
		}
	});
});

describe("integer", () => {
	it("has no fractional part and no decimalPlaces prop", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(integer.create({ value: 41.7 }));
		commit();
		expect(node.text()).toBe("42");
		expect("decimalPlaces" in integer.descriptor).toBe(false);
		expect(integer.name).toBe("Integer");
	});
});

describe("variable", () => {
	it("draws name, relation and number left to right from its anchor", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			variable.create({ label: "x", value: 3, x: -1 }),
		);
		commit();
		const specs = texts(graph.frame);
		expect(specs.map((spec) => spec.text)).toEqual([
			"x",
			"=",
			"3",
			".",
			"0",
			"0",
		]);
		const [name, relation, digit] = specs;
		expect(name?.at.x).toBeCloseTo(-1, 9);
		expect(name?.style.align).toBe("left");
		expect(name?.style.italic).toBe(true);
		expect(relation?.style.italic).toBe(false);
		expect((relation?.at.x ?? 0) > (name?.at.x ?? 0)).toBe(true);
		expect((digit?.at.x ?? 0) > (relation?.at.x ?? 0)).toBe(true);
		expect(node.text()).toBe("x = 3.00");
		expect(node.bounds()?.minX).toBeCloseTo(-1, 9);
	});

	it("colours the name and relation with labelColor, the number with color", () => {
		const { graph, commit } = manualGraph();
		graph.root.add(
			variable.create({
				label: "t",
				value: 1,
				color: "#00ff00",
				labelColor: "#ff0000",
			}),
		);
		commit();
		const [name, relation, digit] = texts(graph.frame);
		expect(name?.style.fill).toBe("#ff0000");
		expect(relation?.style.fill).toBe("#ff0000");
		expect(digit?.style.fill).toBe("#00ff00");
	});

	it("spends one reveal across the whole line", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			variable.create({ label: "x", value: 3, progress: 0 }),
		);
		commit();
		expect(texts(graph.frame)).toEqual([]);
		node.set("progress", 1);
		commit();
		expect(texts(graph.frame).every((spec) => spec.progress === 1)).toBe(true);
	});

	it("hidden builds no parts; shown again rebuilds them", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			variable.create({ label: "x", value: 3, visible: false }),
		);
		commit();
		expect(node.children).toHaveLength(0);
		node.set("visible", true);
		commit();
		expect(node.children).toHaveLength(3);
		expect(texts(graph.frame)).toHaveLength(6);
	});
});
