/**
 * `polarPlane`: rings, spokes, the radial axis and azimuth labels; the polar
 * coordinate system it publishes (one data unit per scene unit when `size`
 * is twice `maxRadius`);
 * and `piMultipleLabel`.
 */

import { describe, expect, it } from "vitest";
import { defineComposite } from "../scene/composite.js";
import { circle } from "../shapes/circle.js";
import { requireCoords } from "./coords.js";
import type { PolarCoordinateSystem } from "./polar-plane.js";
import { piMultipleLabel, polarCoordsOf, polarPlane } from "./polar-plane.js";
import { mount } from "./test-scene.js";

describe("piMultipleLabel", () => {
	it("reduces the fraction and keeps the sign in front", () => {
		expect(piMultipleLabel(0, 12)).toBe("0");
		expect(piMultipleLabel(6, 12)).toBe("π/2");
		expect(piMultipleLabel(18, 12)).toBe("3π/2");
		expect(piMultipleLabel(12, 12)).toBe("π");
		expect(piMultipleLabel(24, 12)).toBe("2π");
		expect(piMultipleLabel(-2, 12)).toBe("-π/6");
		expect(piMultipleLabel(2, -12)).toBe("-π/6");
		expect(piMultipleLabel(1, 0)).toBe("");
		expect(piMultipleLabel(Number.NaN, 2)).toBe("");
	});
});

describe("polarPlane structure", () => {
	it("is rings, spokes, the radial axis, the azimuth labels, then the children", () => {
		const child = circle.create({ radius: 0.1 });
		const node = polarPlane.create({
			size: 4,
			maxRadius: 2,
			radiusStep: 1,
			azimuthDivisions: 4,
			azimuthUnits: "radians",
			children: [child],
		});
		const scene = mount(node);
		expect(node.children.map((c) => c.type)).toEqual([
			"Circle",
			"Circle",
			"Line",
			"Line",
			"Line",
			"Line",
			"NumberLine",
			"Label",
			"Label",
			"Label",
			"Label",
			"Circle",
		]);
		expect(scene.texts().map((t) => t.text)).toEqual(["0", "π/2", "π", "3π/2"]);
		// Rings and spokes at the grid's paint layer.
		expect(scene.shapes().filter((s) => s.zIndex === -1)).toHaveLength(6);
	});

	it("writes degrees, and leaves the axis out with radialAxis: false", () => {
		const node = polarPlane.create({
			size: 4,
			azimuthDivisions: 4,
			azimuthUnits: "degrees",
			radialAxis: false,
		});
		const scene = mount(node);
		expect(scene.texts().map((t) => t.text)).toEqual([
			"0°",
			"90°",
			"180°",
			"270°",
		]);
		expect(node.children.some((c) => c.type === "NumberLine")).toBe(false);
	});

	it("places azimuth labels outward along their spokes", () => {
		const scene = mount(
			polarPlane.create({
				size: 4,
				azimuthDivisions: 4,
				azimuthUnits: "degrees",
			}),
		);
		const at = (text: string) => scene.texts().find((t) => t.text === text)?.at;
		expect(at("0°")?.x).toBeGreaterThan(2);
		expect(at("90°")?.y).toBeGreaterThan(2);
		expect(at("180°")?.x).toBeLessThan(-2);
		expect(at("270°")?.y).toBeLessThan(-2);
	});
});

describe("polarPlane coordinates", () => {
	it("maps polar data coordinates to scene units, both ways", () => {
		// size 4, maxRadius 2: one data unit is one scene unit.
		const node = polarPlane.create({
			size: 4,
			maxRadius: 2,
			center: { x: 1, y: 0 },
		});
		const coords = polarCoordsOf(node) as PolarCoordinateSystem;
		const top = coords.polarToPoint(1, Math.PI / 2);
		expect(top.x).toBeCloseTo(1, 9);
		expect(top.y).toBeCloseTo(1, 9);
		const back = coords.pointToPolar({ x: 0, y: 0 });
		expect(back.radius).toBeCloseTo(1, 9);
		expect(back.theta).toBeCloseTo(Math.PI, 9);
		expect(coords.xRange()).toEqual([-2, 2]);
		expect(coords.coordsToPoint(1, 0)).toEqual({ x: 2, y: 0 });
	});

	it("provides the polar system to its children", () => {
		let seen: PolarCoordinateSystem | undefined;
		const reader = defineComposite<object>({
			name: "Reader",
			props: {},
			setup: (ctx) => {
				seen = requireCoords(ctx, "Reader") as PolarCoordinateSystem;
				return [];
			},
		});
		const node = polarPlane.create({
			size: 4,
			maxRadius: 2,
			children: [reader.create()],
		});
		mount(node);
		expect(seen).toBe(polarCoordsOf(node));
		expect(seen?.polarToPoint(2, 0).x).toBeCloseTo(2, 9);
	});

	it("re-publishes and resizes the rings on a maxRadius change", () => {
		const node = polarPlane.create({ size: 4, maxRadius: 2, radiusStep: 1 });
		const scene = mount(node);
		const before = polarCoordsOf(node);
		node.set("maxRadius", 4);
		scene.commit();
		expect(polarCoordsOf(node)).not.toBe(before);
		const rings = node.children.filter((c) => c.type === "Circle");
		expect(rings.map((r) => r.get("radius" as never))).toEqual([
			0.5, 1, 1.5, 2,
		]);
	});
});
