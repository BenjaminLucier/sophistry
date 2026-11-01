/**
 * `drawMarks` for the per-item kinds: `outline` and `paths` marks placed by
 * `centers` and `transforms`, per-item strokes, widths and dashes, and the
 * splat fast path declining all of them. Contexts are recorders, as in
 * `paint-items.test.ts`.
 */

import { describe, expect, it } from "vitest";
import type { MarkOutline, MarksSpec, StrokeStyle } from "../spec/types.js";
import { createPaintCache } from "./paint.js";
import { drawMarks, mayBeVisible, splatMarks } from "./paint-items.js";

type Call = [string, ...unknown[]];

function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
	const calls: Call[] = [];
	const target: Record<string, unknown> = {};
	const ctx = new Proxy(target, {
		get(_, key) {
			if (key in target) return target[key as string];
			return (...args: unknown[]) => {
				calls.push([String(key), ...args]);
			};
		},
		set(_, key, value) {
			calls.push([`${String(key)}=`, value]);
			return true;
		},
	});
	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const style: StrokeStyle = {
	stroke: "none",
	strokeWidth: 0,
	fill: null,
	along: null,
	opacity: 1,
	fillOpacity: 1,
	lineCap: "round",
	lineJoin: "round",
	dash: null,
	dashOffset: 0,
};

const triangle: MarkOutline = {
	polylines: [
		[
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
		],
	],
	closed: true,
};

function spec(extra: Partial<MarksSpec>): MarksSpec {
	return {
		kind: "marks",
		id: 1,
		zIndex: 0,
		shape: { kind: "outline", ...triangle },
		count: 2,
		centers: new Float64Array([0, 0, 10, 0]),
		extents: new Float64Array([2, 2]),
		fills: "#f00",
		alphas: null,
		style,
		progress: 1,
		bounds: { minX: -2, minY: -2, maxX: 12, maxY: 2 },
		...extra,
	};
}

/** The path calls only (moveTo, lineTo, bezierCurveTo, closePath). */
function pathCalls(calls: Call[]): Call[] {
	return calls.filter(([name]) =>
		["moveTo", "lineTo", "bezierCurveTo", "closePath"].includes(name),
	);
}

describe("outline marks", () => {
	it("places the shared outline per item by centre and linear part", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			spec({
				// Item 1: doubled and swapped axes.
				transforms: new Float64Array([1, 0, 0, 1, 0, 2, 2, 0]),
			}),
			createPaintCache(),
			null,
		);
		expect(pathCalls(calls)).toEqual([
			["moveTo", 0, 0],
			["lineTo", 1, 0],
			["lineTo", 0, 1],
			["closePath"],
			["moveTo", 10, 0],
			["lineTo", 10, 2],
			["lineTo", 12, 0],
			["closePath"],
		]);
		// One fill call per item, as separate shapes would issue.
		expect(calls.filter(([name]) => name === "fill")).toHaveLength(2);
	});

	it("maps curve control points and does not fill open outlines", () => {
		const { ctx, calls } = recorder();
		const open: MarkOutline = {
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 1, y: 1 },
				],
			],
			curvePaths: [
				{
					start: { x: 0, y: 0 },
					segments: [
						{ c1: { x: 0, y: 1 }, c2: { x: 1, y: 1 }, to: { x: 1, y: 0 } },
					],
					closed: false,
				},
			],
			closed: false,
		};
		drawMarks(
			ctx,
			spec({
				shape: { kind: "outline", ...open },
				count: 1,
				centers: new Float64Array([5, 5]),
				extents: new Float64Array([2]),
				style: { ...style, stroke: "#000", strokeWidth: 0.1 },
			}),
			createPaintCache(),
			null,
		);
		expect(pathCalls(calls)).toEqual([
			["moveTo", 5, 5],
			["bezierCurveTo", 5, 6, 6, 6, 6, 5],
		]);
		expect(calls.some(([name]) => name === "fill")).toBe(false);
		expect(calls.filter(([name]) => name === "stroke")).toHaveLength(1);
	});

	it("draws paths marks with one outline per item and per-item strokes, widths and dashes", () => {
		const { ctx, calls } = recorder();
		const square: MarkOutline = {
			polylines: [
				[
					{ x: -1, y: -1 },
					{ x: 1, y: -1 },
					{ x: 1, y: 1 },
					{ x: -1, y: 1 },
				],
			],
			closed: true,
		};
		drawMarks(
			ctx,
			spec({
				shape: { kind: "paths", outlines: [triangle, square] },
				fills: ["#f00", "#0f0"],
				style: { ...style, stroke: "#000", strokeWidth: 0.3 },
				strokes: ["#00f", "#0ff"],
				strokeWidths: new Float32Array([0.1, 0.3]),
				dashes: [null, [0.5, 0.25]],
			}),
			createPaintCache(),
			null,
		);
		expect(pathCalls(calls)).toEqual([
			["moveTo", 0, 0],
			["lineTo", 1, 0],
			["lineTo", 0, 1],
			["closePath"],
			["moveTo", 9, -1],
			["lineTo", 11, -1],
			["lineTo", 11, 1],
			["lineTo", 9, 1],
			["closePath"],
		]);
		const strokeStyles = calls
			.filter(([name]) => name === "strokeStyle=")
			.map(([, v]) => v);
		expect(strokeStyles).toEqual(["#000", "#00f", "#0ff"]);
		const widths = calls
			.filter(([name]) => name === "lineWidth=")
			.map(([, v]) => v);
		expect(widths[widths.length - 2]).toBeCloseTo(0.1);
		expect(widths[widths.length - 1]).toBeCloseTo(0.3);
		const dashes = calls
			.filter(([name]) => name === "setLineDash")
			.map(([, v]) => v);
		// The shared style sets the solid dash; item 0 keeps it, item 1 changes it.
		expect(dashes).toEqual([[], [0.5, 0.25]]);
		expect(calls.filter(([name]) => name === "stroke")).toHaveLength(2);
	});

	it("skips items whose disc of reach misses the visible box, padded by their own width", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			spec({
				style: { ...style, stroke: "#000", strokeWidth: 1 },
				strokeWidths: new Float32Array([0.1, 1]),
			}),
			createPaintCache(),
			{ minX: 2.5, minY: -1, maxX: 20, maxY: 1 },
		);
		// Item 0 reaches x = 2 + 0.1 < 2.5: culled. Item 1 stays.
		expect(pathCalls(calls)[0]).toEqual(["moveTo", 10, 0]);
	});

	it("culls the layer by the widest per-item stroke", () => {
		const layer = spec({
			strokeWidths: new Float32Array([0.1, 3]),
			style: { ...style, stroke: "#000", strokeWidth: 0.1 },
		});
		expect(mayBeVisible(layer, { minX: 14, minY: 0, maxX: 20, maxY: 1 })).toBe(
			true,
		);
		expect(mayBeVisible(layer, { minX: 16, minY: 0, maxX: 20, maxY: 1 })).toBe(
			false,
		);
	});
});

describe("splat declines the per-item kinds", () => {
	const view = { a: 10, b: 0, c: 0, d: 10, e: 0, f: 0 };
	const viewport = { x: 0, y: 0, width: 100, height: 100 };
	function many(extra: Partial<MarksSpec>): MarksSpec {
		const count = 2000;
		return spec({
			shape: { kind: "circle" },
			count,
			centers: new Float64Array(count * 2),
			extents: new Float64Array(count).fill(0.1),
			bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
			...extra,
		});
	}
	it.each([
		["outline", { shape: { kind: "outline", ...triangle } as const }],
		["paths", { shape: { kind: "paths", outlines: [triangle] } as const }],
		["per-item strokes", { strokes: ["#000"] }],
		["per-item widths", { strokeWidths: new Float32Array([1]) }],
		["per-item transforms", { transforms: new Float64Array(4) }],
		["per-item dashes", { dashes: [null] }],
	])("%s", (_, extra) => {
		const { ctx, calls } = recorder();
		expect(
			splatMarks(ctx, many(extra as Partial<MarksSpec>), view, viewport),
		).toBe(false);
		expect(calls).toEqual([]);
	});

	it("still draws a plain circle layer without per-item arrays", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			spec({ shape: { kind: "circle" } }),
			createPaintCache(),
			null,
		);
		expect(calls.filter(([name]) => name === "moveTo")).toHaveLength(2);
	});
});
