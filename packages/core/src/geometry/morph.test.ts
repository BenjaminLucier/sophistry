import { describe, expect, it } from "vitest";
import {
	correspondences,
	lerpPoint,
	morphCurvePaths,
	morphPathData,
	morphPolylines,
	morphRings,
	resampleCorrespondence,
	resolveCorrespondence,
} from "./morph";
import { lineSegment } from "./path/cubic";
import type { CurvePath, Point, Polyline } from "./path/types";

function expectPointClose(a: Point, b: Point, digits = 4) {
	expect(a.x).toBeCloseTo(b.x, digits);
	expect(a.y).toBeCloseTo(b.y, digits);
}

describe("lerpPoint", () => {
	it("t=0 is a, t=1 is b", () => {
		const a = { x: 0, y: 0 };
		const b = { x: 10, y: 20 };
		expect(lerpPoint(a, b, 0)).toEqual(a);
		expect(lerpPoint(a, b, 1)).toEqual(b);
	});

	it("t=0.5 is the midpoint", () => {
		expect(lerpPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({
			x: 5,
			y: 10,
		});
	});
});

describe("morphPolylines", () => {
	it("t<=0 returns (a resample of) the source, t>=1 returns the target", () => {
		const from: Polyline = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		];
		const to: Polyline = [
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
		];
		const interp = morphPolylines(from, to, { samples: 2 });
		expectPointClose(interp(0)[0], from[0]);
		expectPointClose(interp(0)[1], from[1]);
		expectPointClose(interp(1)[0], to[0]);
		expectPointClose(interp(1)[1], to[1]);
	});

	it("t=0.5 is the midpoint of each corresponding vertex", () => {
		const from: Polyline = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		];
		const to: Polyline = [
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
		];
		const interp = morphPolylines(from, to, { samples: 2 });
		const mid = interp(0.5);
		expectPointClose(mid[0], { x: 0, y: 5 });
		expectPointClose(mid[1], { x: 10, y: 5 });
	});

	it("output always has the resampled count regardless of differing input lengths", () => {
		const from: Polyline = [
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
		];
		const to: Polyline = [
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
		];
		const interp = morphPolylines(from, to, { samples: 5 });
		expect(interp(0.5).length).toBe(5);
	});

	it("closed morph keeps every frame a full ring (first === last)", () => {
		const from: Polyline = [
			{ x: -1, y: -1 },
			{ x: 1, y: -1 },
			{ x: 1, y: 1 },
			{ x: -1, y: 1 },
		];
		const to: Polyline = [
			{ x: -2, y: -2 },
			{ x: 2, y: -2 },
			{ x: 2, y: 2 },
			{ x: -2, y: 2 },
		];
		const interp = morphPolylines(from, to, { closed: true, samples: 16 });
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			const ring = interp(t);
			expectPointClose(ring[0], ring[ring.length - 1]);
		}
	});

	it("default sample count is at least 32 and bounded by 1024", () => {
		const from: Polyline = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		];
		const to: Polyline = [
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		];
		const interp = morphPolylines(from, to);
		expect(interp(0.5).length).toBeGreaterThanOrEqual(32);
		expect(interp(0.5).length).toBeLessThanOrEqual(1024);
	});
});

describe("resolveCorrespondence", () => {
	it("resolves a name to the registered correspondence", () => {
		expect(resolveCorrespondence("resample")).toBe(correspondences.resample);
	});

	it("passes a function through unchanged", () => {
		const identity = (from: Polyline, to: Polyline) => ({ from, to });
		expect(resolveCorrespondence(identity)).toBe(identity);
	});

	it("falls back to resample for undefined", () => {
		expect(resolveCorrespondence(undefined)).toBe(correspondences.resample);
	});

	it("respects a custom fallback", () => {
		const custom = (from: Polyline, to: Polyline) => ({ from, to });
		expect(resolveCorrespondence(undefined, custom)).toBe(custom);
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() =>
			resolveCorrespondence("nonexistent" as unknown as "resample"),
		).toThrow(/Unknown correspondence "nonexistent"/);
	});

	it("a custom strategy is passed as a value, unchanged", () => {
		const mine = (from: Polyline, to: Polyline) => ({ from, to });
		expect(resolveCorrespondence(mine)).toBe(mine);
	});
});

describe("resampleCorrespondence", () => {
	it("produces equal-length outputs from differing input lengths", () => {
		const from: Polyline = [
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
		];
		const to: Polyline = [
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
		];
		const { from: a, to: b } = resampleCorrespondence({ samples: 8 })(from, to);
		expect(a.length).toBe(8);
		expect(b.length).toBe(8);
	});

	it("morphPolylines composes this with polylineInterpolator: t=0/t=1 land on the endpoints", () => {
		const from: Polyline = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		];
		const to: Polyline = [
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
		];
		const interp = morphPolylines(from, to, {
			samples: 2,
			correspondence: resampleCorrespondence({ samples: 2 }),
		});
		expectPointClose(interp(0)[0], from[0]);
		expectPointClose(interp(1)[0], to[0]);
	});
});

describe("morphPathData", () => {
	const xs = (rings: Polyline[]) => rings.flat().map((p) => p.x);

	it("is exactly the from-shape at t=0 and the to-shape at t=1", () => {
		const interp = morphPathData(
			"M0 0L10 0L10 10L0 10Z",
			"M20 20L30 20L30 30L20 30Z",
		);
		expect(Math.min(...xs(interp(0)))).toBeCloseTo(0, 9);
		expect(Math.max(...xs(interp(0)))).toBeCloseTo(10, 9);
		expect(Math.min(...xs(interp(1)))).toBeCloseTo(20, 9);
		expect(Math.max(...xs(interp(1)))).toBeCloseTo(30, 9);
	});

	it("clamps t outside [0,1]", () => {
		const interp = morphPathData(
			"M0 0L10 0L10 10L0 10Z",
			"M20 20L30 20L30 30L20 30Z",
		);
		expect(interp(-1)).toEqual(interp(0));
		expect(interp(2)).toEqual(interp(1));
	});

	it("keeps a hole a hole, and lets a ring with no partner grow in", () => {
		// A square, then a square with a square hole (wound the other way).
		const interp = morphPathData(
			"M0 0L10 0L10 10L0 10Z",
			"M0 0L10 0L10 10L0 10Z M3 3L3 7L7 7L7 3Z",
		);
		expect(interp(0)).toHaveLength(1);
		expect(interp(0.5)).toHaveLength(2);
		const [outer, hole] = interp(0.5);
		expect(Math.sign(area(outer))).toBe(-Math.sign(area(hole)));
		expect(Math.abs(area(hole))).toBeCloseTo(4, 5);
	});
});

/** Bernstein-basis evaluator — same independent check `path.test.ts` uses. */
function evalCubicAt(
	p0: Point,
	c1: Point,
	c2: Point,
	p1: Point,
	t: number,
): Point {
	const mt = 1 - t;
	const w0 = mt * mt * mt;
	const w1 = 3 * mt * mt * t;
	const w2 = 3 * mt * t * t;
	const w3 = t * t * t;
	return {
		x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
		y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
	};
}

function endPoint(curve: CurvePath): Point {
	if (curve.segments.length === 0) return curve.start;
	return curve.segments[curve.segments.length - 1].to;
}

function expectFiniteCurve(curve: CurvePath) {
	expect(Number.isFinite(curve.start.x)).toBe(true);
	expect(Number.isFinite(curve.start.y)).toBe(true);
	for (const seg of curve.segments) {
		expect(Number.isFinite(seg.to.x)).toBe(true);
		expect(Number.isFinite(seg.to.y)).toBe(true);
		expect(Number.isFinite(seg.c1.x)).toBe(true);
		expect(Number.isFinite(seg.c1.y)).toBe(true);
		expect(Number.isFinite(seg.c2.x)).toBe(true);
		expect(Number.isFinite(seg.c2.y)).toBe(true);
	}
}

describe("morphCurvePaths", () => {
	it("matching cubic-to-cubic: t=0 is a, t=1 is b, t=0.5 is the hand-computed midpoint", () => {
		const a: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				{
					c1: { x: 0, y: 10 },
					c2: { x: 10, y: 10 },
					to: { x: 10, y: 0 },
				},
			],
			closed: false,
		};
		const b: CurvePath = {
			start: { x: 20, y: 20 },
			segments: [
				{
					c1: { x: 20, y: 40 },
					c2: { x: 40, y: 40 },
					to: { x: 40, y: 20 },
				},
			],
			closed: false,
		};

		const at0 = morphCurvePaths(a, b, 0);
		expectPointClose(at0.start, a.start);
		expectPointClose(endPoint(at0), endPoint(a));

		const at1 = morphCurvePaths(a, b, 1);
		expectPointClose(at1.start, b.start);
		expectPointClose(endPoint(at1), endPoint(b));

		const mid = morphCurvePaths(a, b, 0.5);
		expectPointClose(mid.start, { x: 10, y: 10 });
		const seg = mid.segments[0];
		expectPointClose(seg.c1, { x: 10, y: 25 });
		expectPointClose(seg.c2, { x: 25, y: 25 });
		expectPointClose(seg.to, { x: 25, y: 10 });
	});

	it("matching line-to-line: simple linear lerp", () => {
		const a: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 })],
			closed: false,
		};
		const b: CurvePath = {
			start: { x: 0, y: 10 },
			segments: [lineSegment({ x: 0, y: 10 }, { x: 10, y: 10 })],
			closed: false,
		};

		const mid = morphCurvePaths(a, b, 0.5);
		expectPointClose(mid.start, { x: 0, y: 5 });
		const seg = mid.segments[0];
		expectPointClose(seg.to, { x: 10, y: 5 });
	});

	it("mismatched segment counts: endpoints still land correctly and output is well-formed", () => {
		const a: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				{
					c1: { x: 0, y: 10 },
					c2: { x: 10, y: 10 },
					to: { x: 10, y: 0 },
				},
			],
			closed: false,
		};
		const b: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 3, y: 3 }),
				lineSegment({ x: 3, y: 3 }, { x: 6, y: -3 }),
				lineSegment({ x: 6, y: -3 }, { x: 10, y: 0 }),
			],
			closed: false,
		};

		const at0 = morphCurvePaths(a, b, 0);
		expectFiniteCurve(at0);
		expect(at0.segments.length).toBeGreaterThanOrEqual(b.segments.length);
		expectPointClose(at0.start, a.start);
		expectPointClose(endPoint(at0), endPoint(a));

		const at1 = morphCurvePaths(a, b, 1);
		expectFiniteCurve(at1);
		expect(at1.segments.length).toBe(at0.segments.length);
		expectPointClose(at1.start, b.start);
		expectPointClose(endPoint(at1), endPoint(b));

		const mid = morphCurvePaths(a, b, 0.5);
		expectFiniteCurve(mid);
		expect(mid.segments.length).toBe(at0.segments.length);
	});

	it("straight-run side against a genuinely curved side at the same index: no throw, finite, endpoints land correctly", () => {
		// `a`'s segments are straight runs (collinear-thirds control points);
		// `b`'s are real curves. There's no more `line`/`cubic` type branch to
		// exercise — every `CurveSegment` is the same shape — so this just
		// confirms the plain per-control-point lerp handles that combination
		// correctly, same as any other pair of curves.
		const a: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 5, y: 0 }),
				lineSegment({ x: 5, y: 0 }, { x: 10, y: 0 }),
			],
			closed: false,
		};
		const b: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				{
					c1: { x: 0, y: 5 },
					c2: { x: 5, y: 5 },
					to: { x: 5, y: 0 },
				},
				{
					c1: { x: 5, y: -5 },
					c2: { x: 10, y: -5 },
					to: { x: 10, y: 0 },
				},
			],
			closed: false,
		};

		expect(() => morphCurvePaths(a, b, 0.5)).not.toThrow();
		const mid = morphCurvePaths(a, b, 0.5);
		expectFiniteCurve(mid);
		expect(mid.segments.length).toBe(2);

		const at0 = morphCurvePaths(a, b, 0);
		expectPointClose(at0.start, a.start);
		expectPointClose(endPoint(at0), endPoint(a));

		const at1 = morphCurvePaths(a, b, 1);
		expectPointClose(at1.start, b.start);
		// At t=1 the curve should trace exactly what `b` traces — verify via
		// direct Bernstein evaluation rather than raw equality.
		let cursor = at1.start;
		for (let i = 0; i < at1.segments.length; i++) {
			const seg = at1.segments[i];
			const bSeg = b.segments[i];
			for (const t of [0.25, 0.5, 0.75]) {
				expectPointClose(
					evalCubicAt(cursor, seg.c1, seg.c2, seg.to, t),
					evalCubicAt(cursor, bSeg.c1, bSeg.c2, bSeg.to, t),
				);
			}
			cursor = seg.to;
		}
	});

	it("closed mismatch: snaps to a's closed at t<1, b's closed at t=1 (matches morphPolylines taking one flag, not blending)", () => {
		const a: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 })],
			closed: true,
		};
		const b: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 })],
			closed: false,
		};

		expect(morphCurvePaths(a, b, 0).closed).toBe(true);
		expect(morphCurvePaths(a, b, 0.5).closed).toBe(true);
		expect(morphCurvePaths(a, b, 1).closed).toBe(false);
	});
});

describe("resampleCorrespondence closed edge cases", () => {
	const square: Polyline = [
		{ x: 0, y: 0 },
		{ x: 1, y: 0 },
		{ x: 1, y: 1 },
		{ x: 0, y: 1 },
	];

	it("a degenerate closed source yields equal vertex counts", () => {
		for (const src of [
			[{ x: 0, y: 0 }],
			[
				{ x: 2, y: 2 },
				{ x: 2, y: 2 },
			],
		]) {
			const { from, to } = resampleCorrespondence({ closed: true })(
				src,
				square,
			);
			expect(from.length).toBe(to.length);
		}
	});

	it("reverses a ring wound the opposite way when that is cheaper", () => {
		const reversed = [...square].reverse();
		const { from, to } = resampleCorrespondence({
			closed: true,
			samples: 5,
		})(square, reversed);
		let cost = 0;
		for (let i = 0; i < from.length; i++)
			cost += Math.hypot(from[i].x - to[i].x, from[i].y - to[i].y);
		expect(cost).toBeLessThan(1e-9);
	});
});

describe("closed morph keeps the target's corners", () => {
	it("circle -> square lands on all four corners", () => {
		const circle: Polyline = Array.from({ length: 65 }, (_, i) => ({
			x: 2 * Math.cos((i / 64) * Math.PI * 2),
			y: 2 * Math.sin((i / 64) * Math.PI * 2),
		}));
		const square: Polyline = [
			{ x: -1.8, y: -1.8 },
			{ x: 1.8, y: -1.8 },
			{ x: 1.8, y: 1.8 },
			{ x: -1.8, y: 1.8 },
			{ x: -1.8, y: -1.8 },
		];
		const end = morphPolylines(circle, square, { closed: true })(1);
		for (const corner of square) {
			expect(
				end.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-9),
			).toBe(true);
		}
	});
});

/** Shoelace signed area: positive one way round, negative the other. */
function area(ring: Polyline): number {
	let sum = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum / 2;
}

/** A square ring centred on (cx, cy), counter-clockwise unless `cw`. */
function square(cx: number, cy: number, r: number, cw = false): Polyline {
	const ring = [
		{ x: cx - r, y: cy - r },
		{ x: cx + r, y: cy - r },
		{ x: cx + r, y: cy + r },
		{ x: cx - r, y: cy + r },
		{ x: cx - r, y: cy - r },
	];
	return cw ? ring.reverse() : ring;
}

describe("closed-ring winding", () => {
	it("never reverses a ring wound the same way as its target", () => {
		// The outline of a `6` onto the outline of a `9` (from KaTeX_Main, thinned
		// out): both wind the same way, but the reversed alignment is cheaper,
		// and taking it flipped the ring, so the `9`'s counter filled solid.
		const ring = (points: number[][]) => points.map(([x, y]) => ({ x, y }));
		const from = ring([
			[0.45, 0.38],
			[0.2, 0.49],
			[0.36, 0.58],
			[0.55, 0.87],
			[0.31, 1.13],
			[0.05, 0.8],
			[0.33, 0.3],
			[0.51, 0.48],
			[0.4, 0.41],
			[0.45, 0.38],
		]);
		const to = ring([
			[0.81, 0.99],
			[0.95, 1.04],
			[0.96, 0.83],
			[0.69, 0.72],
			[0.77, 0.34],
			[1.08, 0.39],
			[1.09, 0.97],
			[0.75, 1.1],
			[0.78, 0.93],
			[0.81, 0.99],
		]);
		const morph = morphPolylines(from, to, { closed: true });
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			expect(Math.sign(area(morph(t)))).toBe(Math.sign(area(from)));
		}
	});

	it("reverses a ring wound the other way, so it does not turn inside out", () => {
		const morph = morphPolylines(square(0, 0, 1), square(0, 0, 2, true), {
			closed: true,
		});
		expect(Math.abs(area(morph(0.5)))).toBeGreaterThan(1);
	});
});

describe("morphRings", () => {
	it("pairs outlines with outlines and counters with counters, whatever the order", () => {
		const from = [square(0, 0, 2), square(0, 0, 1, true)];
		// The target lists its counter first.
		const to = [square(10, 0, 1, true), square(10, 0, 2)];
		const rings = morphRings(from, to);
		for (const t of [0, 0.5, 1]) {
			const signs = rings(t).map((ring) => Math.sign(area(ring)));
			expect(signs).toHaveLength(2);
			expect(new Set(signs).size).toBe(2);
		}
	});

	it("grows a counter with no partner from a point instead of popping it in", () => {
		const rings = morphRings(
			[square(0, 0, 2)],
			[square(0, 0, 2), square(0, 0, 1, true)],
		);
		expect(rings(0)).toHaveLength(1);
		const counter = (t: number) => rings(t)[1];
		expect(Math.abs(area(counter(0.5)))).toBeCloseTo(1, 5);
		expect(Math.abs(area(counter(1)))).toBeCloseTo(4, 5);
		expect(Math.sign(area(counter(0.5)))).toBe(-1);
	});
});

describe("closed morph has no kinks", () => {
	/** Signed turning angle at each vertex of a closed ring. */
	function turning(ring: Polyline): number[] {
		const points = ring.slice(0, -1);
		const n = points.length;
		const out: number[] = [];
		for (let i = 0; i < n; i++) {
			const a = points[(i - 1 + n) % n];
			const b = points[i];
			const c = points[(i + 1) % n];
			const u = { x: b.x - a.x, y: b.y - a.y };
			const v = { x: c.x - b.x, y: c.y - b.y };
			if (Math.hypot(u.x, u.y) < 1e-12 || Math.hypot(v.x, v.y) < 1e-12)
				continue;
			out.push(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y));
		}
		return out;
	}

	/** A circle whose vertices bunch up on one side, as a flattened glyph's do. */
	function unevenCircle(r: number, n: number): Polyline {
		const out: Polyline = [];
		for (let i = 0; i < n; i++) {
			const s = i / n;
			const angle = 2 * Math.PI * (s + 0.12 * Math.sin(2 * Math.PI * s));
			out.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
		}
		out.push({ ...out[0] });
		return out;
	}

	function hexagon(r: number): Polyline {
		const out: Polyline = [];
		for (let i = 0; i < 6; i++) {
			const angle = Math.PI / 6 + (i * Math.PI) / 3;
			out.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
		}
		out.push({ ...out[0] });
		return out;
	}

	const squareRing: Polyline = [
		{ x: -1, y: -1 },
		{ x: 1, y: -1 },
		{ x: 1, y: 1 },
		{ x: -1, y: 1 },
		{ x: -1, y: -1 },
	];

	// Two convex shapes blend through convex ones: any vertex turning against
	// the ring's own direction is a dent neither shape has. Resampling each
	// ring on its own paired them at a speed that jumped at every vertex, and
	// left a dozen such dents per frame.
	it.each([
		["square → uneven circle", squareRing, unevenCircle(1.2, 90)],
		["uneven circle → hexagon", unevenCircle(1, 70), hexagon(1.3)],
		["square → hexagon", squareRing, hexagon(1.3)],
	])("%s stays convex mid-morph", (_, from, to) => {
		const morph = morphPolylines(from, to, { closed: true });
		for (const t of [0.25, 0.5, 0.75]) {
			const angles = turning(morph(t));
			const direction = Math.sign(angles.reduce((sum, a) => sum + a, 0));
			const dents = angles.filter((a) => Math.sign(a) === -direction);
			expect(dents.filter((a) => Math.abs(a) > 1e-6)).toHaveLength(0);
		}
	});

	it("still lands on every corner of both shapes", () => {
		const from = unevenCircle(1, 70);
		const to = hexagon(1.3);
		const morph = morphPolylines(from, to, { closed: true });
		for (const [ring, t] of [
			[from, 0],
			[to, 1],
		] as const) {
			const end = morph(t);
			for (const corner of ring)
				expect(
					end.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-9),
				).toBe(true);
		}
	});
});
