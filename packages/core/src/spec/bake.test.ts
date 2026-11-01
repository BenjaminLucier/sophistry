import { describe, expect, it } from "vitest";
import type { CurvePath, Point, Polyline } from "../geometry/index.js";
import { lineSegment } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	compose,
	fromTranslationRotationScale,
	IDENTITY,
	rotate,
	translate,
} from "../geometry/transform.js";
import { resolveTheme } from "../themes/index.js";
import type { ShapeGeometry } from "./bake.js";
import {
	bake,
	bakeCurvePaths,
	bakeLocalTransform,
	bakeMatrix,
	bakePaintFrame,
	bakePolylines,
	bakeShapeSpec,
	bakeStrokeStyle,
	bakeTextSpec,
	bakeTextStyle,
	derivePolylines,
} from "./bake.js";
import { linearGradient } from "./gradient.js";
import type { ShapeSpec } from "./types.js";

const theme = resolveTheme({ mode: "dark" });

function square(): Polyline[] {
	return [
		[
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 2 },
			{ x: 0, y: 2 },
		],
	];
}

describe("bakeLocalTransform", () => {
	it("is null (identity) when there is no x/y/rotation and scale is 1 or unset — the no-op case", () => {
		expect(bakeLocalTransform({}, { x: 0, y: 0 }, () => square())).toBeNull();
		expect(
			bakeLocalTransform({ scale: 1 }, { x: 0, y: 0 }, () => square()),
		).toBeNull();
	});

	it("folds place delta and x/y additively", () => {
		const m = bakeLocalTransform({ x: 1, y: 2 }, { x: 10, y: 20 }, () =>
			square(),
		);
		expect(m).not.toBeNull();
		expect(m).toEqual(translate(11, 22));
	});

	it("never calls the polylines thunk when the transform is the identity — laziness for the common case", () => {
		let called = false;
		bakeLocalTransform({}, { x: 0, y: 0 }, () => {
			called = true;
			return square();
		});
		expect(called).toBe(false);
	});

	it("skips the pivot (bounds) pass for a pure translation, and matches fromTranslationRotationScale", () => {
		let called = false;
		const m = bakeLocalTransform(
			{ x: 0.1, scale: 1 },
			{ x: 0.2, y: -3 },
			() => {
				called = true;
				return square();
			},
		);
		expect(called).toBe(false);
		expect(m).toEqual(translate(0.1 + 0.2, -3));
		const pivoted = fromTranslationRotationScale({
			x: 0.1 + 0.2,
			y: -3,
			origin: { x: 1, y: 1 },
		});
		for (const key of ["a", "b", "c", "d", "e", "f"] as const)
			expect(m?.[key]).toBeCloseTo(pivoted[key], 12);
	});

	it("defaults origin to the shape's own bounds centre when transformed and no origin given", () => {
		const m = bakeLocalTransform({ rotation: Math.PI }, { x: 0, y: 0 }, () =>
			square(),
		);
		// A half-turn about the box centre (1,1) maps (0,0) -> (2,2).
		expect(m).not.toBeNull();
		const mapped = applyPoint(m as Matrix, { x: 0, y: 0 });
		expect(mapped.x).toBeCloseTo(2);
		expect(mapped.y).toBeCloseTo(2);
	});

	it("falls back to the origin (not NaN) when every polyline is empty", () => {
		const m = bakeLocalTransform({ rotation: Math.PI }, { x: 0, y: 0 }, () => [
			[],
		]);
		expect(m).not.toBeNull();
		const mapped = applyPoint(m as Matrix, { x: 1, y: 0 });
		expect(mapped.x).toBeCloseTo(-1);
		expect(mapped.y).toBeCloseTo(0);
	});

	it("an explicit origin overrides the bounds-centre default", () => {
		const m = bakeLocalTransform(
			{ rotation: Math.PI, origin: { x: 0, y: 0 } },
			{ x: 0, y: 0 },
			() => square(),
		);
		const mapped = applyPoint(m as Matrix, { x: 0, y: 0 });
		expect(mapped.x).toBeCloseTo(0);
		expect(mapped.y).toBeCloseTo(0);
	});
});

function applyPoint(m: Matrix, p: Point): Point {
	return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

describe("bakeMatrix", () => {
	it("returns the space matrix unchanged when local is null", () => {
		const space = translate(5, 5);
		expect(bakeMatrix(space, null)).toEqual(space);
	});

	it("composes the space matrix with the local TRS, space outer", () => {
		const space = translate(5, 0);
		const local = translate(0, 3);
		expect(bakeMatrix(space, local)).toEqual(compose(space, local));
	});

	it("composes through a nested space (a group inside a group)", () => {
		const outerGroup = translate(10, 0);
		const innerGroup = rotate(Math.PI / 2);
		const space = compose(outerGroup, innerGroup);
		const local = translate(1, 0);
		const matrix = bakeMatrix(space, local);
		// (1,0) local -> translate(1,0) -> (2,0) -> rotate 90 -> (0,2) -> translate(10,0) -> (10,2)
		const mapped = applyPoint(matrix, { x: 1, y: 0 });
		expect(mapped.x).toBeCloseTo(10);
		expect(mapped.y).toBeCloseTo(2);
	});
});

describe("bakePolylines / bakeCurvePaths — array identity", () => {
	it("bakePolylines maps every vertex through the matrix", () => {
		const lines = square();
		const m = translate(1, 1);
		const baked = bakePolylines(lines, m);
		expect(baked).toEqual([
			[
				{ x: 1, y: 1 },
				{ x: 3, y: 1 },
				{ x: 3, y: 3 },
				{ x: 1, y: 3 },
			],
		]);
	});

	it("bakeCurvePaths is undefined when there is no source — no allocation for the common case", () => {
		expect(bakeCurvePaths(undefined, IDENTITY)).toBeUndefined();
	});

	it("bakeCurvePaths maps every anchor and control point, preserving segment count/order", () => {
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 1, y: 0 })],
			closed: false,
		};
		const baked = bakeCurvePaths([curve], translate(2, 0));
		expect(baked).toHaveLength(1);
		expect(baked?.[0].start).toEqual({ x: 2, y: 0 });
		expect(baked?.[0].segments[0].to).toEqual({ x: 3, y: 0 });
	});

	it("array-identity stability: re-evaluating bakePolylines with the same matrix and the same source array is a fresh array each call (the memo wrapping it, not this function, owns identity-stability)", () => {
		// This is the invariant `canvas-renderer.ts`'s RevealCache depends on —
		// see that file's header. bakePolylines itself is a pure `.map()`, so it
		// always allocates; identity stability across *re-evaluation with
		// unchanged inputs* is the calling memo's job (`memo()` only
		// re-runs the body when a tracked dependency changes, so the *memo's*
		// output reference is stable even though this function's own output
		// isn't). What this function must not do is anything worse — e.g.
		// mutate its input arrays or amortise incorrectly — so this test proves
		// two independent calls with equal (not identical) inputs produce
		// deep-equal, not identical, output: the memo boundary is where
		// identity is meant to come from, not this function.
		const lines = square();
		const m = translate(1, 1);
		const a = bakePolylines(lines, m);
		const b = bakePolylines(lines, m);
		expect(a).toEqual(b);
		expect(a).not.toBe(b);
		// But feeding the *same* baked array through unchanged is exactly what a
		// memo does when its dependencies haven't changed — simulate that here:
		// a "memo" that only recomputes when `lines`/`m` change by reference.
		function memoized() {
			let cachedLines: Polyline[] | null = null;
			let cachedMatrix: Matrix | null = null;
			let cachedResult: Polyline[] | null = null;
			return (src: Polyline[], matrix: Matrix) => {
				if (src === cachedLines && matrix === cachedMatrix && cachedResult) {
					return cachedResult;
				}
				cachedLines = src;
				cachedMatrix = matrix;
				cachedResult = bakePolylines(src, matrix);
				return cachedResult;
			};
		}
		const run = memoized();
		const first = run(lines, m);
		const second = run(lines, m);
		expect(second).toBe(first);
	});
});

describe("bakePaintFrame", () => {
	it("box is the shape's own pre-transform bounds", () => {
		const frame = bakePaintFrame(square(), IDENTITY);
		expect(frame.box).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 2 });
	});

	it("toScene rides the shape's own matrix (its local TRS included)", () => {
		const matrix = translate(5, 0);
		const frame = bakePaintFrame(square(), matrix);
		expect(frame.toScene({ x: 0, y: 0 })).toEqual({ x: 5, y: 0 });
		expect(frame.sceneUnitsPerUnit).toBeCloseTo(1);
	});

	it("reports the matrix's scale for radii", () => {
		const frame = bakePaintFrame(square(), {
			a: 3,
			b: 0,
			c: 0,
			d: 3,
			e: 0,
			f: 0,
		});
		expect(frame.sceneUnitsPerUnit).toBeCloseTo(3);
	});
});

describe("bakeStrokeStyle", () => {
	it("scene-unit strokeWidth converts by the given pixelsPerUnit scale factor", () => {
		const style = bakeStrokeStyle({ strokeWidth: 0.1 }, theme, 10, 1, () => {
			throw new Error("should not build a paint frame for a plain colour");
		});
		expect(style.strokeWidth).toBeCloseTo(1);
	});

	it("falls back to the theme's default stroke width, still scaled", () => {
		const style = bakeStrokeStyle({}, theme, 10, 1, () => {
			throw new Error("no gradient here");
		});
		expect(style.strokeWidth).toBeCloseTo(theme.defaults.strokeWidth * 10);
	});

	it("dash and dashOffset scale by the same pixelsPerUnit", () => {
		const style = bakeStrokeStyle(
			{ dash: [0.2, 0.1], dashOffset: 0.05 },
			theme,
			10,
			1,
			() => {
				throw new Error("no gradient");
			},
		);
		expect(style.dash).toEqual([2, 1]);
		expect(style.dashOffset).toBeCloseTo(0.5);
	});

	it("a gradient fill/stroke lands in the paint frame's space — bbox units resolve against the frame's box and matrix", () => {
		const frame = bakePaintFrame(square(), translate(10, 0));
		const style = bakeStrokeStyle(
			{ fill: linearGradient(["red", "blue"]) },
			theme,
			1,
			1,
			() => frame,
		);
		expect(style.fill).not.toBeNull();
		expect(typeof style.fill).toBe("object");
	});

	it("the paint frame thunk is only invoked when a gradient is present", () => {
		let calls = 0;
		bakeStrokeStyle({ stroke: "#ff0000", fill: "#00ff00" }, theme, 1, 1, () => {
			calls++;
			return bakePaintFrame(square(), IDENTITY);
		});
		expect(calls).toBe(0);
	});

	it("opacity multiplies the shape's own opacity by the space's inherited opacity", () => {
		const style = bakeStrokeStyle({ opacity: 0.5 }, theme, 1, 0.4, () => {
			throw new Error("no gradient");
		});
		expect(style.opacity).toBeCloseTo(0.2);
	});
});

describe("bakeTextStyle", () => {
	it("scene-unit fontSize and letterSpacing convert by pixelsPerUnit", () => {
		const style = bakeTextStyle(
			{ fontSize: 0.5, letterSpacing: 0.02 },
			theme,
			20,
			1,
		);
		expect(style.fontSize).toBeCloseTo(10);
		expect(style.letterSpacing).toBeCloseTo(0.4);
	});

	it("falls back to theme defaults for fill/fontFamily/fontSize", () => {
		const style = bakeTextStyle({}, theme, 1, 1);
		expect(style.fill).toBe(theme.palette.foreground);
		expect(style.fontFamily).toBe(theme.defaults.fontFamily);
		expect(style.fontSize).toBeCloseTo(theme.defaults.fontSize);
	});
});

describe("bakeTextSpec", () => {
	it("keeps the scene rotation as is — the y flip is the renderer's, applied through the view", () => {
		const spec = bakeTextSpec({
			id: 1,
			text: "hi",
			at: { x: 0, y: 0 },
			rotation: 0.3,
			style: bakeTextStyle({}, theme, 1, 1),
		});
		expect(spec?.rotation).toBeCloseTo(0.3);
	});

	it("folds an enclosing group's rotation into the scene-space angle", () => {
		const spec = bakeTextSpec({
			id: 1,
			text: "hi",
			at: { x: 0, y: 0 },
			rotation: 0.3,
			matrix: rotate(0.5),
			style: bakeTextStyle({}, theme, 1, 1),
		});
		expect(spec?.rotation).toBeCloseTo(0.8);
	});

	it("is null for empty text or non-positive progress", () => {
		const style = bakeTextStyle({}, theme, 1, 1);
		expect(
			bakeTextSpec({ id: 1, text: "", at: { x: 0, y: 0 }, style }),
		).toBeNull();
		expect(
			bakeTextSpec({
				id: 1,
				text: "x",
				at: { x: 0, y: 0 },
				style,
				progress: 0,
			}),
		).toBeNull();
	});
});

describe("bakeShapeSpec", () => {
	it("assembles the ShapeSpec fields without further conversion, omitting curvePaths when absent", () => {
		const style = bakeStrokeStyle({}, theme, 1, 1, () => {
			throw new Error("no gradient");
		});
		const spec = bakeShapeSpec({
			id: 3,
			zIndex: 2,
			polylines: square(),
			closed: true,
			style,
			progress: 1,
		});
		expect(spec.kind).toBe("shape");
		expect(spec.id).toBe(3);
		expect(spec.zIndex).toBe(2);
		expect(spec.fillFrom).toBe(0);
		expect(spec.curvePaths).toBeUndefined();
		expect("curvePaths" in spec).toBe(false);
	});
});

describe("bake — the full non-reactive pipeline", () => {
	const space = { matrix: IDENTITY, opacity: 1 };

	function geometryOf(polylines: Polyline[], closed = false): ShapeGeometry {
		return { polylines, closed };
	}

	it("identity / no-op case: no transform, identity space -> polylines pass through positionally unchanged", () => {
		const spec = bake(geometryOf(square()), space, {}, theme, { id: 1 });
		expect(spec).not.toBeNull();
		expect((spec as ShapeSpec).polylines).toEqual(square());
	});

	it("composes through a nested space: a group matrix plus the shape's own x/y both apply", () => {
		const nestedSpace = {
			matrix: translate(100, 0),
			opacity: 1,
		};
		const spec = bake(geometryOf(square()), nestedSpace, {}, theme, {
			id: 1,
			x: 5,
			y: 0,
		}) as ShapeSpec;
		// group translate(100,0) then shape's own x=5: (0,0) -> (105, 0)
		expect(spec.polylines[0][0]).toEqual({ x: 105, y: 0 });
	});

	it("scene-unit stroke width converts by the matrix's scale factor", () => {
		const scaledSpace = {
			matrix: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
			opacity: 1,
		};
		const spec = bake(
			geometryOf(square()),
			scaledSpace,
			{ strokeWidth: 0.1 },
			theme,
			{ id: 1 },
		) as ShapeSpec;
		expect(spec.style.strokeWidth).toBeCloseTo(0.4);
	});

	it("penScale overrides the matrix's own scale factor for the pen", () => {
		const scaledSpace = {
			matrix: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
			opacity: 1,
			penScale: 1,
		};
		const spec = bake(
			geometryOf(square()),
			scaledSpace,
			{ strokeWidth: 0.1 },
			theme,
			{ id: 1 },
		) as ShapeSpec;
		// Without penScale this would be 0.4 (4x); pinned to 1x instead.
		expect(spec.style.strokeWidth).toBeCloseTo(0.1);
	});

	it("a gradient fill's paint frame lands in the right (bbox) space", () => {
		const spec = bake(
			geometryOf(square()),
			space,
			{ fill: linearGradient(["red", "blue"]) },
			theme,
			{ id: 1 },
		) as ShapeSpec;
		expect(spec.style.fill).not.toBeNull();
		expect(typeof spec.style.fill).toBe("object");
	});

	it("is null when invisible", () => {
		expect(
			bake(geometryOf(square()), space, {}, theme, { id: 1, visible: false }),
		).toBeNull();
	});

	it("is null when progress is 0 and there's no fill to hold the shape visible", () => {
		expect(
			bake(geometryOf(square()), space, {}, theme, { id: 1, progress: 0 }),
		).toBeNull();
	});

	it("array-identity stability across re-evaluation with unchanged inputs: calling bake() twice with the same (by reference) ShapeGeometry and a transforming space produces deep-equal but distinct polylines arrays — proving identity-stability is the memo's job, not a hidden cache inside bake()", () => {
		const geometry = geometryOf(square());
		const moved = { matrix: translate(1, 0), opacity: 1 };
		const first = bake(geometry, moved, {}, theme, { id: 1 }) as ShapeSpec;
		const second = bake(geometry, moved, {}, theme, { id: 1 }) as ShapeSpec;
		expect(first.polylines).toEqual(second.polylines);
		expect(first.polylines).not.toBe(second.polylines);
	});

	it("the identity space hands the producer's own geometry through, with no vertex copy", () => {
		const polylines = square();
		const spec = bake(
			{ polylines, closed: true },
			{ matrix: IDENTITY, opacity: 1 },
			{},
			theme,
			{ id: 1 },
		) as ShapeSpec;
		expect(spec.polylines).toBe(polylines);
	});
});

describe("derivePolylines (re-exported from bake.ts, still reachable from shape.ts)", () => {
	it("throws when neither polylines nor curvePaths is given", () => {
		expect(() => derivePolylines({ closed: false })).toThrow();
	});

	it("prefers explicit polylines over curvePaths", () => {
		const explicit = square();
		const curve: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 1, y: 0 })],
			closed: false,
		};
		expect(
			derivePolylines({
				polylines: explicit,
				curvePaths: [curve],
				closed: false,
			}),
		).toBe(explicit);
	});
});
