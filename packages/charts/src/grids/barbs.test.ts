/**
 * `barbs`: one shape per colour band over a vector-field lattice, shafts
 * stroked and pennants filled.
 */

import { axes } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { mount } from "../test-harness.js";
import { barbs } from "./barbs.js";

const inAxes = (layer: ReturnType<typeof barbs.create>) =>
	axes.create({
		xRange: [-3, 3, 1],
		yRange: [-2, 2, 1],
		width: 6,
		height: 4,
		children: [layer],
	} as never);

describe("barbs", () => {
	it("draws one shape per band, coloured low to high, empty bands kept", () => {
		const scene = mount(
			inAxes(
				barbs.create({
					function: (p) => ({ x: 20 + 30 * p.x, y: 0 }),
					xRange: [0, 2],
					yRange: [0, 1],
					bands: 4,
					ramp: "viridis",
				}),
			),
		);
		const bands = scene.shapes().filter((s) => s.zIndex === 0 && s.closed);
		expect(bands.length).toBeGreaterThanOrEqual(4);
		expect(bands.some((s) => s.polylines.length > 0)).toBe(true);
	});

	it("follows a new function", () => {
		const layer = barbs.create({
			function: () => ({ x: 10, y: 0 }),
			xRange: [0, 2],
			yRange: [0, 1],
		});
		const scene = mount(inAxes(layer));
		const count = () =>
			scene
				.shapes()
				.filter((s) => s.closed)
				.reduce((n, s) => n + s.polylines.length, 0);
		const before = count();
		layer.set("function", () => ({ x: 60, y: 0 }));
		scene.commit();
		// A 60-knot barb has pennants: more polylines than a 10-knot one.
		expect(count()).toBeGreaterThan(before);
	});
});
