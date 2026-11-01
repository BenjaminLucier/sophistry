/**
 * Batched painting and culling: `drawMarks`, `paintSpecs`' viewport, and the
 * bitmap reuse in `layer-cache.ts`. Contexts are recorders (every method call
 * and property write, in order), as in `canvas-renderer.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { IDENTITY } from "../geometry/transform.js";
import type {
	DrawSpec,
	MarkOutline,
	MarksSpec,
	ShapeSpec,
	StrokeStyle,
} from "../spec/types.js";
import { paintSpecs } from "./canvas-renderer.js";
import { createLayerCache } from "./layer-cache.js";
import { createPaintCache } from "./paint.js";
import {
	drawMarks,
	mayBeVisible,
	revealMeasures,
	splatMarks,
	visibleBox,
} from "./paint-items.js";

type Call = [string, ...unknown[]];

/** A context recording every call and property write. */
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

function marks(
	centers: number[],
	fills: MarksSpec["fills"],
	extra: Partial<MarksSpec> = {},
): MarksSpec {
	const count = centers.length / 2;
	return {
		kind: "marks",
		id: 1,
		zIndex: 0,
		shape: { kind: "circle" },
		count,
		centers: new Float64Array(centers),
		extents: new Float64Array(count).fill(1),
		fills,
		alphas: null,
		style,
		progress: 1,
		bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
		...extra,
	};
}

const ops = (calls: Call[]) => calls.map((c) => c[0]);

describe("drawMarks", () => {
	it("fills each opaque same-colour item as its own path (no merged runs)", () => {
		const { ctx, calls } = recorder();
		drawMarks(ctx, marks([0, 0, 5, 0, 10, 0], "red"), createPaintCache(), null);
		// One beginPath/fill per item: a merged path rasterises its edges
		// differently from the single shapes the items stand in for.
		expect(ops(calls).filter((op) => op === "fill")).toHaveLength(3);
		expect(ops(calls).filter((op) => op === "beginPath")).toHaveLength(3);
		expect(ops(calls).filter((op) => op === "moveTo")).toHaveLength(3);
	});

	it("fills translucent items one by one, so overlaps blend as separate shapes would", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			marks([0, 0, 0.5, 0], "red", { style: { ...style, fillOpacity: 0.5 } }),
			createPaintCache(),
			null,
		);
		expect(ops(calls).filter((op) => op === "fill")).toHaveLength(2);
	});

	it("keeps index order across colours and sets each style once per change", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			marks([0, 0, 1, 0, 2, 0], ["red", "blue", "blue"]),
			createPaintCache(),
			null,
		);
		const fills = calls.filter((c) => c[0] === "fillStyle=").map((c) => c[1]);
		expect(fills).toEqual(["red", "blue"]);
		expect(ops(calls).filter((op) => op === "fill")).toHaveLength(3);
	});

	it("skips items outside the visible box and items with zero alpha", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			marks([0, 0, 50, 50, 2, 2], "red", {
				alphas: new Float32Array([1, 1, 0]),
			}),
			createPaintCache(),
			{ minX: -5, minY: -5, maxX: 5, maxY: 5 },
		);
		expect(ops(calls).filter((op) => op === "moveTo")).toHaveLength(1);
	});
});

describe("culling", () => {
	const square = (x: number): ShapeSpec => ({
		kind: "shape",
		id: x,
		zIndex: 0,
		polylines: [
			[
				{ x, y: 0 },
				{ x: x + 1, y: 0 },
				{ x: x + 1, y: 1 },
			],
		],
		closed: true,
		fillFrom: 0,
		style: { ...style, fill: "red" },
		progress: 1,
	});

	it("maps the viewport back into scene units through the view", () => {
		const view = { a: 10, b: 0, c: 0, d: -10, e: 50, f: 50 };
		expect(visibleBox(view, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
			minX: -5,
			minY: -5,
			maxX: 5,
			maxY: 5,
		});
	});

	it("paints only the specs that reach the viewport", () => {
		const { ctx, calls } = recorder();
		const specs: DrawSpec[] = [square(0), square(500), square(-3)];
		paintSpecs(ctx, specs, new Map(), createPaintCache(), IDENTITY, {
			viewport: { x: 0, y: 0, width: 100, height: 100 },
		});
		// Only the square at 0..1 reaches the 0..100 box. (Path2D does not
		// exist in Node, so the fill traces into the context.)
		expect(ops(calls).filter((op) => op === "fill")).toHaveLength(1);
		expect(
			mayBeVisible(square(-3), { minX: -2.5, minY: 0, maxX: 0, maxY: 1 }),
		).toBe(true);
	});

	it("paints everything when no viewport is given", () => {
		const { ctx, calls } = recorder();
		paintSpecs(ctx, [square(0), square(500)], new Map(), createPaintCache());
		expect(ops(calls).filter((op) => op === "fill")).toHaveLength(2);
	});
});

describe("layer cache", () => {
	const surfaces: ReturnType<typeof recorder>[] = [];
	const cache = () =>
		createLayerCache({
			surface: (width, height) => {
				const surface = recorder();
				surfaces.push(surface);
				return {
					canvas: { width, height } as never,
					ctx: surface.ctx,
				};
			},
			repaint: () => {},
			now: () => 0,
		});

	const spec = (id: number): ShapeSpec => ({
		kind: "shape",
		id,
		zIndex: 0,
		polylines: [],
		closed: false,
		fillFrom: 0,
		style,
		progress: 1,
	});

	it("caches a still prefix once the first change has held for two frames", () => {
		const layers = cache();
		const still = Array.from({ length: 40 }, (_, i) => spec(i));
		const drawn: Array<[number, number]> = [];
		const frame = (moving: ShapeSpec) => ({
			specs: [...still, moving],
			view: IDENTITY,
			width: 10,
			height: 10,
			key: [],
			background: () => {},
			draw: (_: CanvasRenderingContext2D, from: number, to: number) => {
				drawn.push([from, to]);
			},
		});
		const { ctx } = recorder();
		layers.paint(ctx, frame(spec(100)));
		layers.paint(ctx, frame(spec(101)));
		layers.paint(ctx, frame(spec(102)));
		layers.paint(ctx, frame(spec(103)));
		// Frame 1 is new; frame 2 changes at 40 (first sighting); frame 3 holds
		// at 40, so the prefix [0, 40) is painted into the layer and only the
		// tail into the canvas; frame 4 reuses it.
		expect(drawn).toEqual([
			[0, 41],
			[0, 41],
			[0, 40],
			[40, 41],
			[40, 41],
		]);
	});

	it("drops the prefix when something inside it changes", () => {
		const layers = cache();
		const still = Array.from({ length: 40 }, (_, i) => spec(i));
		const drawn: Array<[number, number]> = [];
		const frame = (specs: ShapeSpec[]) => ({
			specs,
			view: IDENTITY,
			width: 10,
			height: 10,
			key: [],
			background: () => {},
			draw: (_: CanvasRenderingContext2D, from: number, to: number) => {
				drawn.push([from, to]);
			},
		});
		const { ctx } = recorder();
		for (const tail of [100, 101, 102])
			layers.paint(ctx, frame([...still, spec(tail)]));
		drawn.length = 0;
		const changed = [...still];
		changed[3] = spec(999);
		layers.paint(ctx, frame([...changed, spec(103)]));
		expect(drawn).toEqual([[0, 41]]);
	});

	it("draws a moved copy when only the view changes over an expensive scene", () => {
		const layers = cache();
		const many = [
			{
				...marks([0, 0], "red"),
				count: 5000,
			} as MarksSpec,
		];
		const drawn: number[] = [];
		const frame = (e: number) => ({
			specs: many,
			view: { ...IDENTITY, e },
			width: 100,
			height: 100,
			key: [],
			background: () => {},
			draw: () => {
				drawn.push(e);
			},
		});
		const { ctx, calls } = recorder();
		expect(layers.paint(ctx, frame(0))).toBe("full");
		expect(layers.paint(ctx, frame(5))).toBe("blit");
		expect(drawn).toEqual([0]);
		expect(calls.some((c) => c[0] === "drawImage")).toBe(true);
		// A move exposing most of the viewport paints in full again.
		expect(layers.paint(ctx, frame(90))).toBe("full");
	});
});

describe("per-item reveals", () => {
	/** An open L, 20 units long: 10 along x, then 10 up. */
	const ell: MarkOutline = {
		polylines: [
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
			],
		],
		closed: false,
	};
	/** A closed 10-unit square, its last point back on its first: 40 long. */
	const square: MarkOutline = {
		polylines: [
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
				{ x: 0, y: 0 },
			],
		],
		closed: true,
	};
	const stroked: StrokeStyle = { ...style, stroke: "#000", strokeWidth: 1 };

	/** `count` items of `outline`, all centred at (100, 0). */
	function revealing(
		outline: MarkOutline,
		progresses: number[],
		extra: Partial<MarksSpec> = {},
	): MarksSpec {
		const count = progresses.length;
		return marks(new Array(count * 2).fill(0), "none", {
			shape: { kind: "outline", ...outline },
			centers: new Float64Array(count * 2).map((_, k) => (k % 2 ? 0 : 100)),
			extents: new Float64Array(count).fill(20),
			style: stroked,
			progresses: new Float32Array(progresses),
			...extra,
		});
	}

	const pathOps = (calls: Call[]) =>
		calls.filter(([name]) =>
			["moveTo", "lineTo", "bezierCurveTo", "closePath"].includes(name),
		);
	const alphas = (calls: Call[]) =>
		calls.filter((c) => c[0] === "globalAlpha=").map((c) => c[1] as number);

	it("traces a partly revealed polyline outline up to its budget, open", () => {
		const { ctx, calls } = recorder();
		drawMarks(ctx, revealing(ell, [0.75]), createPaintCache(), null);
		expect(pathOps(calls)).toEqual([
			["moveTo", 100, 0],
			["lineTo", 110, 0],
			["lineTo", 110, 5],
		]);
		expect(ops(calls).filter((op) => op === "stroke")).toHaveLength(1);
	});

	it("spends one budget across subpaths in order", () => {
		const twoStrokes: MarkOutline = {
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
				[
					{ x: 0, y: 5 },
					{ x: 10, y: 5 },
				],
			],
			closed: false,
		};
		const { ctx, calls } = recorder();
		drawMarks(ctx, revealing(twoStrokes, [0.75]), createPaintCache(), null);
		expect(pathOps(calls)).toEqual([
			["moveTo", 100, 0],
			["lineTo", 110, 0],
			["moveTo", 100, 5],
			["lineTo", 105, 5],
		]);
	});

	it("cuts a curve outline exactly, by arc length", () => {
		const line: MarkOutline = {
			polylines: [
				[
					{ x: 0, y: 0 },
					{ x: 30, y: 0 },
				],
			],
			curvePaths: [
				{
					start: { x: 0, y: 0 },
					segments: [
						{ c1: { x: 10, y: 0 }, c2: { x: 20, y: 0 }, to: { x: 30, y: 0 } },
					],
					closed: false,
				},
			],
			closed: false,
		};
		const { ctx, calls } = recorder();
		drawMarks(ctx, revealing(line, [0.5]), createPaintCache(), null);
		const path = pathOps(calls);
		expect(path[0]).toEqual(["moveTo", 100, 0]);
		expect(path).toHaveLength(2);
		const [name, , , , , endX, endY] = path[1];
		expect(name).toBe("bezierCurveTo");
		expect(endX as number).toBeCloseTo(115, 6);
		expect(endY).toBe(0);
	});

	it("measures a shared outline once, and only for partly revealed items", () => {
		const shared: MarkOutline = { ...ell, polylines: [...ell.polylines] };
		const before = revealMeasures.count;
		drawMarks(
			recorder().ctx,
			revealing(shared, [1, 0, 1]),
			createPaintCache(),
			null,
		);
		expect(revealMeasures.count).toBe(before);
		drawMarks(
			recorder().ctx,
			revealing(shared, [0.2, 0.5, 0.9]),
			createPaintCache(),
			null,
		);
		expect(revealMeasures.count).toBe(before + 1);
		// A `paths` layer whose items share the outline (and a later frame of
		// the same geometry) reuse that table.
		drawMarks(
			recorder().ctx,
			revealing(shared, [0.3, 0.6], {
				shape: { kind: "paths", outlines: [shared, shared] },
			}),
			createPaintCache(),
			null,
		);
		expect(revealMeasures.count).toBe(before + 1);
	});

	it("fills a closed outline whole at its fill opacity times its progress", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			revealing(square, [0.4], {
				fills: "red",
				style: { ...style, fillOpacity: 0.5 },
			}),
			createPaintCache(),
			null,
		);
		const fillAlphas = alphas(calls);
		expect(fillAlphas).toHaveLength(2);
		// Float32 progresses: 0.4 is stored as the nearest single.
		expect(fillAlphas[1]).toBeCloseTo(0.5 * 0.4, 6);
		expect(pathOps(calls)).toHaveLength(6);
		expect(pathOps(calls).at(-1)).toEqual(["closePath"]);
		expect(ops(calls).filter((op) => op === "fill")).toHaveLength(1);
		expect(ops(calls)).not.toContain("stroke");
	});

	it("fills a partly revealed item at its own alpha between opaque ones", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			revealing(square, [0.5, 1, 1], { fills: "red", style }),
			createPaintCache(),
			null,
		);
		// The first item fills at half alpha; the other two at full.
		expect(ops(calls).filter((op) => op === "fill")).toHaveLength(3);
		expect(alphas(calls)).toEqual([1, 0.5, 1]);
	});

	it("fills and strokes a closed outline: whole fill, revealed stroke", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			revealing(square, [0.5], { fills: "red" }),
			createPaintCache(),
			null,
		);
		const sequence = ops(calls).filter((op) =>
			["beginPath", "fill", "stroke", "closePath"].includes(op),
		);
		expect(sequence).toEqual([
			"beginPath",
			"closePath",
			"fill",
			"beginPath",
			"stroke",
		]);
	});

	it("paints nothing for an item at progress 0", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			revealing(square, [0], { fills: "red" }),
			createPaintCache(),
			null,
		);
		for (const op of ["beginPath", "fill", "stroke", "moveTo"])
			expect(ops(calls)).not.toContain(op);
	});

	it("fades a stroke shorter than its width, as a round cap would be a dot", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			// 10% of 20 units is 2, half the 4-unit width.
			revealing(ell, [0.1], { style: { ...stroked, strokeWidth: 4 } }),
			createPaintCache(),
			null,
		);
		expect(alphas(calls).at(-1)).toBeCloseTo(0.5, 6);
	});

	it("measures the drawn length in scene units, through the item's scale", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			// Doubled, 10% of 20 units is 4 scene units: half the 8-unit width.
			revealing(ell, [0.1], {
				style: { ...stroked, strokeWidth: 8 },
				transforms: new Float64Array([2, 0, 0, 2]),
			}),
			createPaintCache(),
			null,
		);
		expect(alphas(calls).at(-1)).toBeCloseTo(0.5, 6);
		const path = pathOps(calls);
		expect(path[0]).toEqual(["moveTo", 100, 0]);
		expect(path[1][1] as number).toBeCloseTo(104, 6);
	});

	it("draws an all-revealed layer with the same path calls as none", () => {
		const plain = recorder();
		const revealed = recorder();
		const layer = revealing(square, [1, 1], { fills: "red" });
		drawMarks(revealed.ctx, layer, createPaintCache(), null);
		drawMarks(
			plain.ctx,
			{ ...layer, progresses: null },
			createPaintCache(),
			null,
		);
		expect(revealed.calls).toEqual(plain.calls);
	});
});

describe("per-item dash offsets", () => {
	const dashed: StrokeStyle = {
		...style,
		stroke: "#000",
		strokeWidth: 1,
		dash: [2, 2],
		dashOffset: 0,
	};

	it("sets each item's offset only when it changes, and only where it dashes", () => {
		const { ctx, calls } = recorder();
		drawMarks(
			ctx,
			marks([0, 0, 1, 0, 2, 0, 3, 0], "none", {
				style: dashed,
				dashes: [[2, 2], [2, 2], null, [2, 2]],
				dashOffsets: new Float32Array([0, 3, 7, 3]),
			}),
			createPaintCache(),
			null,
		);
		const offsets = calls
			.filter((c) => c[0] === "lineDashOffset=")
			.map((c) => c[1]);
		// `applyStrokeStyle` sets the shared 0; item 1 moves it to 3; item 2 is
		// solid, so its 7 is never set and item 3's 3 is already in force.
		expect(offsets).toEqual([0, 3]);
		expect(ops(calls).filter((op) => op === "stroke")).toHaveLength(4);
	});
});

describe("splat with per-item reveals", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("declines a layer with progresses or dash offsets, which it would splat otherwise", () => {
		// A raster to splat into, so a plain layer does qualify here.
		vi.stubGlobal(
			"ImageData",
			class {
				width: number;
				height: number;
				data: Uint8ClampedArray;
				constructor(width: number, height: number) {
					this.width = width;
					this.height = height;
					this.data = new Uint8ClampedArray(width * height * 4);
				}
			},
		);
		vi.stubGlobal(
			"OffscreenCanvas",
			class {
				getContext() {
					return recorder().ctx;
				}
			},
		);
		const count = 2000;
		const layer = marks(new Array(count * 2).fill(0), "red", {
			extents: new Float64Array(count).fill(0.1),
			bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
		});
		const view = { a: 10, b: 0, c: 0, d: 10, e: 50, f: 50 };
		const viewport = { x: 0, y: 0, width: 100, height: 100 };
		expect(splatMarks(recorder().ctx, layer, view, viewport)).toBe(true);
		for (const extra of [
			{ progresses: new Float32Array(count).fill(1) },
			{ dashOffsets: new Float32Array(count) },
		]) {
			const { ctx, calls } = recorder();
			expect(splatMarks(ctx, { ...layer, ...extra }, view, viewport)).toBe(
				false,
			);
			expect(calls).toEqual([]);
		}
	});
});
