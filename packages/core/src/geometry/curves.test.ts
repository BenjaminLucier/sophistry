import { describe, expect, it } from "vitest";
import type { CurveKind } from "./curves.js";
import {
	areaCurvePath,
	clipClosedCurvePathToX,
	clipCurvePathToX,
	closedCurvePath,
	curvePath,
	reverseCurvePath,
} from "./curves.js";
import { curvePathToPolyline, polylineToCurvePath } from "./path/svg-path.js";
import type { CurvePath, Point } from "./path/types.js";

const DATA: Point[] = [
	{ x: 0, y: 0 },
	{ x: 1, y: 3 },
	{ x: 2, y: 3.2 },
	{ x: 3, y: 0.5 },
	{ x: 4, y: 1 },
	{ x: 6, y: 5 },
];

const SMOOTH: CurveKind[] = ["monotone", "natural", "catmull-rom"];

/** Every segment's end point, the start first. */
function knots(path: CurvePath): Point[] {
	return [path.start, ...path.segments.map((s) => s.to)];
}

describe("curvePath", () => {
	it('is polylineToCurvePath under "linear"', () => {
		expect(curvePath(DATA)).toEqual(polylineToCurvePath(DATA, false));
		expect(curvePath(DATA, "linear")).toEqual(polylineToCurvePath(DATA, false));
	});

	it.each(SMOOTH)("%s passes through every point", (curve) => {
		const path = curvePath(DATA, curve);
		expect(path.segments).toHaveLength(DATA.length - 1);
		knots(path).forEach((p, i) => {
			expect(p.x).toBeCloseTo(DATA[i].x, 12);
			expect(p.y).toBeCloseTo(DATA[i].y, 12);
		});
		expect(path.closed).toBe(false);
	});

	it.each(SMOOTH)("%s is smooth: tangents match across each point", (curve) => {
		const { segments, start } = curvePath(DATA, curve);
		for (let i = 0; i < segments.length - 1; i++) {
			const at = segments[i].to;
			const inn = { x: at.x - segments[i].c2.x, y: at.y - segments[i].c2.y };
			const out = {
				x: segments[i + 1].c1.x - at.x,
				y: segments[i + 1].c1.y - at.y,
			};
			// Parallel (cross product zero), same direction.
			expect(inn.x * out.y - inn.y * out.x).toBeCloseTo(0, 9);
			expect(inn.x * out.x + inn.y * out.y).toBeGreaterThanOrEqual(0);
		}
		expect(start).toEqual(DATA[0]);
	});

	it("monotone never overshoots: each segment stays within its ends' y", () => {
		const spiky: Point[] = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1.2, y: 10 },
			{ x: 3, y: 10 },
			{ x: 3.1, y: 2 },
			{ x: 7, y: 2.5 },
		];
		const path = curvePath(spiky, "monotone");
		let from = path.start;
		for (const segment of path.segments) {
			const lo = Math.min(from.y, segment.to.y) - 1e-12;
			const hi = Math.max(from.y, segment.to.y) + 1e-12;
			const line = curvePathToPolyline({
				start: from,
				segments: [segment],
				closed: false,
			});
			for (const p of line) {
				expect(p.y).toBeGreaterThanOrEqual(lo);
				expect(p.y).toBeLessThanOrEqual(hi);
			}
			// x stays monotone too: the curve is a function of x.
			for (let i = 1; i < line.length; i++)
				expect(line[i].x).toBeGreaterThanOrEqual(line[i - 1].x - 1e-12);
			from = segment.to;
		}
		// A flat stretch stays flat.
		expect(path.segments[0].c1.y).toBe(0);
		expect(path.segments[0].c2.y).toBe(0);
	});

	it("natural and catmull-rom can overshoot where monotone does not", () => {
		const step: Point[] = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 1 },
			{ x: 3, y: 1 },
		];
		const maxY = (curve: CurveKind) =>
			Math.max(...curvePathToPolyline(curvePath(step, curve)).map((p) => p.y));
		expect(maxY("natural")).toBeGreaterThan(1);
		expect(maxY("monotone")).toBeLessThanOrEqual(1);
	});

	it("matches d3-shape's monotoneX on a known run", () => {
		// d3.line().curve(d3.curveMonotoneX)([[0,0],[1,1],[2,0]]):
		// "M0,0C0.333,0.5,0.667,1,1,1C1.333,1,1.667,0.5,2,0"
		const path = curvePath(
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
				{ x: 2, y: 0 },
			],
			"monotone",
		);
		const [a, b] = path.segments;
		expect(a.c1.x).toBeCloseTo(1 / 3, 12);
		expect(a.c1.y).toBeCloseTo(0.5, 12);
		expect(a.c2.y).toBeCloseTo(1, 12);
		expect(b.c1.y).toBeCloseTo(1, 12);
		expect(b.c2.y).toBeCloseTo(0.5, 12);
	});

	it("steps put their corners where each variant says", () => {
		const pts: Point[] = [
			{ x: 0, y: 1 },
			{ x: 2, y: 3 },
			{ x: 4, y: 2 },
		];
		expect(knots(curvePath(pts, "step-after"))).toEqual([
			{ x: 0, y: 1 },
			{ x: 2, y: 1 },
			{ x: 2, y: 3 },
			{ x: 4, y: 3 },
			{ x: 4, y: 2 },
		]);
		expect(knots(curvePath(pts, "step-before"))).toEqual([
			{ x: 0, y: 1 },
			{ x: 0, y: 3 },
			{ x: 2, y: 3 },
			{ x: 2, y: 2 },
			{ x: 4, y: 2 },
		]);
		expect(knots(curvePath(pts, "step"))).toEqual([
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 3 },
			{ x: 2, y: 3 },
			{ x: 3, y: 3 },
			{ x: 3, y: 2 },
			{ x: 4, y: 2 },
		]);
	});

	it.each([...SMOOTH, "step", "step-before", "step-after"] as CurveKind[])(
		"%s handles 0, 1 and 2 points",
		(curve) => {
			expect(curvePath([], curve).segments).toEqual([]);
			const one = curvePath([{ x: 1, y: 2 }], curve);
			expect(one.start).toEqual({ x: 1, y: 2 });
			expect(one.segments).toEqual([]);
			const two = curvePath(
				[
					{ x: 0, y: 0 },
					{ x: 3, y: 3 },
				],
				curve,
			);
			const ends = knots(two);
			expect(ends[0]).toEqual({ x: 0, y: 0 });
			expect(ends[ends.length - 1]).toEqual({ x: 3, y: 3 });
			if (!curve.startsWith("step"))
				expect(two).toEqual(
					polylineToCurvePath(
						[
							{ x: 0, y: 0 },
							{ x: 3, y: 3 },
						],
						false,
					),
				);
		},
	);
});

describe("reverseCurvePath", () => {
	it("traces the same curve backwards, exactly", () => {
		const path = curvePath(DATA, "catmull-rom");
		const back = reverseCurvePath(path);
		expect(back.start).toEqual(DATA[DATA.length - 1]);
		expect(knots(back)).toEqual([...knots(path)].reverse());
		expect(reverseCurvePath(back)).toEqual(path);
	});
});

describe("areaCurvePath", () => {
	it("shares each boundary's curve exactly with a neighbour", () => {
		const mid = DATA.map((p) => ({ x: p.x, y: p.y + 2 }));
		const top = DATA.map((p) => ({ x: p.x, y: p.y + 5 }));
		const lowerBand = areaCurvePath(mid, DATA, "monotone");
		const upperBand = areaCurvePath(top, mid, "monotone");
		const n = DATA.length - 1;
		// The lower band's top edge is its first n segments; the upper band's
		// bottom edge is its last n, traced back.
		const lowerTop: CurvePath = {
			start: lowerBand.start,
			segments: lowerBand.segments.slice(0, n),
			closed: false,
		};
		const upperBottom: CurvePath = {
			start: upperBand.segments[n].to,
			segments: upperBand.segments.slice(n + 1),
			closed: false,
		};
		expect(reverseCurvePath(upperBottom)).toEqual(lowerTop);
		expect(lowerBand.closed).toBe(true);
	});

	it("pairs step corners on both boundaries", () => {
		const xs = [0, 1, 2];
		const area = areaCurvePath(
			xs.map((x) => ({ x, y: x + 2 })),
			xs.map((x) => ({ x, y: x })),
			"step-after",
		);
		const ring = curvePathToPolyline(area);
		const cornerXs = [...new Set(ring.map((p) => p.x))].sort();
		expect(cornerXs).toEqual([0, 1, 2]);
	});
});

describe("closedCurvePath", () => {
	it("closes a catmull-rom ring smoothly through every vertex", () => {
		const square: Point[] = [
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: -1, y: 0 },
			{ x: 0, y: -1 },
		];
		const ring = closedCurvePath(square, "catmull-rom");
		expect(ring.closed).toBe(true);
		expect(ring.segments).toHaveLength(4);
		expect(ring.segments[3].to).toEqual(square[0]);
		// Bulges outward past the straight edge's midpoint.
		const flat = curvePathToPolyline(ring);
		expect(Math.max(...flat.map((p) => Math.hypot(p.x, p.y)))).toBeCloseTo(
			1,
			6,
		);
		expect(Math.min(...flat.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(
			Math.SQRT1_2,
		);
		expect(closedCurvePath(square)).toEqual(polylineToCurvePath(square, true));
	});
});

describe("clipCurvePathToX", () => {
	it("cuts the curve at the front instead of straightening it", () => {
		const path = curvePath(DATA, "natural");
		const [piece] = clipCurvePathToX(path, 2.5);
		const flat = curvePathToPolyline(piece);
		const whole = curvePathToPolyline(path, 1e-8);
		expect(Math.max(...flat.map((p) => p.x))).toBeCloseTo(2.5, 9);
		// The kept part retraces the curve: points of the cut agree with the whole.
		expect(piece.segments.slice(0, 2)).toEqual(path.segments.slice(0, 2));
		const end = piece.segments[piece.segments.length - 1].to;
		const i = whole.findIndex((p) => p.x > 2.5);
		const [a, b] = [whole[i - 1], whole[i]];
		const y = a.y + ((b.y - a.y) * (2.5 - a.x)) / (b.x - a.x);
		expect(end.x).toBe(2.5);
		expect(end.y).toBeCloseTo(y, 2);
	});

	it("keeps everything left of the far end, nothing left of the start", () => {
		const path = curvePath(DATA, "monotone");
		expect(clipCurvePathToX(path, 10)).toEqual([path]);
		expect(clipCurvePathToX(path, -1)).toEqual([]);
	});

	it("splits a curve that doubles back into pieces", () => {
		const loop = curvePath(
			[
				{ x: 0, y: 0 },
				{ x: 4, y: 1 },
				{ x: 0, y: 2 },
				{ x: 4, y: 3 },
			],
			"linear",
		);
		// Out past the cut and back: the second and third legs meet at x = 0.
		expect(clipCurvePathToX(loop, 2)).toHaveLength(2);
	});
});

describe("clipClosedCurvePathToX", () => {
	it("cuts an area to a straight front with curved edges", () => {
		const area = areaCurvePath(
			DATA.map((p) => ({ x: p.x, y: p.y + 2 })),
			DATA,
			"catmull-rom",
		);
		const cut = clipClosedCurvePathToX(area, 3);
		expect(cut?.closed).toBe(true);
		const flat = curvePathToPolyline(cut as CurvePath);
		expect(Math.max(...flat.map((p) => p.x))).toBeCloseTo(3, 9);
		expect(flat.filter((p) => Math.abs(p.x - 3) < 1e-9).length).toBeGreaterThan(
			1,
		);
		expect(clipClosedCurvePathToX(area, -1)).toBeUndefined();
	});
});
