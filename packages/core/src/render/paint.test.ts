import { describe, expect, it } from "vitest";
import type { CurvePath } from "../geometry/index.js";
import { lineSegment } from "../geometry/index.js";
import { tracePath, tracePolyline } from "./paint.js";

/** Records path calls without needing a real canvas. */
function mockCtx() {
	const calls: Array<{ op: string; args: number[] }> = [];
	const ctx = {
		moveTo(x: number, y: number) {
			calls.push({ op: "moveTo", args: [x, y] });
		},
		lineTo(x: number, y: number) {
			calls.push({ op: "lineTo", args: [x, y] });
		},
		bezierCurveTo(
			c1x: number,
			c1y: number,
			c2x: number,
			c2y: number,
			x: number,
			y: number,
		) {
			calls.push({ op: "bezierCurveTo", args: [c1x, c1y, c2x, c2y, x, y] });
		},
		closePath() {
			calls.push({ op: "closePath", args: [] });
		},
	} as unknown as CanvasRenderingContext2D;
	return { ctx, calls };
}

describe("tracePath", () => {
	it("does nothing for a path with no segments", () => {
		const { ctx, calls } = mockCtx();
		tracePath(ctx, { start: { x: 0, y: 0 }, segments: [], closed: false });
		expect(calls).toEqual([]);
	});

	it("moves to start, then emits one bezierCurveTo per segment, straight or curved", () => {
		const { ctx, calls } = mockCtx();
		const path: CurvePath = {
			start: { x: 0, y: 0 },
			segments: [
				lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }),
				{
					c1: { x: 10, y: 5 },
					c2: { x: 20, y: 5 },
					to: { x: 20, y: 0 },
				},
			],
			closed: false,
		};
		tracePath(ctx, path);
		expect(calls[0]).toEqual({ op: "moveTo", args: [0, 0] });
		expect(calls[1].op).toBe("bezierCurveTo");
		expect(calls[1].args[0]).toBeCloseTo(10 / 3, 10);
		expect(calls[1].args[1]).toBeCloseTo(0, 10);
		expect(calls[1].args[2]).toBeCloseTo(20 / 3, 10);
		expect(calls[1].args[3]).toBeCloseTo(0, 10);
		expect(calls[1].args[4]).toBeCloseTo(10, 10);
		expect(calls[1].args[5]).toBeCloseTo(0, 10);
		expect(calls[2]).toEqual({
			op: "bezierCurveTo",
			args: [10, 5, 20, 5, 20, 0],
		});
	});

	it("closes the path when closed is true", () => {
		const { ctx, calls } = mockCtx();
		tracePath(ctx, {
			start: { x: 0, y: 0 },
			segments: [lineSegment({ x: 0, y: 0 }, { x: 1, y: 1 })],
			closed: true,
		});
		expect(calls[calls.length - 1]).toEqual({ op: "closePath", args: [] });
	});

	it("an all-line CurvePath's bezierCurveTo calls reproduce the straight path exactly", () => {
		// An all-line path does call bezierCurveTo: every segment is a
		// cubic, including straight ones, via the collinear-thirds control
		// points `lineSegment` builds. The real invariant to check is that
		// those control points still trace the exact straight line: evaluate
		// the Bernstein form at a few `t` and confirm it lands on the segment
		// between the anchor points.
		const { ctx, calls } = mockCtx();
		const from = { x: 0, y: 0 };
		const mid = { x: 1, y: 0 };
		const to = { x: 1, y: 1 };
		tracePath(ctx, {
			start: from,
			segments: [lineSegment(from, mid), lineSegment(mid, to)],
			closed: false,
		});
		expect(
			calls.every((c) => c.op === "moveTo" || c.op === "bezierCurveTo"),
		).toBe(true);

		const evalCubicAt = (
			p0: { x: number; y: number },
			c1x: number,
			c1y: number,
			c2x: number,
			c2y: number,
			p1: { x: number; y: number },
			t: number,
		) => {
			const mt = 1 - t;
			const w0 = mt * mt * mt;
			const w1 = 3 * mt * mt * t;
			const w2 = 3 * mt * t * t;
			const w3 = t * t * t;
			return {
				x: w0 * p0.x + w1 * c1x + w2 * c2x + w3 * p1.x,
				y: w0 * p0.y + w1 * c1y + w2 * c2y + w3 * p1.y,
			};
		};

		const first = calls[1];
		const second = calls[2];
		expect(first.op).toBe("bezierCurveTo");
		expect(second.op).toBe("bezierCurveTo");
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			const p = evalCubicAt(
				from,
				first.args[0],
				first.args[1],
				first.args[2],
				first.args[3],
				mid,
				t,
			);
			// Straight run from (0,0) to (1,0): y stays 0, x is linear in t.
			expect(p.y).toBeCloseTo(0, 10);
			expect(p.x).toBeCloseTo(t, 10);

			const q = evalCubicAt(
				mid,
				second.args[0],
				second.args[1],
				second.args[2],
				second.args[3],
				to,
				t,
			);
			// Straight run from (1,0) to (1,1): x stays 1, y is linear in t.
			expect(q.x).toBeCloseTo(1, 10);
			expect(q.y).toBeCloseTo(t, 10);
		}
	});
});

describe("tracePolyline", () => {
	it("does nothing for fewer than 2 points", () => {
		const { ctx, calls } = mockCtx();
		tracePolyline(ctx, [{ x: 0, y: 0 }]);
		expect(calls).toEqual([]);
	});

	it("moves to the first point then lines to the rest", () => {
		const { ctx, calls } = mockCtx();
		tracePolyline(ctx, [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		]);
		expect(calls).toEqual([
			{ op: "moveTo", args: [0, 0] },
			{ op: "lineTo", args: [1, 0] },
			{ op: "lineTo", args: [1, 1] },
		]);
	});

	it("closes when requested", () => {
		const { ctx, calls } = mockCtx();
		tracePolyline(
			ctx,
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
			],
			true,
		);
		expect(calls[calls.length - 1]).toEqual({ op: "closePath", args: [] });
	});
});
