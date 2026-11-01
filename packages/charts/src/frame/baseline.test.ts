/**
 * Every baseline-having chart agrees on the default: the axis crossing
 * (`coords.crossing().y`), not a hard-coded 0. Tested with a `stackPlot` under a
 * hand-made coordinate system.
 */

import type { CoordinateSystem, SceneNode } from "@sophistry/core";
import { coordsContext, defineComposite, Invalidate } from "@sophistry/core";
import { describe, expect, it } from "vitest";
import { stackPlot } from "../curves/stack-plot.js";
import { identity } from "../data/channels.js";
import { markItems, mount } from "../test-harness.js";

// y range [2, 9] does not contain 0, so the crossing is pinned to 2.
const coords: CoordinateSystem = {
	coordsToPoint: (x, y = 0) => ({ x, y }),
	pointToCoords: (p) => p,
	xRange: () => [0, 4],
	yRange: () => [2, 9],
	area: () => ({ minX: 0, minY: 2, maxX: 4, maxY: 9 }),
	crossing: () => ({ x: 0, y: 2 }),
};

/** Provides `coords` to its children, as an `axes` would. */
const host = defineComposite<{ children?: readonly SceneNode[] }>({
	name: "CoordsHost",
	props: { children: { kind: "children", invalidates: Invalidate.NONE } },
	setup: (ctx) => {
		ctx.provide(coordsContext, coords);
		return ctx.children;
	},
	update: (_changed, ctx) => ctx.children,
});

/** The lowest point the layer draws, in scene units. */
function lowestY(layer: SceneNode): number {
	const view = mount(host.create({ children: [layer] }));
	const ys = view
		.marks()
		.flatMap((spec) => markItems(spec))
		.flatMap((item) => item.polylines.flat().map((p) => p.y));
	if (ys.length === 0) throw new Error("expected a drawn outline");
	return Math.min(...ys);
}

describe("stackPlot baseline", () => {
	const data = [1, 2, 3];

	it("defaults to the axis crossing, like stem", () => {
		expect(lowestY(stackPlot.create({ data, y: [identity] }))).toBeCloseTo(2);
	});

	it("an explicit baseline wins", () => {
		expect(
			lowestY(stackPlot.create({ data, y: [identity], baseline: 0 })),
		).toBeCloseTo(0);
	});
});
