import { describe, expect, it } from "vitest";
import type { Point } from "../geometry/index.js";
import type { PaintFrame } from "./gradient.js";
import {
	flatColor,
	isGradientSpec,
	linearGradient,
	radialGradient,
	resolvePaint,
	sheen,
} from "./gradient.js";
import type {
	LinearGradientPaint,
	Paint,
	RadialGradientPaint,
} from "./types.js";

/** Narrows a resolved `Paint` to its gradient variant, failing loudly otherwise. */
function asLinear(paint: Paint | null): LinearGradientPaint {
	if (paint && typeof paint === "object" && paint.kind === "linear")
		return paint;
	throw new Error(`expected a linear paint, got ${JSON.stringify(paint)}`);
}

function asRadial(paint: Paint | null): RadialGradientPaint {
	if (paint && typeof paint === "object" && paint.kind === "radial")
		return paint;
	throw new Error(`expected a radial paint, got ${JSON.stringify(paint)}`);
}

describe("isGradientSpec", () => {
	it("a plain colour string is not a gradient spec", () => {
		expect(isGradientSpec("#ff0000")).toBe(false);
	});

	it("undefined is not a gradient spec", () => {
		expect(isGradientSpec(undefined)).toBe(false);
	});

	it("a linearGradient/radialGradient/sheen result is a gradient spec", () => {
		expect(isGradientSpec(linearGradient(["red", "blue"]))).toBe(true);
		expect(isGradientSpec(radialGradient(["red", "blue"]))).toBe(true);
		expect(isGradientSpec(sheen("red"))).toBe(true);
	});
});

describe("flatColor", () => {
	it("passes a plain colour through", () => {
		expect(flatColor("#00ff00", "#000000")).toBe("#00ff00");
	});

	it("falls back for a gradient rather than guessing its first stop", () => {
		expect(flatColor(linearGradient(["red", "blue"]), "#123456")).toBe(
			"#123456",
		);
	});

	it("falls back for undefined", () => {
		expect(flatColor(undefined, "#123456")).toBe("#123456");
	});
});

describe("linearGradient", () => {
	it("defaults to left-to-right across the bbox, evenly spaced stops", () => {
		const g = linearGradient(["red", "green", "blue"]);
		expect(g.type).toBe("linear");
		expect(g.units).toBe("bbox");
		expect(g.from).toEqual({ x: 0, y: 0.5 });
		expect(g.to).toEqual({ x: 1, y: 0.5 });
		expect(g.stops).toEqual([
			{ offset: 0, color: "red" },
			{ offset: 0.5, color: "green" },
			{ offset: 1, color: "blue" },
		]);
	});

	it("a single colour collapses to one stop at offset 0", () => {
		const g = linearGradient(["red"]);
		expect(g.stops).toEqual([{ offset: 0, color: "red" }]);
	});

	it("zero colours gives no stops", () => {
		const g = linearGradient([]);
		expect(g.stops).toEqual([]);
	});

	it("explicit offsets override even spacing", () => {
		const g = linearGradient(["red", "blue"], { offsets: [0.1, 0.9] });
		expect(g.stops.map((s) => s.offset)).toEqual([0.1, 0.9]);
	});

	it("an angle of 0 is equivalent to the default left-to-right axis", () => {
		const g = linearGradient(["red", "blue"], { angle: 0 });
		expect(g.from.x).toBeCloseTo(0);
		expect(g.from.y).toBeCloseTo(0.5);
		expect(g.to.x).toBeCloseTo(1);
		expect(g.to.y).toBeCloseTo(0.5);
	});

	it("an angle of pi/2 runs bottom to top", () => {
		const g = linearGradient(["red", "blue"], { angle: Math.PI / 2 });
		expect(g.from.x).toBeCloseTo(0.5);
		expect(g.from.y).toBeCloseTo(0);
		expect(g.to.x).toBeCloseTo(0.5);
		expect(g.to.y).toBeCloseTo(1);
	});

	it("explicit from/to override angle and defaults", () => {
		const g = linearGradient(["red", "blue"], {
			from: { x: 0.2, y: 0.2 },
			to: { x: 0.8, y: 0.9 },
		});
		expect(g.from).toEqual({ x: 0.2, y: 0.2 });
		expect(g.to).toEqual({ x: 0.8, y: 0.9 });
	});

	it("units: scene opts out of bbox-relative placement", () => {
		const g = linearGradient(["red", "blue"], { units: "scene" });
		expect(g.units).toBe("scene");
	});
});

describe("radialGradient", () => {
	it("defaults to a concentric gradient centred on the box, radius to the rim", () => {
		const g = radialGradient(["red", "blue"]);
		expect(g.type).toBe("radial");
		expect(g.from).toEqual({ x: 0.5, y: 0.5 });
		expect(g.to).toEqual({ x: 0.5, y: 0.5 });
		expect(g.fromRadius).toBe(0);
		expect(g.toRadius).toBe(0.5);
	});

	it("to defaults to from when only from is given", () => {
		const g = radialGradient(["red", "blue"], { from: { x: 0.3, y: 0.7 } });
		expect(g.to).toEqual({ x: 0.3, y: 0.7 });
	});

	it("respects explicit radii and offsets", () => {
		const g = radialGradient(["red", "blue"], {
			fromRadius: 0.1,
			toRadius: 0.9,
		});
		expect(g.fromRadius).toBe(0.1);
		expect(g.toRadius).toBe(0.9);
	});
});

describe("sheen", () => {
	it("produces a linear gradient with 5 stops around `at`", () => {
		const g = sheen("#808080", { at: 0.5, width: 0.2 });
		expect(g.type).toBe("linear");
		expect(g.stops).toHaveLength(5);
		expect(g.stops.map((s) => s.offset)).toEqual([0, 0.3, 0.5, 0.7, 1]);
		expect(g.stops[0].color).toBe("#808080");
		expect(g.stops[4].color).toBe("#808080");
	});
});

/** A frame whose shape sits under a uniform scale and a y flip (so tests can see both applied). */
function frame(box: PaintFrame["box"], scale = 1): PaintFrame {
	return {
		box,
		toScene: (at: Point) => ({ x: at.x * scale, y: -at.y * scale }),
		sceneUnitsPerUnit: scale,
	};
}

describe("resolvePaint", () => {
	it("undefined resolves to null", () => {
		expect(
			resolvePaint(undefined, frame({ minX: 0, minY: 0, maxX: 1, maxY: 1 })),
		).toBeNull();
	});

	it("a plain colour string resolves to itself", () => {
		expect(
			resolvePaint("#ff0000", frame({ minX: 0, minY: 0, maxX: 1, maxY: 1 })),
		).toBe("#ff0000");
	});

	it("resolves a linear bbox gradient against the shape's own box", () => {
		const g = linearGradient(["red", "blue"]); // from (0,0.5) to (1,0.5)
		const f = frame({ minX: 0, minY: 0, maxX: 2, maxY: 4 });
		const resolved = asLinear(resolvePaint(g, f));
		// from: box.min + 0*width, box.min + 0.5*height = (0, 2) -> toScene(0,2)=(0,-2)
		expect(resolved.from).toEqual({ x: 0, y: -2 });
		// to: (2, 2) -> toScene = (2, -2)
		expect(resolved.to).toEqual({ x: 2, y: -2 });
		expect(resolved.stops).toEqual(g.stops);
	});

	it("resolves a radial bbox gradient's radius against the box's long side", () => {
		const g = radialGradient(["red", "blue"]); // toRadius 0.5 fraction
		const f = frame({ minX: 0, minY: 0, maxX: 4, maxY: 2 }, 3); // long side = 4, scale=3
		const resolved = asRadial(resolvePaint(g, f));
		expect(resolved.toRadius).toBeCloseTo(0.5 * 4 * 3);
		expect(resolved.fromRadius).toBe(0);
	});

	it("units: scene ignores the box and the shape's matrix — the points are already scene units", () => {
		const g = linearGradient(["red", "blue"], {
			units: "scene",
			from: { x: 1, y: 2 },
			to: { x: 3, y: 4 },
		});
		const f = frame({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 5);
		const resolved = asLinear(resolvePaint(g, f));
		expect(resolved.from).toEqual({ x: 1, y: 2 });
		expect(resolved.to).toEqual({ x: 3, y: 4 });
	});

	it("units: scene radial radius is taken as given, not scaled by the shape's matrix", () => {
		const g = radialGradient(["red", "blue"], {
			units: "scene",
			fromRadius: 0.5,
			toRadius: 2,
		});
		const f = frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 3);
		const resolved = asRadial(resolvePaint(g, f));
		expect(resolved.toRadius).toBeCloseTo(2);
		expect(resolved.fromRadius).toBeCloseTo(0.5);
	});

	it("a degenerate zero-area bbox gradient collapses to its first stop", () => {
		const g = linearGradient(["red", "blue"]);
		const f = frame({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
		expect(resolvePaint(g, f)).toBe("red");
	});

	it("a degenerate box with zero-stop gradient falls back to 'none'", () => {
		const g = linearGradient([]);
		const f = frame({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
		expect(resolvePaint(g, f)).toBe("none");
	});

	it("a degenerate box does not collapse a units:scene gradient (only bbox is affected)", () => {
		const g = linearGradient(["red", "blue"], { units: "scene" });
		const f = frame({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
		const resolved = resolvePaint(g, f);
		expect(resolved).not.toBe("red");
		expect(typeof resolved).toBe("object");
	});

	it("a box with zero width but nonzero height is not treated as degenerate", () => {
		const g = linearGradient(["red", "blue"]);
		const f = frame({ minX: 0, minY: 0, maxX: 0, maxY: 4 });
		const resolved = resolvePaint(g, f);
		expect(resolved).not.toBe("red");
		expect(typeof resolved).toBe("object");
	});

	it("a zero-width box (vertical line) gets a non-collapsed horizontal span", () => {
		const g = linearGradient(["red", "blue"]); // left to right
		const f = frame({ minX: 1, minY: 0, maxX: 1, maxY: 4 });
		const resolved = asLinear(resolvePaint(g, f));
		expect(resolved.from.x).not.toBe(resolved.to.x);
		// The flat axis is centred on the shape, so it sits mid-gradient.
		expect((resolved.from.x + resolved.to.x) / 2).toBeCloseTo(1);
	});

	it("a zero-height box (horizontal line) keeps its gradient along the length", () => {
		const g = linearGradient(["red", "blue"], {
			from: { x: 0, y: 0 },
			to: { x: 0, y: 1 },
		});
		const f = frame({ minX: 0, minY: 2, maxX: 4, maxY: 2 });
		const resolved = asLinear(resolvePaint(g, f));
		expect(resolved.from.y).not.toBe(resolved.to.y);
	});
});
