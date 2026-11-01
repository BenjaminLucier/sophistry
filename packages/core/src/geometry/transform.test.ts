import { describe, expect, it } from "vitest";
import { lineSegment } from "./path/cubic.js";
import type { CurvePath, Point } from "./path/types.js";
import type { Matrix } from "./transform.js";
import {
	about,
	applyToCurvePath,
	applyToPoint,
	applyToPolyline,
	columnsOf,
	compose,
	determinant,
	fromColumns,
	fromTranslationRotationScale,
	IDENTITY,
	invert,
	lerpMatrix,
	linearMap,
	rotate,
	scale,
	scaleFactorOf,
	translate,
} from "./transform.js";

function expectPointClose(a: Point, b: Point) {
	expect(a.x).toBeCloseTo(b.x, 9);
	expect(a.y).toBeCloseTo(b.y, 9);
}

function expectMatrixClose(a: Matrix, b: Matrix, digits = 9) {
	expect(a.a).toBeCloseTo(b.a, digits);
	expect(a.b).toBeCloseTo(b.b, digits);
	expect(a.c).toBeCloseTo(b.c, digits);
	expect(a.d).toBeCloseTo(b.d, digits);
	expect(a.e).toBeCloseTo(b.e, digits);
	expect(a.f).toBeCloseTo(b.f, digits);
}

describe("compose", () => {
	it("composing with identity is a no-op on either side", () => {
		const m: Matrix = { a: 2, b: 0.5, c: -0.3, d: 1.2, e: 5, f: -7 };
		expectMatrixClose(compose(IDENTITY, m), m);
		expectMatrixClose(compose(m, IDENTITY), m);
	});

	it("is associative", () => {
		const a: Matrix = translate(1, 2);
		const b: Matrix = rotate(0.7);
		const c: Matrix = scale(2, 3);
		expectMatrixClose(compose(compose(a, b), c), compose(a, compose(b, c)));
	});

	it("applies outer after inner to a point", () => {
		const outer = translate(10, 0);
		const inner = scale(2, 2);
		const m = compose(outer, inner);
		// scale then translate: (1,1) -> (2,2) -> (12,2)
		expectPointClose(applyToPoint(m, { x: 1, y: 1 }), { x: 12, y: 2 });
	});
});

describe("translate/scale/rotate", () => {
	it("translate moves points, leaves basis vectors alone", () => {
		const m = translate(3, 4);
		expectPointClose(applyToPoint(m, { x: 0, y: 0 }), { x: 3, y: 4 });
		const { iHat, jHat } = columnsOf(m);
		expectPointClose(iHat, { x: 1, y: 0 });
		expectPointClose(jHat, { x: 0, y: 1 });
	});

	it("scale defaults sy to sx", () => {
		const m = scale(3);
		expect(m.a).toBe(3);
		expect(m.d).toBe(3);
	});

	it("rotate(0) is the identity", () => {
		expectMatrixClose(rotate(0), IDENTITY);
	});

	it("rotate is periodic in 2*pi", () => {
		expectMatrixClose(rotate(0.37), rotate(0.37 + 2 * Math.PI), 6);
	});

	it("rotate(pi/2) sends (1,0) to (0,1)", () => {
		const m = rotate(Math.PI / 2);
		expectPointClose(applyToPoint(m, { x: 1, y: 0 }), { x: 0, y: 1 });
	});

	it("four quarter-turns compose back to identity", () => {
		const q = rotate(Math.PI / 2);
		const full = compose(compose(compose(q, q), q), q);
		expectMatrixClose(full, IDENTITY, 6);
	});
});

describe("fromTranslationRotationScale", () => {
	it("defaults to identity", () => {
		expectMatrixClose(fromTranslationRotationScale({}), IDENTITY);
	});

	it("translation-only matches translate()", () => {
		expectMatrixClose(
			fromTranslationRotationScale({ x: 5, y: -2 }),
			translate(5, -2),
		);
	});

	it("origin leaves the origin point fixed under rotation", () => {
		const origin = { x: 10, y: 10 };
		const m = fromTranslationRotationScale({ rotation: Math.PI / 3, origin });
		expectPointClose(applyToPoint(m, origin), origin);
	});

	it("scaleY defaults to scaleX when omitted", () => {
		const withBoth = fromTranslationRotationScale({ scaleX: 2, scaleY: 2 });
		const withOne = fromTranslationRotationScale({ scaleX: 2 });
		expectMatrixClose(withBoth, withOne);
	});
});

describe("linearMap / fromColumns / columnsOf", () => {
	it("linearMap transposes rows into columns correctly", () => {
		// (x,y) -> (2x + 3y, 5x + 7y)
		const m = linearMap([
			[2, 3],
			[5, 7],
		]);
		expectPointClose(applyToPoint(m, { x: 1, y: 0 }), { x: 2, y: 5 });
		expectPointClose(applyToPoint(m, { x: 0, y: 1 }), { x: 3, y: 7 });
	});

	it("fromColumns / columnsOf round-trip", () => {
		const iHat = { x: 2, y: 3 };
		const jHat = { x: -1, y: 4 };
		const m = fromColumns(iHat, jHat);
		const back = columnsOf(m);
		expectPointClose(back.iHat, iHat);
		expectPointClose(back.jHat, jHat);
	});
});

describe("determinant", () => {
	it("identity has determinant 1", () => {
		expect(determinant(IDENTITY)).toBe(1);
	});

	it("scale(sx,sy) has determinant sx*sy", () => {
		expect(determinant(scale(2, 3))).toBeCloseTo(6, 9);
	});

	it("a flip has negative determinant", () => {
		const flip = linearMap([
			[-1, 0],
			[0, 1],
		]);
		expect(determinant(flip)).toBeLessThan(0);
	});

	it("a collapsed map has determinant 0", () => {
		const collapse = linearMap([
			[1, 1],
			[1, 1],
		]);
		expect(determinant(collapse)).toBe(0);
	});
});

describe("about", () => {
	it("fixes the given origin point", () => {
		const origin = { x: 3, y: -2 };
		const m = about(rotate(1.234), origin);
		expectPointClose(applyToPoint(m, origin), origin);
	});

	it("about({0,0}, m) === m", () => {
		const m = rotate(0.9);
		expectMatrixClose(about(m, { x: 0, y: 0 }), m);
	});
});

describe("lerpMatrix", () => {
	it("t=0 returns from, t=1 returns to", () => {
		const from = translate(0, 0);
		const to = translate(10, 20);
		expectMatrixClose(lerpMatrix(from, to, 0), from);
		expectMatrixClose(lerpMatrix(from, to, 1), to);
	});

	it("t=0.5 is the midpoint of each component", () => {
		const from: Matrix = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
		const to: Matrix = { a: 2, b: 4, c: 6, d: 8, e: 10, f: 12 };
		expectMatrixClose(lerpMatrix(from, to, 0.5), {
			a: 1,
			b: 2,
			c: 3,
			d: 4,
			e: 5,
			f: 6,
		});
	});

	it("interpolating the matrix equals interpolating a transformed point, for linear maps", () => {
		const from = rotate(0);
		const to = rotate(Math.PI / 2);
		const p = { x: 3, y: 5 };
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			const viaMatrix = applyToPoint(lerpMatrix(from, to, t), p);
			const viaPoints = {
				x: (1 - t) * applyToPoint(from, p).x + t * applyToPoint(to, p).x,
				y: (1 - t) * applyToPoint(from, p).y + t * applyToPoint(to, p).y,
			};
			expectPointClose(viaMatrix, viaPoints);
		}
	});
});

describe("invert", () => {
	it("invert(identity) is identity", () => {
		expectMatrixClose(invert(IDENTITY), IDENTITY);
	});

	it("compose(invert(m), m) is identity for a range of matrices", () => {
		const samples: Matrix[] = [
			translate(5, -3),
			rotate(0.6),
			scale(2, 3),
			scale(-1, 2),
			compose(translate(4, 4), compose(rotate(1.1), scale(2, 0.5))),
			fromTranslationRotationScale({
				x: 1,
				y: -2,
				rotation: 0.4,
				scaleX: 3,
				scaleY: 0.2,
				origin: { x: 1, y: 1 },
			}),
		];
		for (const m of samples) {
			expectMatrixClose(compose(invert(m), m), IDENTITY, 6);
			expectMatrixClose(compose(m, invert(m)), IDENTITY, 6);
		}
	});

	it("degenerate matrix (det=0) inverts to identity, not NaN", () => {
		const collapsed: Matrix = { a: 1, b: 1, c: 1, d: 1, e: 5, f: 5 };
		expect(determinant(collapsed)).toBe(0);
		expectMatrixClose(invert(collapsed), IDENTITY);
	});

	it("zero matrix inverts to identity", () => {
		const zero: Matrix = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
		expectMatrixClose(invert(zero), IDENTITY);
	});
});

describe("applyToPoint / applyToPolyline", () => {
	it("applyToPolyline maps every point", () => {
		const m = translate(1, 1);
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 2 },
		];
		const mapped = applyToPolyline(m, points);
		expectPointClose(mapped[0], { x: 1, y: 1 });
		expectPointClose(mapped[1], { x: 2, y: 3 });
	});

	it("applyToPolyline on empty array returns empty array", () => {
		expect(applyToPolyline(IDENTITY, [])).toEqual([]);
	});
});

describe("applyToCurvePath", () => {
	const curve: CurvePath = {
		start: { x: 0, y: 0 },
		segments: [
			lineSegment({ x: 0, y: 0 }, { x: 1, y: 0 }),
			{
				c1: { x: 1, y: 1 },
				c2: { x: 2, y: 1 },
				to: { x: 2, y: 0 },
			},
		],
		closed: false,
	};

	it("maps start and every segment's to/c1/c2 through the matrix", () => {
		const m = compose(scale(2), translate(1, 1));
		const mapped = applyToCurvePath(m, curve);

		expectPointClose(mapped.start, applyToPoint(m, curve.start));
		const line = mapped.segments[0];
		const cubic = mapped.segments[1];
		expectPointClose(line.to, applyToPoint(m, { x: 1, y: 0 }));
		expectPointClose(cubic.c1, applyToPoint(m, { x: 1, y: 1 }));
		expectPointClose(cubic.c2, applyToPoint(m, { x: 2, y: 1 }));
		expectPointClose(cubic.to, applyToPoint(m, { x: 2, y: 0 }));
	});

	it("preserves closed and segment order", () => {
		const closedCurve: CurvePath = { ...curve, closed: true };
		const mapped = applyToCurvePath(translate(5, 5), closedCurve);
		expect(mapped.closed).toBe(true);
		expect(mapped.segments.map((s) => s.to)).toEqual([
			applyToPoint(translate(5, 5), curve.segments[0].to),
			applyToPoint(translate(5, 5), curve.segments[1].to),
		]);
	});

	it("identity leaves points unchanged", () => {
		const mapped = applyToCurvePath(IDENTITY, curve);
		expect(mapped).toEqual(curve);
	});

	it("an empty-segment curve maps just the start point", () => {
		const empty: CurvePath = {
			start: { x: 3, y: 4 },
			segments: [],
			closed: false,
		};
		const mapped = applyToCurvePath(translate(1, 1), empty);
		expectPointClose(mapped.start, { x: 4, y: 5 });
		expect(mapped.segments).toEqual([]);
	});
});

describe("scaleFactorOf", () => {
	it("identity has scale factor 1", () => {
		expect(scaleFactorOf(IDENTITY)).toBeCloseTo(1, 9);
	});

	it("uniform scale returns that scale", () => {
		expect(scaleFactorOf(scale(4, 4))).toBeCloseTo(4, 9);
	});

	it("rotation alone has scale factor 1", () => {
		expect(scaleFactorOf(rotate(1.3))).toBeCloseTo(1, 9);
	});

	it("non-uniform scale returns the average", () => {
		expect(scaleFactorOf(scale(2, 6))).toBeCloseTo(4, 9);
	});
});

describe("fuzz: round-trip invert over a sweep of TRS matrices", () => {
	it("invert(m) composed with m stays within tolerance across many samples", () => {
		for (let i = 0; i < 50; i++) {
			const angle = (i / 50) * Math.PI * 4 - Math.PI * 2;
			const sx = 0.1 + (i % 7) * 0.5;
			const sy = 0.1 + (i % 5) * 0.7;
			const m = fromTranslationRotationScale({
				x: i - 25,
				y: (i * 3) % 17,
				rotation: angle,
				scaleX: sx,
				scaleY: sy,
				origin: { x: (i % 3) - 1, y: (i % 4) - 2 },
			});
			expectMatrixClose(compose(invert(m), m), IDENTITY, 5);
		}
	});
});

describe("invert of a singular matrix", () => {
	it("returns a fresh identity, not the shared IDENTITY object", () => {
		const result = invert({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 2 });
		expect(result).toEqual(IDENTITY);
		expect(result).not.toBe(IDENTITY);
	});
});
