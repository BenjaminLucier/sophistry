/**
 * `axes`: node structure, an axis's `position` moving the drawn line without
 * moving the crossing, the
 * shared origin, `{ from, to, t }` ranges, and range changes re-providing the
 * coordinate system.
 */

import { describe, expect, it } from "vitest";
import { defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import { circle } from "../shapes/circle.js";
import type { AxesProps } from "./axes.js";
import { axes } from "./axes.js";
import type { CoordinateSystem } from "./coords.js";
import {
	axisPositionValue,
	coordsContext,
	coordsOf,
	requireCoords,
} from "./coords.js";
import { mount } from "./test-scene.js";

function plot(props: Omit<AxesProps, "width" | "height">) {
	const node = axes.create({ width: 8, height: 4, ...props });
	const scene = mount(node);
	return { node, scene, coords: coordsOf(node) as CoordinateSystem };
}

describe("axes descriptor and structure", () => {
	it("is a named composite taking children", () => {
		expect(axes.name).toBe("Axes");
		expect(axes.kind).toBe("composite");
		expect(axes.container).toBe(true);
		expect(axes.descriptor.xRange.invalidates).toBe(Invalidate.UPDATE);
		expect(axes.descriptor.progress.invalidates).toBe(Invalidate.NONE);
	});

	it("is two number lines, the end labels, then the children", () => {
		const child = circle.create({ radius: 0.1 });
		const node = axes.create({
			xRange: [-4, 4],
			yRange: [-2, 2],
			width: 8,
			height: 4,
			xLabel: "x",
			yLabel: "y",
			children: [child],
		});
		const scene = mount(node);
		expect(node.children.map((c) => c.type)).toEqual([
			"NumberLine",
			"NumberLine",
			"Label",
			"Label",
			"Circle",
		]);
		node.set("xLabel", undefined);
		node.set("yLabel", undefined);
		scene.commit();
		expect(node.children.map((c) => c.type)).toEqual([
			"NumberLine",
			"NumberLine",
			"Circle",
		]);
	});

	it("places the end labels past the far ends", () => {
		const { scene, coords } = plot({
			xRange: [-4, 4],
			yRange: [-2, 2],
			xLabel: "x",
			yLabel: "y",
		});
		const [x] = scene.texts().filter((t) => t.text === "x");
		const [y] = scene.texts().filter((t) => t.text === "y");
		expect(x?.at.x).toBeGreaterThan(coords.area().maxX);
		expect(x?.at.y).toBeCloseTo(0, 9);
		expect(y?.at.y).toBeGreaterThan(coords.area().maxY);
		expect(y?.at.x).toBeCloseTo(0, 9);
	});
});

describe("axisPositionValue", () => {
	it("resolves named and numeric positions against the other range", () => {
		expect(axisPositionValue(undefined, [-2, 4])).toBe(0);
		expect(axisPositionValue("zero", [3, 8])).toBe(3);
		expect(axisPositionValue("edge", [-2, 4])).toBe(-2);
		expect(axisPositionValue("bottom", [-2, 4])).toBe(-2);
		expect(axisPositionValue("top", [-2, 4])).toBe(4);
		expect(axisPositionValue("left", [5, 1])).toBe(5);
		expect(axisPositionValue("right", [5, 1])).toBe(1);
		expect(axisPositionValue(1.5, [-2, 4])).toBe(1.5);
		expect(axisPositionValue(99, [-2, 4])).toBe(4);
	});
});

describe("axes position", () => {
	it('"edge" draws both lines along the bottom and left, leaving crossing() at the origin', () => {
		const { scene, coords } = plot({
			xRange: [-4, 4],
			yRange: [-2, 2],
			axis: { position: "edge" },
		});
		const box = coords.area();
		const lines = scene.segments();
		expect(
			lines.some(
				(l) => l.a.y === box.minY && l.b.y === box.minY && l.b.x - l.a.x > 7.9,
			),
		).toBe(true);
		expect(
			lines.some(
				(l) => l.a.x === box.minX && l.b.x === box.minX && l.b.y - l.a.y > 3.9,
			),
		).toBe(true);
		expect(coords.crossing()).toEqual({ x: 0, y: 0 });
		// The axes don't meet at the origin, so both write a "0".
		expect(scene.texts().filter((t) => t.text === "0")).toHaveLength(2);
	});

	it('"right" writes the y numbers to the right of the line', () => {
		const { scene, coords } = plot({
			xRange: [-4, 4],
			yRange: [-20, 20, 10],
			yAxis: { position: "right" },
		});
		const [ten] = scene.texts().filter((t) => t.text === "10");
		expect(ten?.at.x).toBeGreaterThan(coords.area().maxX);
	});

	it("drops the y axis's 0 where the x axis writes one", () => {
		const { scene } = plot({ xRange: [-4, 4], yRange: [0, 2] });
		expect(scene.texts().filter((t) => t.text === "0")).toHaveLength(1);
	});

	it("writes the origin's 0 on the y axis when the y line runs through x's", () => {
		// The y axis runs on below 0, through where x's "0" would go; nothing
		// runs left of the origin, so y writes it there.
		const { scene, coords } = plot({ xRange: [0, 4], yRange: [-2, 2] });
		const zeros = scene.texts().filter((t) => t.text === "0");
		expect(zeros).toHaveLength(1);
		expect(zeros[0].at.x).toBeLessThan(coords.coordsToPoint(0, 0).x);
	});

	it("writes no 0 at all where both lines run through the origin", () => {
		const { scene } = plot({ xRange: [-4, 4], yRange: [-2, 2] });
		expect(scene.texts().filter((t) => t.text === "0")).toHaveLength(0);
	});
});

describe("range transitions on axes", () => {
	it("maps through the blended range", () => {
		const { coords } = plot({
			xRange: { from: [0, 10], to: [0, 20], t: 0.5 },
			yRange: [0, 1],
		});
		expect(coords.xRange()).toEqual([0, 15]);
		expect(coords.coordsToPoint(15, 0).x).toBeCloseTo(coords.area().maxX);
	});
});

describe("axes coordinate system", () => {
	it("re-provides a new system on a range change and moves dependents", () => {
		const seen: CoordinateSystem[] = [];
		const marker = defineComposite<object>({
			name: "Marker",
			props: {},
			setup: (ctx) => {
				const coords = requireCoords(ctx, "Marker");
				seen.push(coords);
				return [
					circle.create({ radius: 0.1, center: coords.coordsToPoint(1, 1) }),
				];
			},
			update: (changed, ctx) => {
				if (!changed.has(coordsContext)) return undefined;
				const coords = requireCoords(ctx, "Marker");
				seen.push(coords);
				ctx.node.children[0]?.set(
					"center" as never,
					coords.coordsToPoint(1, 1) as never,
				);
				return undefined;
			},
		});
		const dependent = marker.create();
		const node = axes.create({
			xRange: [-4, 4],
			yRange: [-2, 2],
			width: 8,
			height: 4,
			children: [dependent],
		});
		const scene = mount(node);
		const before = coordsOf(node);
		expect(scene.shapes().some((s) => s.zIndex === 0)).toBe(true);
		expect(dependent.children[0]?.get("center" as never)).toEqual({
			x: 1,
			y: 1,
		});
		// A style change keeps the system.
		node.set("axis", { stroke: "#f00" });
		scene.commit();
		expect(coordsOf(node)).toBe(before);
		expect(seen).toHaveLength(1);
		node.set("xRange", [-8, 8]);
		scene.commit();
		expect(coordsOf(node)).not.toBe(before);
		expect(seen).toHaveLength(2);
		expect(dependent.children[0]?.get("center" as never)).toEqual({
			x: 0.5,
			y: 1,
		});
	});

	it("hands axis options to the lines, and unsets removed ones", () => {
		const node = axes.create({
			xRange: [-4, 4],
			yRange: [-2, 2],
			width: 8,
			height: 4,
			xAxis: { stroke: "#f00" },
		});
		const scene = mount(node);
		const [xLine] = node.children;
		expect(xLine?.get("stroke" as never)).toBe("#f00");
		node.set("xAxis", {});
		scene.commit();
		expect(xLine?.get("stroke" as never)).toBeUndefined();
	});
});
