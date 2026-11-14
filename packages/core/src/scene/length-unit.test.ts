/**
 * `lengthUnit`: a group or text whose sizes are design pixels. The scene
 * fixes design pixels per unit when it is made; a px group scales its
 * children by it while its own position stays in its parent's units, and
 * theme defaults keep their scene size inside it.
 */

import { describe, expect, it } from "vitest";
import { circle } from "../shapes/index.js";
import type { ShapeSpec, TextSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";
import { pixelsPerUnitContext, themeContext } from "./context.js";
import { SceneGraph } from "./graph.js";
import { group } from "./group.js";
import { createScene } from "./scene.js";
import { text } from "./text.js";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	graph.root.provide(pixelsPerUnitContext, 100);
	return { graph, commit: () => graph.commit() };
}

describe("lengthUnit", () => {
	it("is 1920 design pixels across a scene, fixed when it is made", () => {
		const scene = createScene({ headless: true, units: 8 });
		const node = scene.root.add(group.create({}));
		expect(node.context(pixelsPerUnitContext)).toBe(240);
		scene.dispose();
	});

	it("scales a px group's children but not its own position", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 50, center: { x: 100, y: 0 } });
		graph.root.add(group.create({ x: 2, lengthUnit: "px", children: [dot] }));
		commit();
		const spec = dot.spec as ShapeSpec;
		const box = dot.bounds();
		expect(box?.minX).toBeCloseTo(2.5);
		expect(box?.maxX).toBeCloseTo(3.5);
		expect(spec).not.toBeNull();
	});

	it("keeps theme defaults at their scene size, and scales authored widths", () => {
		const { graph, commit } = manualGraph();
		const plain = circle.create({ radius: 50 });
		const authored = circle.create({ radius: 50, strokeWidth: 4 });
		graph.root.add(
			group.create({ lengthUnit: "px", children: [plain, authored] }),
		);
		commit();
		// Specs carry stroke widths in scene units.
		const width = (node: typeof plain) =>
			(node.spec as ShapeSpec).style.strokeWidth;
		expect(width(plain)).toBeCloseTo(theme.defaults.strokeWidth);
		expect(width(authored)).toBeCloseTo(0.04);
	});

	it("nests: a scene group inside a px group is back in scene units", () => {
		const { graph, commit } = manualGraph();
		const dot = circle.create({ radius: 1 });
		graph.root.add(
			group.create({
				lengthUnit: "px",
				children: [
					group.create({ x: 100, lengthUnit: "scene", children: [dot] }),
				],
			}),
		);
		commit();
		const box = dot.bounds();
		expect(box?.minX).toBeCloseTo(0);
		expect(box?.maxX).toBeCloseTo(2);
	});

	it("sizes text in pixels, and its default font in scene units", () => {
		const { graph, commit } = manualGraph();
		const sized = text.create({ text: "a", fontSize: 48, lengthUnit: "px" });
		const plain = text.create({ text: "a", lengthUnit: "px" });
		const inside = text.create({ text: "a", fontSize: 48 });
		graph.root.add(sized);
		graph.root.add(plain);
		graph.root.add(group.create({ lengthUnit: "px", children: [inside] }));
		commit();
		expect((sized.spec as TextSpec).style.fontSize).toBeCloseTo(0.48);
		expect((plain.spec as TextSpec).style.fontSize).toBeCloseTo(
			theme.defaults.fontSize,
		);
		expect((inside.spec as TextSpec).style.fontSize).toBeCloseTo(0.48);
	});

	it("wraps px text at a px width", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			text.create({
				text: "one two three",
				width: 120,
				lengthUnit: "px",
				fontSize: 30,
			}),
		);
		commit();
		expect((node.spec as TextSpec).box?.maxX).toBeCloseTo(0.6);
	});
});
