/**
 * Tests for the drawing half of `canvas-renderer.ts` — `paintSpecs`/`drawShape`,
 * plus (further down) `createCanvasRenderer`'s multi-camera/focus-ring chrome.
 *
 * Uses the same canvas-mocking approach as `paint.test.ts`: a plain object
 * recording calls, no real canvas or DOM. Specs are built by hand, the same
 * way `compile.test.ts` builds them, since a scene graph is not wanted
 * here.
 *
 * **This file is the safety net for the polyline/curve dual-representation
 * collapse.** Every assertion here pins an *exact* sequence of draw calls —
 * not just "a fill happened" but which primitive, with which arguments, in
 * which order relative to style setters and save/restore. That is deliberate:
 * the refactor this suite guards is allowed to change *how* the renderer gets
 * to a picture (one geometry-source abstraction instead of three independent
 * `spec.curvePaths ?` branches) but not the picture itself, and a draw-call
 * sequence is the least ambiguous stand-in for "the picture" available
 * without an actual canvas. If a case here ever needs its assertions changed,
 * that is a behaviour change, not a refactor, and must be justified.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { CurvePath, Polyline } from "../geometry/index.js";
import { lineSegment } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import type {
	ClipRegion,
	LinearGradientPaint,
	ShapeSpec,
	StrokeStyle,
	TextSpec,
	TextStyle,
} from "../spec/types.js";
import type { Theme } from "../themes/index.js";
import { resolveTheme } from "../themes/index.js";
import type { CameraView } from "./camera.js";
import { createCanvasRenderer, paintSpecs } from "./canvas-renderer.js";
import type { PaintCache } from "./paint.js";
import { createPaintCache } from "./paint.js";
import type { PaintHost } from "./test-host.js";
import { createPaintHost } from "./test-host.js";

type Call = { op: string; args: unknown[] };

/** A `CanvasGradient` stub: something with the right shape, distinguishable by identity. */
function fakeGradient(kind: string) {
	const stops: Array<{ offset: number; color: string }> = [];
	return {
		kind,
		stops,
		addColorStop(offset: number, color: string) {
			stops.push({ offset, color });
		},
	};
}

/**
 * Records the ordered sequence of every draw call and style-setter write a
 * `CanvasRenderingContext2D` can receive from this renderer — path ops,
 * fill/stroke, save/restore/setTransform/clip, and the style setters
 * (`strokeStyle`/`fillStyle`/`lineWidth`/`globalAlpha`/dash/cap/join/text) —
 * plus gradient construction, so paint-cache identity can be asserted on.
 */
function mockCtx() {
	const calls: Call[] = [];
	const strokeStyles: unknown[] = [];
	const fillStyles: unknown[] = [];
	const gradients: { linear: number; radial: number } = {
		linear: 0,
		radial: 0,
	};
	let letterSpacingValue: unknown;
	let fontValue: unknown;
	const ctx = {
		save() {
			calls.push({ op: "save", args: [] });
		},
		restore() {
			calls.push({ op: "restore", args: [] });
		},
		beginPath() {
			calls.push({ op: "beginPath", args: [] });
		},
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
		rect(x: number, y: number, w: number, h: number) {
			calls.push({ op: "rect", args: [x, y, w, h] });
		},
		clip() {
			calls.push({ op: "clip", args: [] });
		},
		stroke(path?: unknown) {
			calls.push({ op: "stroke", args: path === undefined ? [] : [path] });
		},
		fill(path?: unknown) {
			calls.push({ op: "fill", args: path === undefined ? [] : [path] });
		},
		strokeRect(x: number, y: number, w: number, h: number) {
			calls.push({ op: "strokeRect", args: [x, y, w, h] });
		},
		fillRect(x: number, y: number, w: number, h: number) {
			calls.push({ op: "fillRect", args: [x, y, w, h] });
		},
		clearRect(x: number, y: number, w: number, h: number) {
			calls.push({ op: "clearRect", args: [x, y, w, h] });
		},
		setTransform(
			a: number,
			b: number,
			c: number,
			d: number,
			e: number,
			f: number,
		) {
			calls.push({ op: "setTransform", args: [a, b, c, d, e, f] });
		},
		translate(x: number, y: number) {
			calls.push({ op: "translate", args: [x, y] });
		},
		rotate(angle: number) {
			calls.push({ op: "rotate", args: [angle] });
		},
		setLineDash(dash: number[]) {
			calls.push({ op: "setLineDash", args: [...dash] });
		},
		fillText(text: string, x: number, y: number) {
			calls.push({ op: "fillText", args: [text, x, y] });
		},
		strokeText(text: string, x: number, y: number) {
			calls.push({ op: "strokeText", args: [text, x, y] });
		},
		measureText(_text: string) {
			return { width: 40 } as TextMetrics;
		},
		createLinearGradient() {
			gradients.linear++;
			return fakeGradient("linear") as unknown as CanvasGradient;
		},
		createRadialGradient() {
			gradients.radial++;
			return fakeGradient("radial") as unknown as CanvasGradient;
		},
		set strokeStyle(v: unknown) {
			strokeStyles.push(v);
			calls.push({ op: "set:strokeStyle", args: [v] });
		},
		set fillStyle(v: unknown) {
			fillStyles.push(v);
			calls.push({ op: "set:fillStyle", args: [v] });
		},
		set lineWidth(v: number) {
			calls.push({ op: "set:lineWidth", args: [v] });
		},
		set lineCap(v: unknown) {
			calls.push({ op: "set:lineCap", args: [v] });
		},
		set lineJoin(v: unknown) {
			calls.push({ op: "set:lineJoin", args: [v] });
		},
		set globalAlpha(v: number) {
			calls.push({ op: "set:globalAlpha", args: [v] });
		},
		set lineDashOffset(v: number) {
			calls.push({ op: "set:lineDashOffset", args: [v] });
		},
		set textAlign(v: unknown) {
			calls.push({ op: "set:textAlign", args: [v] });
		},
		set textBaseline(v: unknown) {
			calls.push({ op: "set:textBaseline", args: [v] });
		},
		set font(v: unknown) {
			fontValue = v;
			calls.push({ op: "set:font", args: [v] });
		},
		get font() {
			return fontValue as string;
		},
		set letterSpacing(v: unknown) {
			letterSpacingValue = v;
			calls.push({ op: "set:letterSpacing", args: [v] });
		},
		get letterSpacing() {
			return letterSpacingValue as string;
		},
	} as unknown as CanvasRenderingContext2D;
	return { ctx, calls, strokeStyles, fillStyles, gradients };
}

const style: StrokeStyle = {
	stroke: "#000000",
	strokeWidth: 2,
	fill: null,
	along: null,
	opacity: 1,
	fillOpacity: 1,
	lineCap: "round",
	lineJoin: "round",
	dash: null,
	dashOffset: 0,
};

let nextId = 1;

function shapeSpec(options: {
	polylines?: ShapeSpec["polylines"];
	curvePaths?: CurvePath[];
	closed?: boolean;
	progress?: number;
	fillFrom?: number;
	write?: ShapeSpec["write"];
	style?: Partial<StrokeStyle>;
	clip?: ShapeSpec["clip"];
}): ShapeSpec {
	return {
		kind: "shape",
		id: nextId++,
		zIndex: 0,
		polylines: options.polylines ?? [
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			],
		],
		closed: options.closed ?? false,
		fillFrom: options.fillFrom ?? 0,
		write: options.write,
		curvePaths: options.curvePaths,
		style: { ...style, ...options.style },
		progress: options.progress ?? 1,
		...(options.clip ? { clip: options.clip } : {}),
	};
}

const straightCurve: CurvePath = {
	start: { x: 0, y: 0 },
	segments: [lineSegment({ x: 0, y: 0 }, { x: 10, y: 0 })],
	closed: false,
};

const bezierCurve: CurvePath = {
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

function run(spec: ShapeSpec) {
	const { ctx, calls } = mockCtx();
	const cache = new Map();
	const paints: PaintCache = createPaintCache();
	paintSpecs(ctx, [spec], cache, paints);
	return calls;
}

function runFull(spec: ShapeSpec) {
	const { ctx, calls, strokeStyles, fillStyles, gradients } = mockCtx();
	const cache = new Map();
	const paints: PaintCache = createPaintCache();
	paintSpecs(ctx, [spec], cache, paints);
	return { calls, strokeStyles, fillStyles, gradients };
}

function runAlong(spec: ShapeSpec) {
	const { ctx, calls, strokeStyles } = mockCtx();
	const cache = new Map();
	const paints: PaintCache = createPaintCache();
	paintSpecs(ctx, [spec], cache, paints);
	return { calls, strokeStyles };
}

const defaultTheme = resolveTheme({ mode: "dark" });

describe("drawShape with curvePaths", () => {
	it("draws via bezierCurveTo (not just lineTo) at progress = 1", () => {
		const calls = run(shapeSpec({ curvePaths: [bezierCurve], progress: 1 }));
		expect(calls.some((c) => c.op === "bezierCurveTo")).toBe(true);
		// The final control point/endpoint of the untrimmed curve should appear
		// exactly — proof the full (not sliced) curve was traced.
		expect(calls).toContainEqual({
			op: "bezierCurveTo",
			args: [0, 10, 10, 10, 10, 0],
		});
	});

	it("at partial progress, traces a genuinely sliced curve (not the full one)", () => {
		const calls = run(shapeSpec({ curvePaths: [bezierCurve], progress: 0.5 }));
		const bez = calls.find((c) => c.op === "bezierCurveTo");
		expect(bez).toBeDefined();
		// A half-reveal must not reproduce the untrimmed curve's endpoint.
		expect(bez?.args).not.toEqual([0, 10, 10, 10, 10, 0]);
	});

	it("a straight-line CurveSegment reveals via bezierCurveTo, reproducing the trimmed straight line exactly", () => {
		// Every `CurveSegment` is a cubic now, straight runs included (see
		// `CurveSegment`'s doc comment) — `tracePath` has no `lineTo` branch
		// left, so a straight-edge reveal calls `bezierCurveTo` too. What still
		// has to hold is that the emitted curve traces a straight line: at
		// progress 0.5 the trimmed segment should end at the curve's midpoint.
		const calls = run(
			shapeSpec({ curvePaths: [straightCurve], progress: 0.5 }),
		);
		expect(calls.some((c) => c.op === "lineTo")).toBe(false);
		const bez = calls.find((c) => c.op === "bezierCurveTo");
		expect(bez).toBeDefined();
		expect(bez?.args[4]).toBeCloseTo(5, 6);
		expect(bez?.args[5]).toBeCloseTo(0, 6);
	});

	it("fills via the curve-native path when closed and filled", () => {
		const calls = run(
			shapeSpec({
				curvePaths: [bezierCurve],
				closed: true,
				style: { fill: "#ff0000" },
			}),
		);
		expect(calls.some((c) => c.op === "bezierCurveTo")).toBe(true);
		expect(calls.some((c) => c.op === "fill")).toBe(true);
	});
});

describe("strokeAlong", () => {
	it("polyline path: strokes one band per colour, at the expected arc-length boundary", () => {
		const spec = shapeSpec({
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
			],
			style: { along: { colors: ["red", "blue"], scope: "shape" } },
		});
		const { calls, strokeStyles } = runAlong(spec);

		expect(calls.some((c) => c.op === "bezierCurveTo")).toBe(false);
		expect(strokeStyles.slice(-2)).toEqual(["red", "blue"]);

		const lineTos = calls.filter((c) => c.op === "lineTo");
		expect(lineTos).toHaveLength(2);
		// Two equal-length colours over a length-10 line split at the midpoint.
		expect((lineTos[0].args as number[])[0]).toBeCloseTo(5, 6);
		expect((lineTos[1].args as number[])[0]).toBeCloseTo(10, 6);
	});

	it("curve path: strokes one band per colour via bezierCurveTo, reusing the curve reveal cache", () => {
		const spec = shapeSpec({
			curvePaths: [straightCurve],
			style: { along: { colors: ["red", "blue"], scope: "shape" } },
		});
		const { calls, strokeStyles } = runAlong(spec);

		expect(calls.some((c) => c.op === "lineTo")).toBe(false);
		expect(strokeStyles.slice(-2)).toEqual(["red", "blue"]);

		const bez = calls.filter((c) => c.op === "bezierCurveTo");
		expect(bez).toHaveLength(2);
		// Same length-10 straight curve, same midpoint boundary as the polyline
		// case above — the band math is identical, only the primitives differ.
		expect((bez[0].args as number[])[4]).toBeCloseTo(5, 6);
		expect((bez[0].args as number[])[5]).toBeCloseTo(0, 6);
		expect((bez[1].args as number[])[4]).toBeCloseTo(10, 6);
		expect((bez[1].args as number[])[5]).toBeCloseTo(0, 6);
	});

	it("curve path: a partial reveal clips the bands to the revealed budget", () => {
		const spec = shapeSpec({
			curvePaths: [straightCurve],
			progress: 0.5,
			style: { along: { colors: ["red", "blue"], scope: "shape" } },
		});
		const { calls, strokeStyles } = runAlong(spec);

		// Only the first colour's band is within the 50% reveal budget.
		expect(strokeStyles.slice(-1)).toEqual(["red"]);
		const bez = calls.filter((c) => c.op === "bezierCurveTo");
		expect(bez).toHaveLength(1);
		expect((bez[0].args as number[])[4]).toBeCloseTo(5, 6);
	});

	it("polyline path: scope 'polyline' restarts the colour list on each part", () => {
		const spec = shapeSpec({
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
				[
					{ x: 0, y: 100 },
					{ x: 10, y: 100 },
				],
			],
			style: { along: { colors: ["red", "blue"], scope: "polyline" } },
		});
		const { strokeStyles } = runAlong(spec);
		// Each of the two polylines gets the full ["red", "blue"] pair, rather
		// than the pair being spent once across both parts. (The leading entry
		// is `applyStrokeStyle`'s initial set of the base `style.stroke`, before
		// `strokeAlong` overrides it band by band.)
		expect(strokeStyles.slice(1)).toEqual(["red", "blue", "red", "blue"]);
	});
});

describe("drawShape without curvePaths (unchanged polyline path)", () => {
	it("never calls bezierCurveTo — only moveTo/lineTo — at progress = 1", () => {
		const calls = run(
			shapeSpec({
				polylines: [
					[
						{ x: 0, y: 0 },
						{ x: 10, y: 0 },
						{ x: 10, y: 10 },
					],
				],
				progress: 1,
			}),
		);
		expect(calls.some((c) => c.op === "bezierCurveTo")).toBe(false);
		expect(calls.some((c) => c.op === "moveTo")).toBe(true);
		expect(calls.some((c) => c.op === "lineTo")).toBe(true);
	});

	it("reveals a partial polyline via lineTo", () => {
		const calls = run(
			shapeSpec({
				polylines: [
					[
						{ x: 0, y: 0 },
						{ x: 10, y: 0 },
					],
				],
				progress: 0.5,
			}),
		);
		expect(calls.some((c) => c.op === "bezierCurveTo")).toBe(false);
		const lineTo = calls.find((c) => c.op === "lineTo");
		expect(lineTo?.args).toEqual([5, 0]);
	});
});

describe("reveal-progress matrix (0, mid-fractions, 1; single and multi-part)", () => {
	const twoParts: Polyline[] = [
		[
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		],
		[
			{ x: 0, y: 100 },
			{ x: 10, y: 100 },
		],
	];
	const twoPartsCurve: CurvePath[] = [straightCurve, bezierCurve];

	it("progress 0: beginPath and stroke happen (after the style setup), but no geometry is traced (polyline)", () => {
		const calls = run(shapeSpec({ polylines: twoParts, progress: 0 }));
		expect(calls.map((c) => c.op)).toEqual([
			"save",
			"set:strokeStyle",
			"set:lineWidth",
			"set:lineCap",
			"set:lineJoin",
			"set:globalAlpha",
			"setLineDash",
			"beginPath",
			"stroke",
			"restore",
		]);
		expect(calls.some((c) => c.op === "moveTo" || c.op === "lineTo")).toBe(
			false,
		);
	});

	it("progress 0: beginPath and stroke happen, but no geometry is traced (curve)", () => {
		const calls = run(shapeSpec({ curvePaths: twoPartsCurve, progress: 0 }));
		expect(
			calls.some((c) => c.op === "moveTo" || c.op === "bezierCurveTo"),
		).toBe(false);
		expect(calls.filter((c) => c.op === "beginPath")).toHaveLength(1);
		expect(calls.filter((c) => c.op === "stroke")).toHaveLength(1);
	});

	it("progress 1: traces every part in full, one moveTo per part (polyline)", () => {
		const calls = run(shapeSpec({ polylines: twoParts, progress: 1 }));
		const moveTos = calls.filter((c) => c.op === "moveTo");
		expect(moveTos).toEqual([
			{ op: "moveTo", args: [0, 0] },
			{ op: "moveTo", args: [0, 100] },
		]);
	});

	it("progress 1: traces every part in full, one moveTo per part (curve)", () => {
		const calls = run(shapeSpec({ curvePaths: twoPartsCurve, progress: 1 }));
		const moveTos = calls.filter((c) => c.op === "moveTo");
		expect(moveTos).toHaveLength(2);
	});

	it("a multi-part shape spends one reveal budget in order — part 1 finishes before part 2 starts (polyline)", () => {
		// Two length-10 parts, total 20. progress 0.75 -> budget 15: part 1
		// (length 10) drawn whole, then 5 of part 2's 10.
		const calls = run(shapeSpec({ polylines: twoParts, progress: 0.75 }));
		const moveTos = calls.filter((c) => c.op === "moveTo");
		const lineTos = calls.filter((c) => c.op === "lineTo");
		expect(moveTos).toEqual([
			{ op: "moveTo", args: [0, 0] },
			{ op: "moveTo", args: [0, 100] },
		]);
		expect(lineTos).toHaveLength(2);
		expect((lineTos[0].args as number[])[0]).toBeCloseTo(10, 6); // part 1 whole
		expect((lineTos[1].args as number[])[0]).toBeCloseTo(5, 6); // part 2 half
	});

	it("a multi-part shape spends one reveal budget in order — part 1 finishes before part 2 starts (curve)", () => {
		// straightCurve (length exactly 10) then bezierCurve (a real cubic,
		// length > 10). A progress value guaranteed to spend all of the first
		// curve's budget and spill into the second must emit the first curve
		// whole (untrimmed anchor at (10, 0)) followed by a second, distinct
		// bezierCurveTo for the (partial) start of the second.
		const calls = run(
			shapeSpec({
				curvePaths: twoPartsCurve,
				progress: 0.9,
			}),
		);
		const bez = calls.filter((c) => c.op === "bezierCurveTo");
		expect(bez.length).toBeGreaterThanOrEqual(2);
		// The first curve (straightCurve) is emitted whole, not re-sliced.
		const [c1x, c1y, c2x, c2y, x, y] = bez[0].args as number[];
		expect(c1x).toBeCloseTo(10 / 3, 10);
		expect(c1y).toBeCloseTo(0, 10);
		expect(c2x).toBeCloseTo(20 / 3, 10);
		expect(c2y).toBeCloseTo(0, 10);
		expect(x).toBeCloseTo(10, 10);
		expect(y).toBeCloseTo(0, 10);
	});

	it("progress fractions 0.25/0.5/0.75 each trace strictly more of a single part than the last (polyline)", () => {
		const xs = [0.25, 0.5, 0.75].map((p) => {
			const calls = run(
				shapeSpec({
					polylines: [
						[
							{ x: 0, y: 0 },
							{ x: 10, y: 0 },
						],
					],
					progress: p,
				}),
			);
			const lineTo = calls.find((c) => c.op === "lineTo");
			expect(lineTo).toBeDefined();
			const args = (lineTo as Call).args as number[];
			return args[0];
		});
		expect(xs[0]).toBeCloseTo(2.5, 6);
		expect(xs[1]).toBeCloseTo(5, 6);
		expect(xs[2]).toBeCloseTo(7.5, 6);
	});
});

describe("fill with holes (multi-ring, non-zero winding)", () => {
	// Mirrors `Annulus`: an outer ring wound one way, an inner ring wound the
	// other way deliberately, so a non-zero-winding fill punches the hole.
	const outer: Polyline = [
		{ x: -10, y: -10 },
		{ x: 10, y: -10 },
		{ x: 10, y: 10 },
		{ x: -10, y: 10 },
	];
	const innerReversed: Polyline = [
		{ x: -5, y: 5 },
		{ x: 5, y: 5 },
		{ x: 5, y: -5 },
		{ x: -5, y: -5 },
	];

	it("polyline: both rings are traced into ONE path (one beginPath, one fill) each closed", () => {
		const { calls } = runFull(
			shapeSpec({
				polylines: [outer, innerReversed],
				closed: true,
				style: { fill: "#00ff00", stroke: "none" },
			}),
		);
		expect(calls.filter((c) => c.op === "beginPath")).toHaveLength(1);
		expect(calls.filter((c) => c.op === "fill")).toHaveLength(1);
		const closePaths = calls.filter((c) => c.op === "closePath");
		expect(closePaths).toHaveLength(2); // one per ring
		const moveTos = calls.filter((c) => c.op === "moveTo");
		expect(moveTos).toEqual([
			{ op: "moveTo", args: [-10, -10] },
			{ op: "moveTo", args: [-5, 5] },
		]);
	});

	it("curve: both rings are traced into ONE path via bezierCurveTo, each closed", () => {
		const outerCurve: CurvePath = {
			start: outer[0],
			segments: [
				lineSegment(outer[0], outer[1]),
				lineSegment(outer[1], outer[2]),
				lineSegment(outer[2], outer[3]),
				lineSegment(outer[3], outer[0]),
			],
			closed: false, // fillCurvePaths closes it itself regardless
		};
		const innerCurve: CurvePath = {
			start: innerReversed[0],
			segments: [
				lineSegment(innerReversed[0], innerReversed[1]),
				lineSegment(innerReversed[1], innerReversed[2]),
				lineSegment(innerReversed[2], innerReversed[3]),
				lineSegment(innerReversed[3], innerReversed[0]),
			],
			closed: false,
		};
		const { calls } = runFull(
			shapeSpec({
				polylines: [outer, innerReversed],
				curvePaths: [outerCurve, innerCurve],
				closed: true,
				style: { fill: "#00ff00", stroke: "none" },
			}),
		);
		expect(calls.filter((c) => c.op === "beginPath")).toHaveLength(1);
		expect(calls.filter((c) => c.op === "fill")).toHaveLength(1);
		expect(calls.some((c) => c.op === "bezierCurveTo")).toBe(true);
		expect(calls.filter((c) => c.op === "closePath")).toHaveLength(2);
	});

	it("fillFrom skips leading rings for both representations identically", () => {
		const polyCalls = runFull(
			shapeSpec({
				polylines: [outer, innerReversed],
				closed: true,
				fillFrom: 1,
				style: { fill: "#00ff00", stroke: "none" },
			}),
		).calls;
		const polyMoveTos = polyCalls.filter((c) => c.op === "moveTo");
		expect(polyMoveTos).toEqual([{ op: "moveTo", args: [-5, 5] }]);
	});
});

describe("dashes, caps/joins, opacity vs fillOpacity", () => {
	it("applies dash pattern and dashOffset before stroking", () => {
		const calls = run(
			shapeSpec({
				style: {
					dash: [4, 2],
					dashOffset: 3,
					lineCap: "square",
					lineJoin: "bevel",
				},
			}),
		);
		expect(calls).toContainEqual({ op: "setLineDash", args: [4, 2] });
		expect(calls).toContainEqual({ op: "set:lineDashOffset", args: [3] });
		expect(calls).toContainEqual({ op: "set:lineCap", args: ["square"] });
		expect(calls).toContainEqual({ op: "set:lineJoin", args: ["bevel"] });
	});

	it("clears the dash pattern when style.dash is null", () => {
		const calls = run(shapeSpec({ style: { dash: null } }));
		expect(calls).toContainEqual({ op: "setLineDash", args: [] });
	});

	it("stroke globalAlpha is style.opacity; fill globalAlpha is style.opacity * fillOpacity * progress", () => {
		const { calls } = runFull(
			shapeSpec({
				closed: true,
				progress: 0.5,
				style: { fill: "#123456", opacity: 0.8, fillOpacity: 0.5 },
			}),
		);
		const alphas = calls
			.filter((c) => c.op === "set:globalAlpha")
			.map((c) => c.args[0]);
		// Fill's alpha (opacity * fillOpacity * progress) comes first, then the
		// stroke's own (just opacity) after `applyStrokeStyle`.
		expect(alphas[0]).toBeCloseTo(0.8 * 0.5 * 0.5, 10);
		expect(alphas[1]).toBeCloseTo(0.8, 10);
	});

	it("a write reveals piece by piece: outline first in the fill's paint, then the fill", () => {
		// Three squares, one piece each, no lag: at 0.5 the first is done, the
		// second is half way (outline traced, no fill yet), the third unstarted.
		const square = (x: number) => [
			{ x, y: 0 },
			{ x: x + 10, y: 0 },
			{ x: x + 10, y: 10 },
			{ x, y: 10 },
			{ x, y: 0 },
		];
		const { calls, strokeStyles } = runFull(
			shapeSpec({
				polylines: [square(0), square(20), square(40)],
				closed: true,
				progress: 0.5,
				write: { pieces: [0, 1, 2], lagRatio: 1, outlineWidth: 0.5 },
				style: { fill: "#123456", strokeWidth: 0 },
			}),
		);
		// One fill (the first square, fully up), and one outline (the second,
		// at full writing width); the first's outline has thinned to nothing.
		expect(calls.filter((c) => c.op === "fill")).toHaveLength(1);
		expect(calls.filter((c) => c.op === "stroke")).toHaveLength(1);
		expect(calls).toContainEqual({ op: "set:lineWidth", args: [0.5] });
		expect(strokeStyles).toContain("#123456");
	});

	it("a finished write draws as an ordinary shape", () => {
		const { calls } = runFull(
			shapeSpec({
				closed: true,
				progress: 1,
				write: { pieces: [0], lagRatio: 0.2, outlineWidth: 0.5 },
				style: { fill: "#123456", strokeWidth: 0 },
			}),
		);
		expect(calls.filter((c) => c.op === "fill")).toHaveLength(1);
		expect(calls.some((c) => c.op === "stroke")).toBe(false);
	});

	it("skips the stroke pass entirely when stroke is 'none'", () => {
		const calls = run(shapeSpec({ style: { stroke: "none" } }));
		expect(calls.some((c) => c.op === "stroke")).toBe(false);
		expect(calls.some((c) => c.op === "set:lineCap")).toBe(false);
	});

	it("skips the stroke pass when strokeWidth <= 0", () => {
		const calls = run(shapeSpec({ style: { strokeWidth: 0 } }));
		expect(calls.some((c) => c.op === "stroke")).toBe(false);
	});

	it("skips the stroke pass when opacity <= 0", () => {
		const calls = run(shapeSpec({ style: { opacity: 0 } }));
		expect(calls.some((c) => c.op === "stroke")).toBe(false);
	});
});

describe("gradient fill and stroke, paint-cache identity", () => {
	const gradientPaint: LinearGradientPaint = {
		kind: "linear",
		from: { x: 0, y: 0 },
		to: { x: 10, y: 0 },
		stops: [
			{ offset: 0, color: "red" },
			{ offset: 1, color: "blue" },
		],
	};

	it("builds one CanvasGradient for a gradient stroke and reuses it across repaints of the same paint object", () => {
		const { ctx, gradients, calls } = mockCtx();
		const cache = new Map();
		const paints: PaintCache = createPaintCache();
		const spec = shapeSpec({ style: { stroke: gradientPaint } });

		paintSpecs(ctx, [spec], cache, paints);
		paintSpecs(ctx, [spec], cache, paints);

		expect(gradients.linear).toBe(1); // second paint hit the cache
		const strokeStyleSets = calls.filter((c) => c.op === "set:strokeStyle");
		expect(strokeStyleSets).toHaveLength(2);
		expect(strokeStyleSets[0].args[0]).toBe(strokeStyleSets[1].args[0]); // same object
	});

	it("builds one CanvasGradient for a gradient fill and reuses it across repaints", () => {
		const { ctx, gradients, calls } = mockCtx();
		const cache = new Map();
		const paints: PaintCache = createPaintCache();
		const spec = shapeSpec({ closed: true, style: { fill: gradientPaint } });

		paintSpecs(ctx, [spec], cache, paints);
		paintSpecs(ctx, [spec], cache, paints);

		expect(gradients.linear).toBe(1);
		const fillStyleSets = calls.filter((c) => c.op === "set:fillStyle");
		expect(fillStyleSets).toHaveLength(2);
		expect(fillStyleSets[0].args[0]).toBe(fillStyleSets[1].args[0]);
	});

	it("a fresh paint OBJECT (even if value-equal) misses the cache and builds a new gradient", () => {
		const { ctx, gradients } = mockCtx();
		const cache = new Map();
		const paints: PaintCache = createPaintCache();
		const specA = shapeSpec({ style: { stroke: { ...gradientPaint } } });
		const specB = shapeSpec({ style: { stroke: { ...gradientPaint } } });

		paintSpecs(ctx, [specA], cache, paints);
		paintSpecs(ctx, [specB], cache, paints);

		expect(gradients.linear).toBe(2);
	});
});

describe("drawText", () => {
	function textSpec(options: {
		text?: string;
		rotation?: number;
		progress?: number;
		style?: Partial<TextStyle>;
	}): TextSpec {
		return {
			kind: "text",
			id: nextId++,
			zIndex: 0,
			text: options.text ?? "hi",
			at: { x: 5, y: 5 },
			rotation: options.rotation ?? 0,
			style: {
				fill: "#000000",
				fontSize: 12,
				fontFamily: "sans-serif",
				fontWeight: 400,
				italic: false,
				align: "left",
				baseline: "alphabetic",
				opacity: 1,
				letterSpacing: 0,
				...options.style,
			},
			progress: options.progress ?? 1,
		};
	}

	it("at progress 1: no clip, sets font/align/baseline/fillStyle/alpha, then fillText", () => {
		const { ctx, calls } = mockCtx();
		const cache = new Map();
		const paints = createPaintCache();
		paintSpecs(ctx, [textSpec({})], cache, paints);

		expect(calls.some((c) => c.op === "clip")).toBe(false);
		const ops = calls.map((c) => c.op);
		expect(ops).toEqual([
			"save",
			"setTransform",
			"set:font",
			"set:textAlign",
			"set:textBaseline",
			"set:fillStyle",
			"set:globalAlpha",
			"fillText",
			"restore",
		]);
		expect(calls.find((c) => c.op === "fillText")?.args).toEqual(["hi", 5, 5]);
	});

	it("strokes a halo under the fill, its width scaled by the view", () => {
		const { ctx, calls, strokeStyles } = mockCtx();
		const cache = new Map();
		const paints = createPaintCache();
		paintSpecs(
			ctx,
			[textSpec({ style: { halo: { color: "#ffffff", width: 3 } } })],
			cache,
			paints,
		);
		const ops = calls.map((c) => c.op);
		const stroke = ops.indexOf("strokeText");
		expect(stroke).toBeGreaterThan(-1);
		expect(stroke).toBeLessThan(ops.indexOf("fillText"));
		expect(calls.find((c) => c.op === "strokeText")?.args).toEqual([
			"hi",
			5,
			5,
		]);
		expect(strokeStyles).toContain("#ffffff");
		expect(calls.find((c) => c.op === "set:lineWidth")?.args).toEqual([3]);
		expect(calls.find((c) => c.op === "set:lineJoin")?.args).toEqual(["round"]);
		// A zero-width halo strokes nothing.
		const bare = mockCtx();
		paintSpecs(
			bare.ctx,
			[textSpec({ style: { halo: { color: "#ffffff", width: 0 } } })],
			new Map(),
			createPaintCache(),
		);
		expect(bare.calls.some((c) => c.op === "strokeText")).toBe(false);
	});

	it("at partial progress: writes whole glyphs, the next one faded in its own clip", () => {
		const { ctx, calls } = mockCtx();
		// 10 px a glyph: "abcd" is 40 wide, and 0.6 of it reaches 24, two glyphs
		// written and the third 40% in.
		ctx.measureText = (text: string) =>
			({ width: 10 * Array.from(text).length }) as TextMetrics;
		paintSpecs(
			ctx,
			[textSpec({ text: "abcd", progress: 0.6 })],
			new Map(),
			createPaintCache(),
		);

		const rects = calls
			.filter((c) => c.op === "rect")
			.map((c) => c.args as number[]);
		// Left-aligned text is clipped from `at.x` (5), with no padding sliver;
		// no clip edge falls inside a glyph.
		expect(rects.map((r) => [r[0], r[2]])).toEqual([
			[5, 20],
			[25, 10],
		]);
		// Each clip comes before its own fill.
		const ops = calls
			.map((c) => c.op)
			.filter((op) => op === "clip" || op === "fillText");
		expect(ops).toEqual(["clip", "fillText", "clip", "fillText"]);
	});

	function fragmentSpec(progress = 1): TextSpec {
		const base = textSpec({ text: "ab cd", progress });
		const style = { ...base.style, align: "left" as const };
		return {
			...base,
			fragments: [
				{
					text: "ab",
					offset: { x: -2, y: 1 },
					style,
					width: 2,
					highlight: "#ff0",
				},
				{
					text: "cd",
					offset: { x: 1, y: -1 },
					style: { ...style, fill: "#f00" },
					width: 2,
					underline: true,
				},
			],
			box: { minX: -2, minY: -2, maxX: 3, maxY: 2 },
		};
	}

	it("draws each fragment at its offset from the anchor, y flipped to the canvas", () => {
		const { ctx, calls } = mockCtx();
		paintSpecs(ctx, [fragmentSpec()], new Map(), createPaintCache());
		expect(calls.find((c) => c.op === "setTransform")?.args).toEqual([
			1, 0, -0, 1, 5, 5,
		]);
		expect(calls.filter((c) => c.op === "fillText").map((c) => c.args)).toEqual(
			[
				["ab", -2, -1],
				["cd", 1, 1],
			],
		);
		const rects = calls.filter((c) => c.op === "fillRect").map((c) => c.args);
		// The highlight under "ab", then the underline under "cd".
		expect(rects).toHaveLength(2);
		expect(rects[0]?.[0]).toBe(-2);
		expect(rects[1]?.[0]).toBe(1);
		expect(calls.findIndex((c) => c.op === "fillRect")).toBeLessThan(
			calls.findIndex((c) => c.op === "fillText"),
		);
	});

	it("reveals fragments in order by width", () => {
		const { ctx, calls } = mockCtx();
		paintSpecs(ctx, [fragmentSpec(0.5)], new Map(), createPaintCache());
		expect(
			calls.filter((c) => c.op === "fillText").map((c) => c.args[0]),
		).toEqual(["ab"]);
	});

	it("at progress 0: draws nothing, not a one-pixel sliver", () => {
		const { ctx, calls } = mockCtx();
		paintSpecs(ctx, [textSpec({ progress: 0 })], new Map(), createPaintCache());
		expect(calls.some((c) => c.op === "fillText")).toBe(false);
		expect(calls.some((c) => c.op === "rect")).toBe(false);
	});

	it("rotation rotates about the anchor (absolute transform at it), then draws at the origin", () => {
		const { ctx, calls } = mockCtx();
		const cache = new Map();
		const paints = createPaintCache();
		paintSpecs(ctx, [textSpec({ rotation: Math.PI / 4 })], cache, paints);

		const c = Math.cos(Math.PI / 4);
		const s = Math.sin(Math.PI / 4);
		expect(calls).toContainEqual({
			op: "setTransform",
			args: [c, s, -s, c, 5, 5],
		});
		expect(calls.find((c) => c.op === "fillText")?.args).toEqual(["hi", 0, 0]);
	});

	describe("under a view matrix (specs are in scene units)", () => {
		// 10 px per scene unit, y up, scene origin at pixel (100, 50).
		const yUpView = { a: 10, b: 0, c: 0, d: -10, e: 100, f: 50 };

		it("maps the anchor through the view and draws upright at fontSize * scale", () => {
			const { ctx, calls } = mockCtx();
			const spec = textSpec({ style: { fontSize: 1.2, letterSpacing: 0.1 } });
			spec.at = { x: 1, y: 2 };
			paintSpecs(ctx, [spec], new Map(), createPaintCache(), yUpView);

			// Upright: the transform is replaced by an identity (no flip, no scale),
			// and the glyphs are placed at the transformed anchor in pixels.
			expect(calls).toContainEqual({
				op: "setTransform",
				args: [1, 0, 0, 1, 0, 0],
			});
			expect(calls.find((c) => c.op === "fillText")?.args).toEqual([
				"hi",
				110,
				30,
			]);
			expect(calls).toContainEqual({
				op: "set:font",
				args: ["400 12px sans-serif"],
			});
			expect(calls).toContainEqual({ op: "set:letterSpacing", args: ["1px"] });
		});

		it("a y-up view turns a counter-clockwise scene rotation into a clockwise-on-canvas one", () => {
			const { ctx, calls } = mockCtx();
			const spec = textSpec({ rotation: Math.PI / 6 });
			spec.at = { x: 0, y: 0 };
			paintSpecs(ctx, [spec], new Map(), createPaintCache(), yUpView);
			const c = Math.cos(-Math.PI / 6);
			const s = Math.sin(-Math.PI / 6);
			const call = calls.find(
				(x) => x.op === "setTransform" && (x.args as number[])[0] !== 1,
			);
			expect(call?.args[0]).toBeCloseTo(c, 9);
			expect(call?.args[1]).toBeCloseTo(s, 9);
			expect(call?.args[4]).toBeCloseTo(100, 9);
			expect(call?.args[5]).toBeCloseTo(50, 9);
		});

		it("a y-down view keeps the scene rotation sense", () => {
			const { ctx, calls } = mockCtx();
			const spec = textSpec({ rotation: Math.PI / 6 });
			spec.at = { x: 0, y: 0 };
			paintSpecs(ctx, [spec], new Map(), createPaintCache(), {
				a: 10,
				b: 0,
				c: 0,
				d: 10,
				e: 0,
				f: 0,
			});
			const call = calls.find(
				(x) => x.op === "setTransform" && (x.args as number[])[0] !== 1,
			);
			expect(call?.args[1]).toBeCloseTo(Math.sin(Math.PI / 6), 9);
		});
	});

	it("sets letterSpacing only when the style specifies one", () => {
		const withSpacing = mockCtx();
		paintSpecs(
			withSpacing.ctx,
			[textSpec({ style: { letterSpacing: 2 } })],
			new Map(),
			createPaintCache(),
		);
		expect(withSpacing.calls.some((c) => c.op === "set:letterSpacing")).toBe(
			true,
		);

		const withoutSpacing = mockCtx();
		paintSpecs(
			withoutSpacing.ctx,
			[textSpec({})],
			new Map(),
			createPaintCache(),
		);
		expect(withoutSpacing.calls.some((c) => c.op === "set:letterSpacing")).toBe(
			false,
		);
	});
});

/** The state one paint of {@link renderOnce} starts from. */
interface RenderState {
	canvas: HTMLCanvasElement;
	frame: ShapeSpec[];
	theme: Theme;
	size: { width: number; height: number };
	cameras?: CameraView[];
	canonical?: Matrix;
	focus?: number[];
}

/**
 * Builds a renderer, hands it the whole state before the first paint (as the
 * scene does in its first commit) and runs the paint frames that queues.
 */
function renderOnce(state: RenderState): PaintHost {
	const host = createPaintHost(
		{ canvas: state.canvas, theme: state.theme, size: state.size },
		(renderer) => {
			renderer.setFrame(state.frame);
			if (state.cameras) renderer.setCameras(state.cameras);
			if (state.canonical) renderer.setCanonicalView(state.canonical);
			if (state.focus) renderer.setFocus(state.focus);
		},
	);
	host.drain();
	return host;
}

describe("createCanvasRenderer: multi-camera pass and focus-ring chrome", () => {
	function fakeCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
		return { getContext: () => ctx } as unknown as HTMLCanvasElement;
	}

	const twoCameras: CameraView[] = [
		{
			units: 20,
			center: { x: 0, y: 0 },
			yUp: true,
			viewport: { x: 0, y: 0, width: 0.5, height: 1 },
			border: "#ff0000",
			borderWidth: 2,
			background: "#111111",
		},
		{
			units: 20,
			center: { x: 0, y: 0 },
			yUp: true,
			viewport: { x: 0.5, y: 0, width: 0.5, height: 1 },
			border: null,
			borderWidth: 0,
			background: null,
		},
	];

	it("paints each camera as its own clipped, transformed pass, with border/background chrome", () => {
		const { ctx, calls } = mockCtx();
		renderOnce({
			canvas: fakeCanvas(ctx),
			frame: [shapeSpec({})],
			theme: defaultTheme,
			size: { width: 100, height: 50 },
			cameras: twoCameras,
		});

		const setTransforms = calls.filter((c) => c.op === "setTransform");
		// One reset to identity per camera clip/border pass, plus the per-camera
		// projection matrix itself and the top-level reset at frame start.
		expect(setTransforms.length).toBeGreaterThanOrEqual(3);

		const clips = calls.filter((c) => c.op === "clip");
		expect(clips).toHaveLength(2); // one per camera viewport

		// First camera has a background fill and a border stroke; the second has
		// neither — the border-skipping and background-skipping branches both run.
		expect(
			calls.some((c) => c.op === "set:fillStyle" && c.args[0] === "#111111"),
		).toBe(true);
		expect(
			calls.some((c) => c.op === "strokeRect" && true) &&
				calls.some(
					(c) => c.op === "set:strokeStyle" && c.args[0] === "#ff0000",
				),
		).toBe(true);
	});

	it("draws a focus ring around the union box of focused node ids, inside each camera that shows it", () => {
		const spec = shapeSpec({
			polylines: [
				[
					{ x: -5, y: -5 },
					{ x: 5, y: 5 },
				],
			],
		});
		const { ctx, calls } = mockCtx();
		renderOnce({
			canvas: fakeCanvas(ctx),
			frame: [spec],
			theme: defaultTheme,
			size: { width: 100, height: 50 },
			cameras: twoCameras,
			focus: [spec.id],
		});

		const ringStrokes = calls.filter(
			(c) =>
				c.op === "set:strokeStyle" && c.args[0] === defaultTheme.palette.accent,
		);
		// Painted once per camera that shows the focused node.
		expect(ringStrokes).toHaveLength(2);
	});

	it("single-view (no cameras) path: no clip, no per-camera setTransform, ring drawn once", () => {
		const spec = shapeSpec({});
		const { ctx, calls } = mockCtx();
		renderOnce({
			canvas: fakeCanvas(ctx),
			frame: [spec],
			theme: defaultTheme,
			size: { width: 100, height: 50 },
			focus: [spec.id],
		});

		expect(calls.some((c) => c.op === "clip")).toBe(false);
		const ringStrokes = calls.filter(
			(c) =>
				c.op === "set:strokeStyle" && c.args[0] === defaultTheme.palette.accent,
		);
		expect(ringStrokes).toHaveLength(1);
	});
});

describe("Path2D cache for fully revealed geometry", () => {
	/** A recording stand-in for `Path2D`, which Node and happy-dom lack. */
	const built: Array<{ cmds: string[] }> = [];
	class FakePath2D {
		cmds: string[] = [];
		constructor() {
			built.push(this);
		}
		moveTo(x: number, y: number) {
			this.cmds.push(`M${x},${y}`);
		}
		lineTo(x: number, y: number) {
			this.cmds.push(`L${x},${y}`);
		}
		bezierCurveTo() {
			this.cmds.push("B");
		}
		closePath() {
			this.cmds.push("Z");
		}
	}

	const globals = globalThis as unknown as { Path2D?: unknown };
	const original = globals.Path2D;
	afterEach(() => {
		globals.Path2D = original;
		built.length = 0;
	});

	function paintTwice(spec: ShapeSpec) {
		const { ctx, calls } = mockCtx();
		const cache = new Map();
		const paints = createPaintCache();
		paintSpecs(ctx, [spec], cache, paints);
		paintSpecs(ctx, [spec], cache, paints);
		return calls;
	}

	it("strokes a fully revealed shape with one cached Path2D across frames", () => {
		globals.Path2D = FakePath2D;
		const spec = shapeSpec({
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 3, y: 4 },
				],
			],
		});
		const calls = paintTwice(spec);
		const strokes = calls.filter((c) => c.op === "stroke");
		expect(strokes).toHaveLength(2);
		expect(strokes[0].args[0]).toBeInstanceOf(FakePath2D);
		// Same object both frames: built once, traced into the Path2D rather than
		// the context.
		expect(strokes[1].args[0]).toBe(strokes[0].args[0]);
		expect(built).toHaveLength(1);
		expect(built[0].cmds).toEqual(["M0,0", "L3,4"]);
		expect(calls.some((c) => c.op === "moveTo")).toBe(false);
	});

	it("is keyed on the geometry array, so a restyle reuses it and new geometry does not", () => {
		globals.Path2D = FakePath2D;
		const polylines: Polyline[] = [
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
		];
		const a = shapeSpec({ polylines });
		const restyled = shapeSpec({ polylines, style: { strokeWidth: 9 } });
		const moved = shapeSpec({
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 2, y: 2 },
				],
			],
		});
		const { ctx } = mockCtx();
		const cache = new Map();
		const paints = createPaintCache();
		paintSpecs(ctx, [a, restyled], cache, paints);
		expect(built).toHaveLength(1);
		paintSpecs(ctx, [moved], cache, paints);
		expect(built).toHaveLength(2);
	});

	it("fills closed shapes through a cached closed Path2D, honouring fillFrom", () => {
		globals.Path2D = FakePath2D;
		const ring = (x: number): Polyline => [
			{ x, y: 0 },
			{ x: x + 1, y: 0 },
			{ x: x + 1, y: 1 },
		];
		const spec = shapeSpec({
			polylines: [ring(0), ring(10)],
			closed: true,
			fillFrom: 1,
			style: { fill: "#ff0000", stroke: "none" },
		});
		const calls = paintTwice(spec);
		const fills = calls.filter((c) => c.op === "fill");
		expect(fills).toHaveLength(2);
		expect(fills[1].args[0]).toBe(fills[0].args[0]);
		expect(built).toHaveLength(1);
		// Only the ring from `fillFrom`, closed.
		expect(built[0].cmds).toEqual(["M10,0", "L11,0", "L11,1", "Z"]);
	});

	it("a partial reveal traces into the context, not a cached path", () => {
		globals.Path2D = FakePath2D;
		const calls = run(shapeSpec({ progress: 0.5 }));
		expect(built).toHaveLength(0);
		expect(calls.some((c) => c.op === "lineTo")).toBe(true);
		expect(calls.find((c) => c.op === "stroke")?.args).toEqual([]);
	});

	it("curve-native shapes cache their Path2D too", () => {
		globals.Path2D = FakePath2D;
		const spec = shapeSpec({ curvePaths: [bezierCurve] });
		paintTwice(spec);
		expect(built).toHaveLength(1);
		expect(built[0].cmds).toEqual(["M0,0", "B"]);
	});

	it("falls back to tracing into the context where Path2D does not exist", () => {
		globals.Path2D = undefined;
		const calls = paintTwice(shapeSpec({}));
		expect(calls.filter((c) => c.op === "moveTo")).toHaveLength(2);
		expect(calls.filter((c) => c.op === "stroke")[0].args).toEqual([]);
	});
});

describe("painting specs in scene units under a view", () => {
	const fakeCanvas = (ctx: CanvasRenderingContext2D) =>
		({ getContext: () => ctx }) as unknown as HTMLCanvasElement;

	const stageView = { a: 50, b: 0, c: 0, d: -50, e: 400, f: 225 };

	it("a plain stage installs its view matrix, then draws the same scene-unit numbers", () => {
		const spec = shapeSpec({
			polylines: [
				[
					{ x: 1, y: 1 },
					{ x: 2, y: 3 },
				],
			],
			style: { strokeWidth: 0.1, dash: [0.2, 0.1], dashOffset: 0.05 },
		});
		const { ctx, calls } = mockCtx();
		renderOnce({
			canvas: fakeCanvas(ctx),
			frame: [spec],
			theme: defaultTheme,
			size: { width: 800, height: 450 },
			canonical: stageView,
		});
		const transform = calls.findIndex(
			(c) =>
				c.op === "setTransform" &&
				(c.args as number[]).join() === "50,0,0,-50,400,225",
		);
		const draw = calls.findIndex((c) => c.op === "moveTo");
		expect(transform).toBeGreaterThan(-1);
		expect(draw).toBeGreaterThan(transform);
		// ShapeGeometry, width and dash are the spec's scene-unit values, untouched.
		expect(calls[draw].args).toEqual([1, 1]);
		expect(calls).toContainEqual({ op: "set:lineWidth", args: [0.1] });
		expect(calls).toContainEqual({ op: "setLineDash", args: [0.2, 0.1] });
		expect(calls).toContainEqual({ op: "set:lineDashOffset", args: [0.05] });
	});

	it("moving a camera or resizing repaints the very same specs through a new matrix", () => {
		const spec = shapeSpec({
			polylines: [
				[
					{ x: 1, y: 1 },
					{ x: 2, y: 3 },
				],
			],
		});
		const frame = [spec];
		const { ctx, calls } = mockCtx();
		const camera: CameraView = {
			units: 16,
			center: { x: 0, y: 0 },
			yUp: true,
			viewport: { x: 0, y: 0, width: 1, height: 1 },
			border: null,
			borderWidth: 0,
			background: null,
		};
		const host = renderOnce({
			canvas: fakeCanvas(ctx),
			frame,
			theme: defaultTheme,
			size: { width: 800, height: 450 },
			cameras: [camera],
		});
		const snapshot = host.renderer.snapshot;
		const first = snapshot();
		const specBefore = first[0];
		const polylinesBefore = (specBefore as ShapeSpec).polylines;

		host.renderer.setCameras([{ ...camera, units: 4, center: { x: 1, y: 1 } }]);
		host.drain();
		host.renderer.setSize({ width: 1600, height: 900 });
		host.drain();

		// Same array, same spec, same geometry arrays: nothing was re-derived.
		expect(snapshot()).toBe(first);
		expect(snapshot()[0]).toBe(specBefore);
		expect((snapshot()[0] as ShapeSpec).polylines).toBe(polylinesBefore);

		// ...yet three distinct view matrices were installed for it, and the
		// geometry numbers handed to the canvas never changed.
		const views = new Set(
			calls
				.filter((c) => c.op === "setTransform" && (c.args as number[])[0] !== 1)
				.map((c) => (c.args as number[]).join()),
		);
		expect(views.size).toBe(3);
		const moves = calls.filter((c) => c.op === "moveTo");
		expect(moves.length).toBeGreaterThanOrEqual(3);
		for (const move of moves) expect(move.args).toEqual([1, 1]);
	});
});

describe("focus ring and chrome are placed through the view matrix", () => {
	const fakeCanvas = (ctx: CanvasRenderingContext2D) =>
		({ getContext: () => ctx }) as unknown as HTMLCanvasElement;

	const box = shapeSpec({
		polylines: [
			[
				{ x: 1, y: 1 },
				{ x: 2, y: 3 },
			],
		],
	});

	it("a scene-unit box is mapped to pixels (y flipped) and padded by the CSS-pixel gap", () => {
		const { ctx, calls } = mockCtx();
		renderOnce({
			canvas: fakeCanvas(ctx),
			frame: [box],
			theme: defaultTheme,
			size: { width: 800, height: 450 },
			canonical: { a: 50, b: 0, c: 0, d: -50, e: 400, f: 225 },
			focus: [box.id],
		});
		// Scene (1,1)-(2,3) → pixels x 450..500, y 75..175; ring pads by 3.
		expect(calls.find((c) => c.op === "strokeRect")?.args).toEqual([
			447, 72, 56, 106,
		]);
	});

	it("scales only the position with the camera, not the ring's weight", () => {
		const { ctx, calls } = mockCtx();
		const camera: CameraView = {
			units: 4,
			center: { x: 0, y: 0 },
			yUp: true,
			viewport: { x: 0, y: 0, width: 1, height: 1 },
			border: null,
			borderWidth: 0,
			background: null,
		};
		renderOnce({
			canvas: fakeCanvas(ctx),
			frame: [box],
			theme: defaultTheme,
			size: { width: 800, height: 400 },
			cameras: [camera],
			focus: [box.id],
		});
		// 200px per unit; centre pixel (400, 200): x 600..800, y 200-600=-400..0.
		expect(calls.find((c) => c.op === "strokeRect")?.args).toEqual([
			597, -403, 206, 406,
		]);
		expect(calls).toContainEqual({ op: "set:lineWidth", args: [2] });
	});
});

describe("clip regions", () => {
	const box: ClipRegion = {
		rings: [
			[
				{ x: 0, y: 0 },
				{ x: 4, y: 0 },
				{ x: 4, y: 3 },
				{ x: 0, y: 3 },
			],
		],
	};
	const other: ClipRegion = {
		rings: [
			[
				{ x: 1, y: 1 },
				{ x: 2, y: 1 },
				{ x: 2, y: 2 },
			],
		],
	};

	const paint = (specs: ShapeSpec[]) => {
		const { ctx, calls } = mockCtx();
		paintSpecs(ctx, specs, new Map(), createPaintCache());
		return calls;
	};

	it("traces each region under the view and clips before drawing", () => {
		const calls = paint([shapeSpec({ clip: [box] })]);
		const ops = calls.map((c) => c.op);
		expect(ops.slice(0, 8)).toEqual([
			"save",
			"beginPath",
			"moveTo",
			"lineTo",
			"lineTo",
			"lineTo",
			"closePath",
			"clip",
		]);
		expect(calls[2].args).toEqual([0, 0]);
		expect(calls[5].args).toEqual([0, 3]);
		expect(ops.at(-1)).toBe("restore");
		expect(ops).toContain("stroke");
	});

	it("nested regions are one clip() each, so the canvas intersects them", () => {
		const calls = paint([shapeSpec({ clip: [box, other] })]);
		expect(calls.filter((c) => c.op === "clip")).toHaveLength(2);
		expect(calls.filter((c) => c.op === "save")[0]).toBe(calls[0]);
	});

	it("a run of specs sharing one clip list installs it once", () => {
		const shared = [box];
		const calls = paint([
			shapeSpec({ clip: shared }),
			shapeSpec({ clip: shared }),
			shapeSpec({ clip: shared }),
		]);
		expect(calls.filter((c) => c.op === "clip")).toHaveLength(1);
		expect(calls.filter((c) => c.op === "stroke")).toHaveLength(3);
	});

	it("releases the clip before an unclipped spec and re-clips on a new list", () => {
		const calls = paint([
			shapeSpec({ clip: [box] }),
			shapeSpec({}),
			shapeSpec({ clip: [other] }),
		]);
		const ops = calls.map((c) => c.op);
		const strokes = ops.flatMap((op, i) => (op === "stroke" ? [i] : []));
		const clips = ops.flatMap((op, i) => (op === "clip" ? [i] : []));
		expect(clips).toHaveLength(2);
		// First stroke is clipped; the clip is restored before the second.
		expect(clips[0]).toBeLessThan(strokes[0]);
		const restoreAfterFirst = ops.indexOf("restore", strokes[0] + 1);
		// `drawShape`'s own save/restore pair precedes the clip's restore.
		expect(ops.lastIndexOf("restore", strokes[1])).toBeGreaterThan(strokes[0]);
		expect(restoreAfterFirst).toBeLessThan(strokes[1]);
		expect(clips[1]).toBeGreaterThan(strokes[1]);
		expect(clips[1]).toBeLessThan(strokes[2]);
		expect(ops.at(-1)).toBe("restore");
		// Balanced: every save has its restore.
		expect(ops.filter((op) => op === "save").length).toBe(
			ops.filter((op) => op === "restore").length,
		);
	});

	it("an empty clip list clips nothing", () => {
		const calls = paint([shapeSpec({ clip: [] })]);
		expect(calls.some((c) => c.op === "clip")).toBe(false);
	});
});

describe("createCanvasRenderer: the imperative surface", () => {
	const fakeCanvas = (ctx: CanvasRenderingContext2D) =>
		({ getContext: () => ctx }) as unknown as HTMLCanvasElement;

	function setup() {
		const { ctx, calls } = mockCtx();
		const host = createPaintHost({
			canvas: fakeCanvas(ctx),
			theme: defaultTheme,
			size: { width: 100, height: 50 },
		});
		const renderer = host.renderer;
		host.drain();
		calls.length = 0;
		return { host, renderer, calls };
	}

	it("starts dirty, and a paint clears it", () => {
		const { ctx } = mockCtx();
		const host = createPaintHost({
			canvas: fakeCanvas(ctx),
			theme: defaultTheme,
			size: { width: 10, height: 10 },
		});
		expect(host.renderer.needsPaint()).toBe(true);
		host.renderer.paint();
		expect(host.renderer.needsPaint()).toBe(false);
	});

	it("setters only mark it dirty when the value changed", () => {
		const { renderer } = setup();
		const frame = [shapeSpec({})];
		renderer.setFrame(frame);
		expect(renderer.needsPaint()).toBe(true);
		renderer.paint();

		renderer.setFrame(frame);
		renderer.setTheme(defaultTheme);
		renderer.setSize({ width: 100, height: 50 });
		renderer.setDpr(1);
		renderer.setBackground(undefined);
		renderer.setFocus(null);
		renderer.setFocusItem(null);
		expect(renderer.needsPaint()).toBe(false);

		renderer.setFocusItem({ id: 1, item: 2 });
		renderer.paint();
		renderer.setFocusItem({ id: 1, item: 2 });
		expect(renderer.needsPaint()).toBe(false);
		renderer.setBackground(null);
		expect(renderer.needsPaint()).toBe(true);
	});

	it("asks the host for a paint on a change, and not while hidden", () => {
		const { ctx } = mockCtx();
		let requests = 0;
		const renderer = createCanvasRenderer({
			canvas: fakeCanvas(ctx),
			theme: defaultTheme,
			size: { width: 10, height: 10 },
			onPaintRequest: () => {
				requests++;
			},
		});
		renderer.setFrame([shapeSpec({})]);
		expect(requests).toBe(1);
		renderer.setVisible(false);
		renderer.setDpr(2);
		expect(requests).toBe(1);
		expect(renderer.needsPaint()).toBe(false);
		// Showing again is a repaint of whatever changed while hidden.
		renderer.setVisible(true);
		expect(requests).toBe(2);
		expect(renderer.needsPaint()).toBe(true);
	});

	it("paints nothing while hidden or at a zero size", () => {
		const { renderer, calls } = setup();
		renderer.setVisible(false);
		renderer.paint();
		expect(calls).toHaveLength(0);
		renderer.setVisible(true);
		renderer.setSize({ width: 0, height: 50 });
		renderer.paint();
		expect(calls).toHaveLength(0);
	});

	it("snapshot is the frame last handed over, by identity", () => {
		const { renderer } = setup();
		const frame = [shapeSpec({}), shapeSpec({})];
		renderer.setFrame(frame);
		expect(renderer.snapshot()).toBe(frame);
	});

	it("invalidate forces a repaint with nothing changed; dispose stops everything", () => {
		const { host, renderer, calls } = setup();
		renderer.invalidate();
		expect(renderer.needsPaint()).toBe(true);
		expect(host.drain()).toBe(1);
		expect(calls.some((c) => c.op === "clearRect")).toBe(true);
		renderer.dispose();
		renderer.setFrame([shapeSpec({})]);
		expect(renderer.needsPaint()).toBe(false);
		calls.length = 0;
		renderer.paint();
		expect(calls).toHaveLength(0);
	});
});
