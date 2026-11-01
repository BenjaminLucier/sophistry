import { describe, expect, it } from "vitest";
import { lerpMatrix } from "../geometry/transform.js";
import type { InterpolatorName } from "./interpolators.js";
import {
	auto,
	cssColorInterpolator,
	curvePathInterpolator,
	detectInterpolator,
	interpolators,
	matrixInterpolator,
	point3Interpolator,
	pointInterpolator,
	polylineInterpolator,
	resolveInterpolator,
} from "./interpolators.js";

describe("resolveInterpolator", () => {
	it("resolves a name to the registered interpolator", () => {
		expect(resolveInterpolator("point")).toBe(interpolators.point);
		expect(resolveInterpolator("number")).toBe(interpolators.number);
	});

	it("passes a function through unchanged", () => {
		const custom = (a: number, b: number) => (t: number) => a + (b - a) * t;
		expect(resolveInterpolator(custom)).toBe(custom);
	});

	it("returns undefined for undefined, not a fallback", () => {
		expect(resolveInterpolator(undefined)).toBeUndefined();
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() =>
			resolveInterpolator("nonexistent" as InterpolatorName),
		).toThrow(/Unknown interpolator "nonexistent"/);
	});

	it("a custom interpolator is passed as a value, unchanged", () => {
		const mine = (a: string, b: string) => (t: number) => (t < 1 ? a : b);
		expect(resolveInterpolator(mine)).toBe(mine);
	});
});

describe("pointInterpolator", () => {
	it("lerps x/y independently", () => {
		const f = pointInterpolator({ x: 0, y: 0 }, { x: 10, y: 20 });
		expect(f(0.5)).toEqual({ x: 5, y: 10 });
	});

	it("returns a fresh object every sample", () => {
		const f = pointInterpolator({ x: 0, y: 0 }, { x: 10, y: 10 });
		expect(f(0.5)).not.toBe(f(0.5));
	});
});

describe("point3Interpolator", () => {
	it("lerps x/y/z independently", () => {
		const f = point3Interpolator({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 });
		expect(f(0.5)).toEqual({ x: 5, y: 10, z: 15 });
	});
});

describe("matrixInterpolator", () => {
	it("lerps every component independently", () => {
		const f = matrixInterpolator(
			{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			{ a: 3, b: 2, c: 2, d: 3, e: 10, f: 20 },
		);
		expect(f(0.5)).toEqual({ a: 2, b: 1, c: 1, d: 2, e: 5, f: 10 });
	});

	it("is exactly geometry/transform.ts's lerpMatrix, not a second implementation", () => {
		// Consolidation guard: this is a thin wrapper over `lerpMatrix`, not a
		// hand-copied duplicate of it (six `lerp(from.x, to.x, t)` fields), so
		// its output has to be bit-identical to calling
		// `lerpMatrix` directly for any input, not just agree on one example.
		const from = { a: 1, b: -2, c: 0.5, d: 4, e: -10, f: 3 };
		const to = { a: -3, b: 6, c: 2, d: -1, e: 8, f: -20 };
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			expect(matrixInterpolator(from, to)(t)).toEqual(lerpMatrix(from, to, t));
		}
	});
});

describe("polylineInterpolator", () => {
	it("lerps matched vertices", () => {
		const a = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		];
		const b = [
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
		];
		const f = polylineInterpolator(a, b);
		expect(f(0.5)).toEqual([
			{ x: 0, y: 5 },
			{ x: 10, y: 5 },
		]);
	});

	it("throws on mismatched vertex counts rather than guessing", () => {
		const a = [{ x: 0, y: 0 }];
		const b = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		];
		expect(() => polylineInterpolator(a, b)).toThrow(/vertex counts differ/);
	});
});

describe("curvePathInterpolator", () => {
	it("lerps control points for matching segment counts", () => {
		const a = {
			start: { x: 0, y: 0 },
			segments: [
				{ c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
			],
			closed: false,
		};
		const b = {
			start: { x: 20, y: 20 },
			segments: [
				{ c1: { x: 20, y: 40 }, c2: { x: 40, y: 40 }, to: { x: 40, y: 20 } },
			],
			closed: false,
		};
		const f = curvePathInterpolator(a, b);
		const mid = f(0.5);
		expect(mid.start).toEqual({ x: 10, y: 10 });
		expect(mid.segments[0].to).toEqual({ x: 25, y: 10 });
	});

	it("throws on mismatched segment counts", () => {
		const a = {
			start: { x: 0, y: 0 },
			segments: [
				{ c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
			],
			closed: false,
		};
		const b = {
			start: { x: 0, y: 0 },
			segments: [
				{ c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
				{ c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 }, to: { x: 2, y: 2 } },
			],
			closed: false,
		};
		expect(() => curvePathInterpolator(a, b)).toThrow(/segment counts differ/);
	});

	it("snaps closed to whichever endpoint t is closer to", () => {
		const seg = { c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 }, to: { x: 1, y: 0 } };
		const a = { start: { x: 0, y: 0 }, segments: [seg], closed: true };
		const b = { start: { x: 0, y: 0 }, segments: [seg], closed: false };
		expect(curvePathInterpolator(a, b)(0).closed).toBe(true);
		expect(curvePathInterpolator(a, b)(0.5).closed).toBe(true);
		expect(curvePathInterpolator(a, b)(1).closed).toBe(false);
	});
});

describe("cssColorInterpolator", () => {
	it("defaults to rgb space", () => {
		const f = cssColorInterpolator();
		expect(f("#000000", "#ffffff")(0)).toBe("rgba(0, 0, 0, 1)");
		expect(f("#000000", "#ffffff")(1)).toBe("rgba(255, 255, 255, 1)");
	});

	it("rgb and oklch agree at the endpoints but differ mid-ramp", () => {
		const rgb = cssColorInterpolator("rgb")("blue", "yellow")(0.5);
		const oklch = cssColorInterpolator("oklch")("blue", "yellow")(0.5);
		expect(rgb).not.toBe(oklch);
	});
});

describe("detectInterpolator", () => {
	it("detects numbers", () => {
		expect(detectInterpolator(0, 10)).toBeDefined();
	});

	it("detects Point (x/y, no z)", () => {
		const f = detectInterpolator({ x: 0, y: 0 }, { x: 10, y: 10 });
		expect(f?.({ x: 0, y: 0 }, { x: 10, y: 10 })(0.5)).toEqual({ x: 5, y: 5 });
	});

	it("detects Point3 (x/y/z)", () => {
		const f = detectInterpolator({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
		expect(f?.({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })(0.5)).toEqual({
			x: 5,
			y: 5,
			z: 5,
		});
	});

	it("detects Matrix", () => {
		const m1 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
		const m2 = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
		expect(detectInterpolator(m1, m2)).toBe(matrixInterpolator);
	});

	it("detects Polyline", () => {
		const p1 = [{ x: 0, y: 0 }];
		const p2 = [{ x: 10, y: 10 }];
		expect(detectInterpolator(p1, p2)).toBe(polylineInterpolator);
	});

	it("does not detect colour strings", () => {
		expect(detectInterpolator("#000000", "#ffffff")).toBeUndefined();
	});

	it("does not detect plain number arrays as a Polyline", () => {
		expect(detectInterpolator([0, 0], [10, 20])).toBeUndefined();
	});
});

describe("auto", () => {
	it("interpolates numbers", () => {
		const f = auto(0, 10);
		expect(f(0.5)).toBeCloseTo(5, 9);
	});

	it("interpolates arrays element-wise via the structural fallback", () => {
		const f = auto([0, 0], [10, 20]);
		expect(f(0.5)).toEqual([5, 10]);
	});

	it("interpolates Point-shaped objects via the registry", () => {
		const f = auto({ x: 0, y: 10 }, { x: 10, y: 0 });
		expect(f(0.5)).toEqual({ x: 5, y: 5 });
	});

	it("interpolates colour strings via the structural fallback, unchanged format", () => {
		const f = auto("#000000", "#ffffff");
		expect(f(1)).toMatch(/rgb\(255, 255, 255\)/);
	});

	it("preserves shallow-copy behaviour: a fresh reference every sample", () => {
		// Regression for the bug the original `auto` doc explains: d3's
		// structural interpolator mutates one buffer in place, which a Track's
		// reference-equality signal reads as a no-op after the first sample.
		const f = auto({ x: 0, y: 0 }, { x: 10, y: 10 });
		const first = f(0.3);
		const second = f(0.6);
		expect(first).not.toBe(second);
		expect(first).toEqual({ x: 3, y: 3 });
		expect(second).toEqual({ x: 6, y: 6 });
	});

	it("still shallow-copies through the structural (array) fallback", () => {
		const f = auto([0, 0], [10, 10]);
		const first = f(0.3);
		const second = f(0.6);
		expect(first).not.toBe(second);
	});
});

describe("progress outside 0..1 (springs and overshooting easings)", () => {
	const overshoots = [-0.5, 1.5];

	/** True when no number anywhere inside `value` is NaN or infinite. */
	function allFinite(value: unknown): boolean {
		if (typeof value === "number") return Number.isFinite(value);
		if (Array.isArray(value)) return value.every(allFinite);
		if (value !== null && typeof value === "object") {
			return Object.values(value).every(allFinite);
		}
		return true;
	}

	/** Parses `rgb(...)`/`rgba(...)` and checks every channel is displayable. */
	function expectValidColor(css: string) {
		const match = css.match(/^rgba?\(([^)]*)\)$/);
		expect(match, css).not.toBeNull();
		const parts = (match?.[1] ?? "").split(",").map(Number);
		const [r, g, b, a = 1] = parts;
		for (const channel of [r, g, b]) {
			expect(channel).toBeGreaterThanOrEqual(0);
			expect(channel).toBeLessThanOrEqual(255);
		}
		expect(a).toBeGreaterThanOrEqual(0);
		expect(a).toBeLessThanOrEqual(1);
	}

	it("number extrapolates linearly", () => {
		const f = interpolators.number(0, 10);
		expect(f(-0.5)).toBe(-5);
		expect(f(1.5)).toBe(15);
	});

	it("point and point3 extrapolate linearly", () => {
		expect(pointInterpolator({ x: 0, y: 0 }, { x: 10, y: 20 })(1.5)).toEqual({
			x: 15,
			y: 30,
		});
		expect(
			point3Interpolator({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 })(-0.5),
		).toEqual({ x: -1, y: -2, z: -3 });
	});

	it("matrix extrapolates component-wise", () => {
		const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
		const moved = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 0 };
		expect(matrixInterpolator(identity, moved)(1.5)).toEqual({
			a: 2.5,
			b: 0,
			c: 0,
			d: 2.5,
			e: 15,
			f: 0,
		});
		expect(allFinite(matrixInterpolator(identity, moved)(-0.5))).toBe(true);
	});

	it("polyline extrapolates every vertex", () => {
		const f = polylineInterpolator(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			],
			[
				{ x: 0, y: 10 },
				{ x: 10, y: 10 },
			],
		);
		expect(f(1.5)).toEqual([
			{ x: 0, y: 15 },
			{ x: 10, y: 15 },
		]);
		expect(f(-0.5)[0]).toEqual({ x: 0, y: -5 });
	});

	it("curve path extrapolates control points and snaps `closed` to the nearer end", () => {
		const segment = (y: number) => ({
			c1: { x: 1, y },
			c2: { x: 2, y },
			to: { x: 3, y },
		});
		const f = curvePathInterpolator(
			{ start: { x: 0, y: 0 }, segments: [segment(0)], closed: false },
			{ start: { x: 0, y: 10 }, segments: [segment(10)], closed: true },
		);
		const late = f(1.5);
		expect(late.start).toEqual({ x: 0, y: 15 });
		expect(late.segments[0]?.to).toEqual({ x: 3, y: 15 });
		expect(late.closed).toBe(true);
		const early = f(-0.5);
		expect(early.start).toEqual({ x: 0, y: -5 });
		expect(early.closed).toBe(false);
	});

	it("color clamps channels and alpha in every space", () => {
		for (const colorSpace of ["rgb", "hsl", "oklch"] as const) {
			for (const [a, b] of [
				["#3b4cc0", "#b40426"],
				["rgba(10, 200, 30, 0.2)", "rgba(250, 10, 240, 0.9)"],
				["#000000", "#ffffff"],
			] as const) {
				const f = cssColorInterpolator(colorSpace)(a, b);
				for (const t of overshoots) expectValidColor(f(t));
			}
		}
		const f = interpolators.color("#000000", "#ffffff");
		expect(f(1.5)).toBe("rgba(255, 255, 255, 1)");
		expect(f(-0.5)).toBe("rgba(0, 0, 0, 1)");
	});

	it("auto's d3 fallback clamps colour strings", () => {
		const f = auto("rgba(10, 200, 30, 0.2)", "rgba(250, 10, 240, 0.9)");
		for (const t of overshoots) expectValidColor(f(t));
		const hex = auto("#204080", "#f0f0f0");
		for (const t of overshoots) expectValidColor(hex(t));
	});

	it("auto's d3 fallback handles arrays of different lengths and objects", () => {
		const arrays = auto([1, 2, 3], [4, 5]);
		for (const t of overshoots) {
			expect(allFinite(arrays(t))).toBe(true);
		}
		const objects = auto(
			{ fill: "#ff0000", width: 1 },
			{ fill: "#00ff00", width: 3 },
		);
		const late = objects(1.5) as { fill: string; width: number };
		expect(late.width).toBe(4);
		expectValidColor(late.fill);
	});

	it("every registered interpolator gives finite output at -0.5 and 1.5", () => {
		const samples: Record<InterpolatorName, [unknown, unknown]> = {
			number: [0, 1],
			point: [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
			point3: [
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			],
			color: ["#123456", "#fedcba"],
			matrix: [
				{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
				{ a: 0, b: 1, c: -1, d: 0, e: 5, f: 5 },
			],
			polyline: [[{ x: 0, y: 0 }], [{ x: 1, y: 1 }]],
			curvePath: [
				{ start: { x: 0, y: 0 }, segments: [], closed: false },
				{ start: { x: 1, y: 1 }, segments: [], closed: true },
			],
		};
		for (const name of Object.keys(samples) as InterpolatorName[]) {
			const [a, b] = samples[name];
			const f = resolveInterpolator<unknown>(name)?.(a, b);
			for (const t of overshoots) {
				const value = f?.(t);
				expect(value, name).toBeDefined();
				expect(allFinite(value), name).toBe(true);
			}
		}
	});
});
