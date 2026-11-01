/**
 * Tests for `compileFrame`, the canvas-free half of the paint pipeline.
 *
 * `compileFrame` takes `SpecSource[]` (`{ id, spec: () => DrawSpec | null }`,
 * plain data from `spec/types.ts`). The geometry below is built with the same
 * pure helpers a shape would use (`geometry/shapes.ts`,
 * `geometry/transform.ts`) and packaged into specs by hand. The incremental
 * collector's tests (checked against `compileFrame` after every kind of
 * change) live with the scene graph, which owns the collector.
 */

import { describe, expect, it } from "vitest";
import { circlePolyline, rectPolyline } from "../geometry/shapes.js";
import type { Matrix } from "../geometry/transform.js";
import {
	applyToPolyline,
	compose,
	fromTranslationRotationScale,
	IDENTITY,
} from "../geometry/transform.js";
import { compileFrame } from "./compile.js";
import type {
	DrawSpec,
	ShapeSpec,
	SpecSource,
	StrokeStyle,
	TextSpec,
	TextStyle,
} from "./types.js";

const defaultStyle: StrokeStyle = {
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

/** A circle `ShapeSpec`, transformed by `m` — the same shape `circle` bakes. */
function circleSpec(options: {
	cx?: number;
	cy?: number;
	r: number;
	zIndex?: number;
	m?: Matrix;
	style?: Partial<StrokeStyle>;
}): ShapeSpec {
	const m = options.m ?? IDENTITY;
	const line = circlePolyline(options.cx ?? 0, options.cy ?? 0, options.r, 16);
	return {
		kind: "shape",
		id: nextId++,
		zIndex: options.zIndex ?? 0,
		polylines: [applyToPolyline(m, line)],
		closed: true,
		fillFrom: 0,
		style: { ...defaultStyle, ...options.style },
		progress: 1,
	};
}

/** A rectangle `ShapeSpec` — the same shape `rect` bakes. */
function rectSpec(options: {
	cx?: number;
	cy?: number;
	width: number;
	height: number;
	zIndex?: number;
	m?: Matrix;
	style?: Partial<StrokeStyle>;
}): ShapeSpec {
	const m = options.m ?? IDENTITY;
	const line = rectPolyline(
		(options.cx ?? 0) - options.width / 2,
		(options.cy ?? 0) - options.height / 2,
		options.width,
		options.height,
	);
	return {
		kind: "shape",
		id: nextId++,
		zIndex: options.zIndex ?? 0,
		polylines: [applyToPolyline(m, line)],
		closed: true,
		fillFrom: 0,
		style: { ...defaultStyle, ...options.style },
		progress: 1,
	};
}

/** A `group`'s transform at `x`, `y`, composed onto `parent`. */
function groupMatrix(x: number, y: number, parent: Matrix = IDENTITY): Matrix {
	return compose(parent, fromTranslationRotationScale({ x, y }));
}

/** Wraps a spec (or `null`, for a hidden/empty node) as a `SpecSource`. */
function node(spec: DrawSpec | null): SpecSource {
	const id = spec?.id ?? nextId++;
	return { id, spec: () => spec };
}

const defaultTextStyle: TextStyle = {
	fill: "#000000",
	fontSize: 16,
	fontFamily: "sans-serif",
	fontWeight: 400,
	italic: false,
	align: "center",
	baseline: "alphabetic",
	opacity: 1,
	letterSpacing: 0,
};

/** A `TextSpec` — the same shape `label` bakes. */
function textSpec(options: {
	text: string;
	x?: number;
	y?: number;
	zIndex?: number;
	rotation?: number;
	progress?: number;
	style?: Partial<TextStyle>;
}): TextSpec {
	return {
		kind: "text",
		id: nextId++,
		zIndex: options.zIndex ?? 0,
		text: options.text,
		at: { x: options.x ?? 0, y: options.y ?? 0 },
		rotation: options.rotation ?? 0,
		style: { ...defaultTextStyle, ...options.style },
		progress: options.progress ?? 1,
	};
}

describe("compileFrame", () => {
	it("returns an empty array for an empty scene, not a crash", () => {
		expect(compileFrame([])).toEqual([]);
	});

	it("compiles a single shape into one ShapeSpec", () => {
		const specs = compileFrame([node(circleSpec({ r: 1 }))]);
		expect(specs).toHaveLength(1);
		const spec = specs[0] as ShapeSpec;
		expect(spec.kind).toBe("shape");
		expect(spec.closed).toBe(true);
		expect(spec.polylines).toHaveLength(1);
		expect(spec.polylines[0].length).toBeGreaterThan(0);
		for (const p of spec.polylines[0]) {
			expect(Number.isFinite(p.x)).toBe(true);
			expect(Number.isFinite(p.y)).toBe(true);
		}
	});

	it("compiles multiple shapes into multiple specs, z-sorted ascending", () => {
		const specs = compileFrame([
			node(circleSpec({ r: 1, zIndex: 5 })),
			node(rectSpec({ width: 1, height: 1, zIndex: 1 })),
			node(circleSpec({ r: 2, zIndex: 3 })),
		]);
		expect(specs).toHaveLength(3);
		expect(specs.map((s) => s.zIndex)).toEqual([1, 3, 5]);
	});

	it("keeps tree order for nodes sharing a z (stable sort)", () => {
		// Overlapping z (all 0, the default) — distinguish nodes by width instead,
		// and check the sorted output preserves the order they were registered in.
		const specs = compileFrame([
			node(rectSpec({ width: 1, height: 1 })),
			node(rectSpec({ width: 2, height: 1 })),
			node(rectSpec({ width: 3, height: 1 })),
			node(rectSpec({ width: 4, height: 1 })),
		]);
		expect(specs).toHaveLength(4);
		expect(specs.every((s) => s.zIndex === 0)).toBe(true);
		const widths = specs.map((s) => {
			const xs = (s as ShapeSpec).polylines[0].map((p) => p.x);
			return Math.max(...xs) - Math.min(...xs);
		});
		expect(widths).toEqual([1, 2, 3, 4]);
	});

	it("drops nodes whose spec() reads null (hidden/empty)", () => {
		const specs = compileFrame([
			node(circleSpec({ r: 1, zIndex: 1 })),
			node(null),
			node(rectSpec({ width: 1, height: 1, zIndex: 0 })),
		]);
		expect(specs).toHaveLength(2);
		expect(specs.every((s) => s !== null)).toBe(true);
	});

	it("handles degenerate (zero-radius / zero-size) geometry without NaN", () => {
		const specs = compileFrame([
			node(circleSpec({ r: 0 })),
			node(rectSpec({ width: 0, height: 0 })),
		]);
		expect(specs).toHaveLength(2);
		for (const spec of specs) {
			for (const line of (spec as ShapeSpec).polylines) {
				for (const p of line) {
					expect(Number.isFinite(p.x)).toBe(true);
					expect(Number.isFinite(p.y)).toBe(true);
				}
			}
		}
	});

	it("compiles a shape nested in a group's transform", () => {
		const bare = compileFrame([
			node(circleSpec({ r: 1, cx: 0, cy: 0 })),
		])[0] as ShapeSpec;
		const grouped = compileFrame([
			node(circleSpec({ r: 1, cx: 0, cy: 0, m: groupMatrix(2, 3) })),
		])[0] as ShapeSpec;

		const bareFirst = bare.polylines[0][0];
		const groupedFirst = grouped.polylines[0][0];
		expect(groupedFirst.x).toBeCloseTo(bareFirst.x + 2);
		expect(groupedFirst.y).toBeCloseTo(bareFirst.y + 3);
	});

	it("compiles a shape nested in groups within groups", () => {
		const outer = groupMatrix(1, 0);
		const inner = groupMatrix(0, 1, outer);
		const specs = compileFrame([
			node(rectSpec({ width: 1, height: 1, m: inner })),
		]);
		expect(specs).toHaveLength(1);
		const s = specs[0] as ShapeSpec;
		const xs = s.polylines[0].map((p) => p.x);
		const ys = s.polylines[0].map((p) => p.y);
		const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
		const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
		expect(cx).toBeCloseTo(1);
		expect(cy).toBeCloseTo(1);
	});

	it("produces a deterministic frame: same input, structurally equal output", () => {
		const nodes = [
			node(circleSpec({ r: 1, zIndex: 2 })),
			node(rectSpec({ width: 1, height: 1, zIndex: 0 })),
		];
		expect(compileFrame(nodes)).toEqual(compileFrame(nodes));
	});

	it("is plain, JSON-serializable data that round-trips losslessly", () => {
		const specs = compileFrame([
			node(circleSpec({ r: 1, zIndex: 2, style: { fill: "#ff0000" } })),
			node(
				rectSpec({ width: 1, height: 1, zIndex: 0, style: { dash: [1, 2] } }),
			),
		]);
		expect(specs.length).toBeGreaterThan(0);
		const roundTripped = JSON.parse(JSON.stringify(specs));
		expect(roundTripped).toEqual(specs);
	});

	describe("TextSpec nodes", () => {
		it("compiles a single text node with its fields intact", () => {
			const specs = compileFrame([
				node(textSpec({ text: "hello", x: 1, y: 2, rotation: 0.5 })),
			]);
			expect(specs).toHaveLength(1);
			const spec = specs[0] as TextSpec;
			expect(spec.kind).toBe("text");
			expect(spec.text).toBe("hello");
			expect(spec.at).toEqual({ x: 1, y: 2 });
			expect(spec.rotation).toBe(0.5);
			expect(spec.style).toEqual(defaultTextStyle);
			expect(spec.progress).toBe(1);
		});

		it("round-trips a TextSpec through JSON exactly", () => {
			const specs = compileFrame([
				node(
					textSpec({ text: "3.14", x: -2, y: 5, style: { fill: "#abcdef" } }),
				),
			]);
			const roundTripped = JSON.parse(JSON.stringify(specs));
			expect(roundTripped).toEqual(specs);
		});

		it("sorts text and shape nodes together by z, mixed", () => {
			const specs = compileFrame([
				node(textSpec({ text: "top", zIndex: 5 })),
				node(circleSpec({ r: 1, zIndex: -2 })),
				node(rectSpec({ width: 1, height: 1, zIndex: 1 })),
				node(textSpec({ text: "mid", zIndex: 0 })),
			]);
			expect(specs.map((s) => s.kind)).toEqual([
				"shape",
				"text",
				"shape",
				"text",
			]);
			expect(specs.map((s) => s.zIndex)).toEqual([-2, 0, 1, 5]);
		});

		it("drops a text node whose spec() reads null, same as a shape node", () => {
			const specs = compileFrame([
				node(textSpec({ text: "kept" })),
				node(null),
			]);
			expect(specs).toHaveLength(1);
			expect((specs[0] as TextSpec).text).toBe("kept");
		});

		it("keeps tree order for text nodes sharing a z (stable sort)", () => {
			const specs = compileFrame([
				node(textSpec({ text: "a" })),
				node(textSpec({ text: "b" })),
				node(textSpec({ text: "c" })),
			]);
			expect(specs.map((s) => (s as TextSpec).text)).toEqual(["a", "b", "c"]);
		});
	});

	describe("negative z ordering", () => {
		it("sorts negative z below zero and positive z", () => {
			const specs = compileFrame([
				node(circleSpec({ r: 1, zIndex: 3 })),
				node(circleSpec({ r: 1, zIndex: -10 })),
				node(circleSpec({ r: 1, zIndex: 0 })),
				node(circleSpec({ r: 1, zIndex: -0.5 })),
			]);
			expect(specs.map((s) => s.zIndex)).toEqual([-10, -0.5, 0, 3]);
		});

		it("sorts two negative z values relative to each other correctly", () => {
			const specs = compileFrame([
				node(circleSpec({ r: 1, zIndex: -1 })),
				node(circleSpec({ r: 1, zIndex: -100 })),
				node(circleSpec({ r: 1, zIndex: -5 })),
			]);
			expect(specs.map((s) => s.zIndex)).toEqual([-100, -5, -1]);
		});
	});

	describe("non-default opacity / fillOpacity round-trip through compileFrame", () => {
		it("preserves a shape's opacity and fillOpacity exactly", () => {
			const specs = compileFrame([
				node(
					circleSpec({
						r: 1,
						style: { opacity: 0.3, fillOpacity: 0.6 },
					}),
				),
			]);
			const spec = specs[0] as ShapeSpec;
			expect(spec.style.opacity).toBe(0.3);
			expect(spec.style.fillOpacity).toBe(0.6);
		});

		it("preserves a text node's style.opacity exactly", () => {
			const specs = compileFrame([
				node(textSpec({ text: "x", style: { opacity: 0.42 } })),
			]);
			const spec = specs[0] as TextSpec;
			expect(spec.style.opacity).toBe(0.42);
		});

		it("preserves opacity of 0 (fully transparent, not falsy-defaulted)", () => {
			const specs = compileFrame([
				node(circleSpec({ r: 1, style: { opacity: 0, fillOpacity: 0 } })),
			]);
			const spec = specs[0] as ShapeSpec;
			expect(spec.style.opacity).toBe(0);
			expect(spec.style.fillOpacity).toBe(0);
		});
	});

	describe("fillFrom (partial-fill shapes, e.g. an arrow's shaft + head)", () => {
		it("preserves a non-zero fillFrom through compileFrame", () => {
			const shaft = rectPolyline(0, -0.05, 2, 0.1);
			const head = circlePolyline(2, 0, 0.2, 12);
			const spec: ShapeSpec = {
				kind: "shape",
				id: nextId++,
				zIndex: 0,
				polylines: [shaft, head],
				closed: true,
				fillFrom: 1, // only the head (index 1) takes part in the fill
				style: defaultStyle,
				progress: 1,
			};
			const specs = compileFrame([node(spec)]);
			expect((specs[0] as ShapeSpec).fillFrom).toBe(1);
			expect((specs[0] as ShapeSpec).polylines).toHaveLength(2);
		});

		it("defaults fillFrom to 0 for an ordinary single-polyline shape", () => {
			const specs = compileFrame([node(circleSpec({ r: 1 }))]);
			expect((specs[0] as ShapeSpec).fillFrom).toBe(0);
		});
	});
});
