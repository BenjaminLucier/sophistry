import { describe, expect, it } from "vitest";
import type { Polyline } from "./path/types.js";
import type { ShapePart } from "./shape-match.js";
import { matchShapesByPointCloud, morphShapes } from "./shape-match.js";

function square(cx: number, cy: number, size: number): Polyline {
	const h = size / 2;
	return [
		{ x: cx - h, y: cy - h },
		{ x: cx + h, y: cy - h },
		{ x: cx + h, y: cy + h },
		{ x: cx - h, y: cy + h },
	];
}

function triangle(cx: number, cy: number, size: number): Polyline {
	return [
		{ x: cx, y: cy - size },
		{ x: cx + size, y: cy + size },
		{ x: cx - size, y: cy + size },
	];
}

function shape(polylines: Polyline[], id?: string): ShapePart {
	return { id, polylines: polylines };
}

describe("matchShapesByPointCloud", () => {
	it("pairs identical shapes 1:1", () => {
		const source: ShapePart[] = [
			shape([square(0, 0, 2)], "a"),
			shape([triangle(10, 10, 2)], "b"),
		];
		const target: ShapePart[] = [
			shape([square(0, 0, 2)], "a2"),
			shape([triangle(10, 10, 2)], "b2"),
		];
		const { pairs, sourceOnly, targetOnly } = matchShapesByPointCloud(
			source,
			target,
		);
		expect(pairs.length).toBe(2);
		expect(sourceOnly).toHaveLength(0);
		expect(targetOnly).toHaveLength(0);
		// A square should pair with a square, not the triangle.
		const squarePair = pairs.find(([s]) => s.id === "a");
		expect(squarePair?.[1].id).toBe("a2");
	});

	it("pairs a translated and scaled copy of the same shape", () => {
		const source: ShapePart[] = [shape([square(0, 0, 2)], "src")];
		const target: ShapePart[] = [shape([square(100, -50, 40)], "dst")];
		const { pairs, sourceOnly, targetOnly } = matchShapesByPointCloud(
			source,
			target,
		);
		expect(pairs).toHaveLength(1);
		expect(pairs[0][0].id).toBe("src");
		expect(pairs[0][1].id).toBe("dst");
		expect(sourceOnly).toHaveLength(0);
		expect(targetOnly).toHaveLength(0);
	});

	it("a square still matches its own translated/scaled copy over an unrelated triangle", () => {
		const source: ShapePart[] = [shape([square(0, 0, 2)], "square")];
		const target: ShapePart[] = [
			shape([triangle(0, 0, 2)], "triangle"),
			shape([square(50, 50, 20)], "bigSquare"),
		];
		const { pairs } = matchShapesByPointCloud(source, target);
		expect(pairs).toHaveLength(1);
		expect(pairs[0][1].id).toBe("bigSquare");
	});

	it("genuinely different counts leave the surplus unmatched", () => {
		const source: ShapePart[] = [
			shape([square(0, 0, 2)], "a"),
			shape([triangle(10, 10, 2)], "b"),
			shape([square(20, 20, 2)], "c"),
		];
		const target: ShapePart[] = [shape([square(0, 0, 2)], "only")];
		const { pairs, sourceOnly, targetOnly } = matchShapesByPointCloud(
			source,
			target,
		);
		expect(pairs).toHaveLength(1);
		expect(sourceOnly).toHaveLength(2);
		expect(targetOnly).toHaveLength(0);
	});

	it("maxCost leaves a poor match unmatched instead of forcing it", () => {
		const source: ShapePart[] = [shape([square(0, 0, 2)], "sq")];
		const target: ShapePart[] = [shape([triangle(0, 0, 2)], "tri")];
		const { pairs, sourceOnly, targetOnly } = matchShapesByPointCloud(
			source,
			target,
			{ maxCost: 0.0001 },
		);
		expect(pairs).toHaveLength(0);
		expect(sourceOnly).toHaveLength(1);
		expect(targetOnly).toHaveLength(1);
	});

	it("is deterministic across repeated calls on the same input", () => {
		const source: ShapePart[] = [
			shape([square(0, 0, 2)], "a"),
			shape([square(0, 0, 2.01)], "b"),
		];
		const target: ShapePart[] = [
			shape([square(0, 0, 2)], "x"),
			shape([square(0, 0, 2.01)], "y"),
		];
		const first = matchShapesByPointCloud(source, target);
		const second = matchShapesByPointCloud(source, target);
		expect(first.pairs.map(([s, t]) => [s.id, t.id])).toEqual(
			second.pairs.map(([s, t]) => [s.id, t.id]),
		);
	});
});

describe("morphShapes", () => {
	it("t=0 is exactly from, t=1 is exactly to for a matched pair", () => {
		const from: ShapePart[] = [shape([square(0, 0, 2)], "a")];
		const to: ShapePart[] = [shape([square(10, 10, 2)], "a2")];
		const sample = morphShapes(from, to);
		const at0 = sample(0);
		const at1 = sample(1);
		expect(at0).toHaveLength(1);
		expect(at0[0].role).toBe("moved");
		expect(at0[0].opacity).toBe(1);
		// `morphPolylines` resamples both ends to a common vertex count, so t=0
		// is a resample of the source rather than its literal corner points —
		// check it lies on the source square's boundary instead of exact equality.
		for (const p of at0[0].polylines[0]) {
			expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeCloseTo(1, 5);
		}
		for (const p of at1[0].polylines[0]) {
			expect(Math.max(Math.abs(p.x - 10), Math.abs(p.y - 10))).toBeCloseTo(
				1,
				5,
			);
		}
	});

	it("unmatched parts cross-fade rather than jump", () => {
		const from: ShapePart[] = [shape([square(0, 0, 2)], "gone")];
		const to: ShapePart[] = [shape([triangle(50, 50, 2)], "new")];
		const sample = morphShapes(from, to, { maxCost: 0 });
		const mid = sample(0.5);
		const out = mid.find((p) => p.role === "out");
		const inPart = mid.find((p) => p.role === "in");
		expect(out).toBeDefined();
		expect(inPart).toBeDefined();
		expect(out?.opacity).toBeGreaterThan(0);
		expect(inPart?.opacity).toBeGreaterThan(0);
	});

	it("part ids stay stable across t so a caller can key nodes on them", () => {
		const from: ShapePart[] = [shape([square(0, 0, 2)], "a")];
		const to: ShapePart[] = [shape([square(5, 5, 2)], "b")];
		const sample = morphShapes(from, to);
		expect(sample(0)[0].id).toBe(sample(1)[0].id);
	});
});
