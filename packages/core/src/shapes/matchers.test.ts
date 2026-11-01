/**
 * Shape matchers and `brace`. These check the
 * spec against `bake()` and the node-following design (a matcher whose
 * `target` is a node re-reads its bounds when the node changes).
 */

import { describe, expect, it } from "vitest";
import { polylineToCurvePath, rectPolyline } from "../geometry/index.js";
import { track } from "../reactive/index.js";
import { LEFT } from "../spec/layout.js";
import { brace, braceOutline } from "./brace.js";
import { circle } from "./circle.js";
import {
	backgroundRectangle,
	cross,
	surroundingRectangle,
	underline,
} from "./matchers.js";
import { openRing } from "./rect.js";
import {
	darkTheme,
	expectBaked,
	manualGraph,
	shapeSpec,
	shapeSpecsOf,
	specsOf,
	textSpecsOf,
} from "./test-graph.js";

const box = { minX: -1.5, minY: -0.5, maxX: 1.5, maxY: 0.5 };

describe("surroundingRectangle", () => {
	it("matches bake() of the padded box", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			surroundingRectangle.create({ target: box, cornerRadius: 0.1 }),
		);
		commit();
		expectBaked(node, {
			closed: true,
			curvePaths: [
				polylineToCurvePath(
					openRing(rectPolyline(-1.75, -0.75, 3.5, 1.5, 0.1)),
					true,
				),
			],
		});
	});

	it("draws nothing without a target", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(surroundingRectangle.create({ target: null }));
		commit();
		expect(shapeSpec(node).polylines).toEqual([]);
	});

	it("follows a node target when it moves, and lets go when retargeted", () => {
		const { graph, commit } = manualGraph();
		const target = graph.root.add(circle.create({ radius: 1 }));
		const node = graph.root.add(
			surroundingRectangle.create({ target, padding: 0 }),
		);
		commit();
		expect(node.bounds()?.minX).toBeCloseTo(-1, 6);
		target.set("center", { x: 3, y: 0 });
		commit();
		expect(node.bounds()?.minX).toBeCloseTo(2, 6);
		node.set("target", box);
		commit();
		const before = shapeSpec(node);
		target.set("radius", 2);
		commit();
		// No longer following: the old target's change does nothing.
		expect(shapeSpec(node)).toBe(before);
	});

	it("draws nothing once its node target is disposed", () => {
		const { graph, commit } = manualGraph();
		const target = graph.root.add(circle.create({ radius: 1 }));
		const node = graph.root.add(surroundingRectangle.create({ target }));
		commit();
		target.dispose();
		commit();
		expect(shapeSpec(node).polylines).toEqual([]);
	});

	it("follows a bound box", () => {
		const { graph, commit } = manualGraph();
		const bounds = track(box);
		const node = graph.root.add(
			surroundingRectangle.create({ target: bounds, padding: 0 }),
		);
		commit();
		bounds.set({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
		commit();
		expect(node.bounds()?.maxX).toBeCloseTo(1, 6);
	});
});

describe("backgroundRectangle", () => {
	it("is a filled backdrop behind everything, flush with its target", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(backgroundRectangle.create({ target: box }));
		commit();
		const spec = shapeSpec(node);
		expect(spec.zIndex).toBe(-1);
		expect(spec.style.fill).toBe(darkTheme.palette.background);
		expect(spec.style.fillOpacity).toBe(0.75);
		expect(spec.style.stroke).toBe("none");
		expect(spec.style.strokeWidth).toBe(0);
		expect(node.bounds()).toEqual(box);
		node.set("zIndex", 4);
		commit();
		expect(shapeSpec(node).zIndex).toBe(4);
		node.set("zIndex", undefined);
		commit();
		expect(shapeSpec(node).zIndex).toBe(-1);
	});

	it("takes color for its fill", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			backgroundRectangle.create({ target: box, color: "#336699" }),
		);
		commit();
		expect(shapeSpec(node).style.fill).toBe("#336699");
	});
});

describe("cross and underline", () => {
	it("cross is two diagonals across the unpadded box", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(cross.create({ target: box }));
		commit();
		expectBaked(node, {
			closed: false,
			curvePaths: [
				polylineToCurvePath(
					[
						{ x: -1.5, y: 0.5 },
						{ x: 1.5, y: -0.5 },
					],
					false,
				),
				polylineToCurvePath(
					[
						{ x: -1.5, y: -0.5 },
						{ x: 1.5, y: 0.5 },
					],
					false,
				),
			],
		});
	});

	it("underline runs the full width, gap below", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(underline.create({ target: box, gap: 0.1 }));
		commit();
		expectBaked(node, {
			closed: false,
			curvePaths: [
				polylineToCurvePath(
					[
						{ x: -1.5, y: -0.6 },
						{ x: 1.5, y: -0.6 },
					],
					false,
				),
			],
		});
	});
});

describe("brace", () => {
	it("is a filled shape below its bounds, with no stroke", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(brace.create({ target: box, fill: "#abcdef" }));
		commit();
		const shapes = shapeSpecsOf(node);
		expect(shapes).toHaveLength(1);
		const [outline] = shapes;
		if (!outline) throw new Error("no brace");
		expect(outline.style.fill).toBe("#abcdef");
		expect(outline.style.stroke).toBe("none");
		const points = outline.polylines.flat();
		expect(Math.max(...points.map((point) => point.y))).toBeLessThan(box.minY);
	});

	it("labels its tip, beyond the brace on the side it points", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			brace.create({ target: box, direction: LEFT, label: "h" }),
		);
		commit();
		const [text] = textSpecsOf(node);
		expect(text?.text).toBe("h");
		const points = shapeSpecsOf(node)[0]?.polylines.flat() ?? [];
		const braceLeft = Math.min(...points.map((point) => point.x));
		if (!text) throw new Error("no label");
		expect(text.at.x).toBeLessThan(braceLeft);
		// The label takes the brace's fill (the foreground by default).
		expect(text.style.fill).toBe(darkTheme.palette.foreground);
	});

	it("takes its span from two points", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			brace.create({ from: { x: 0, y: 0 }, to: { x: 0, y: 2 } }),
		);
		commit();
		const points = shapeSpecsOf(node)[0]?.polylines.flat() ?? [];
		// Bottom to top points right.
		expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(0.25, 2);
	});

	it("pushes a point-to-point brace out by gap", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			brace.create({ from: { x: 0, y: 0 }, to: { x: 0, y: 2 }, gap: 0.5 }),
		);
		commit();
		const points = shapeSpecsOf(node)[0]?.polylines.flat() ?? [];
		expect(Math.min(...points.map((point) => point.x))).toBeGreaterThan(0.45);
		expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(0.75, 2);
	});

	it("draws nothing with neither bounds nor ends", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(brace.create({ label: "x" }));
		commit();
		expect(textSpecsOf(node)).toHaveLength(0);
	});

	it("adds and drops the label as `label` comes and goes, and follows the outline props", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(brace.create({ target: box }));
		commit();
		expect(textSpecsOf(node)).toHaveLength(0);
		node.set("label", "w");
		commit();
		expect(textSpecsOf(node)).toHaveLength(1);
		node.set("progress", 0.5);
		commit();
		expect(shapeSpecsOf(node)[0]?.progress).toBe(0.5);
		expect(textSpecsOf(node)[0]?.progress).toBe(0.5);
		node.set("label", undefined);
		commit();
		expect(textSpecsOf(node)).toHaveLength(0);
		expect(specsOf(node)).toHaveLength(1);
		expect(braceOutline.name).toBe("BraceOutline");
	});
});
