import type { Point } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { barbGlyph } from "./barbs";

function isFinitePoint(point: Point): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

describe("barbGlyph", () => {
	it("draws a bare shaft, no ticks, for zero magnitude", () => {
		const glyph = barbGlyph(0);
		expect(glyph.pennants).toBe(0);
		expect(glyph.fullBarbs).toBe(0);
		expect(glyph.halfBarbs).toBe(0);
		expect(glyph.segments).toHaveLength(1);
		expect(glyph.segments[0]).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		]);
	});

	// 5 kt rounds to 5 -> one half barb: 0*50 + 0*10 + 5.
	it("draws one half barb for 5", () => {
		const glyph = barbGlyph(5);
		expect(glyph).toMatchObject({ pennants: 0, fullBarbs: 0, halfBarbs: 1 });
		expect(glyph.segments).toHaveLength(2);
	});

	// 15 kt -> one full barb (10) + one half barb (5).
	it("draws one full barb and one half barb for 15", () => {
		const glyph = barbGlyph(15);
		expect(glyph).toMatchObject({ pennants: 0, fullBarbs: 1, halfBarbs: 1 });
		expect(glyph.segments).toHaveLength(3);
	});

	// 47 kt rounds to nearest 5 -> 45 -> 4 full barbs (40) + 1 half barb (5).
	it("rounds 47 to 45 and draws 4 full barbs + 1 half barb", () => {
		const glyph = barbGlyph(47);
		expect(glyph).toMatchObject({ pennants: 0, fullBarbs: 4, halfBarbs: 1 });
		expect(glyph.segments).toHaveLength(6);
	});

	// 52 kt rounds to 50 -> one pennant, nothing else.
	it("draws one pennant for 52", () => {
		const glyph = barbGlyph(52);
		expect(glyph).toMatchObject({ pennants: 1, fullBarbs: 0, halfBarbs: 0 });
		expect(glyph.segments).toHaveLength(2);
	});

	// 65 kt -> one pennant (50) + one full barb (10) + one half barb (5).
	it("draws one pennant, one full barb and one half barb for 65", () => {
		const glyph = barbGlyph(65);
		expect(glyph).toMatchObject({ pennants: 1, fullBarbs: 1, halfBarbs: 1 });
		expect(glyph.segments).toHaveLength(4);
	});

	// 100 kt -> two pennants.
	it("draws two pennants for 100", () => {
		const glyph = barbGlyph(100);
		expect(glyph).toMatchObject({ pennants: 2, fullBarbs: 0, halfBarbs: 0 });
		expect(glyph.segments).toHaveLength(3);
	});

	it("treats negative magnitude as calm", () => {
		const glyph = barbGlyph(-10);
		expect(glyph).toMatchObject({ pennants: 0, fullBarbs: 0, halfBarbs: 0 });
		expect(glyph.segments).toHaveLength(1);
	});

	it("treats NaN magnitude as calm", () => {
		const glyph = barbGlyph(Number.NaN);
		expect(glyph).toMatchObject({ pennants: 0, fullBarbs: 0, halfBarbs: 0 });
		expect(glyph.segments).toHaveLength(1);
	});

	it("rounds a sub-2.5 remainder down to no half barb", () => {
		// 12 kt rounds to nearest 5 -> 10 -> one full barb, no half barb.
		const glyph = barbGlyph(12);
		expect(glyph).toMatchObject({ pennants: 0, fullBarbs: 1, halfBarbs: 0 });
	});

	it("produces well-formed, finite segments", () => {
		for (const magnitude of [0, 3, 5, 15, 33, 47, 52, 65, 100, 137]) {
			const glyph = barbGlyph(magnitude);
			expect(glyph.segments.length).toBeGreaterThan(0);
			for (const segment of glyph.segments) {
				expect(segment.length).toBeGreaterThanOrEqual(2);
				for (const point of segment) expect(isFinitePoint(point)).toBe(true);
			}
		}
	});

	it("honours shaftLength/barbSpacing/barbLength overrides", () => {
		const glyph = barbGlyph(15, {
			shaftLength: 2,
			barbSpacing: 0.5,
			barbLength: 1,
		});
		expect(glyph.segments[0]).toEqual([
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
		]);
		// The full barb tip stands off the shaft by `barbLength` at 45°.
		const fullBarb = glyph.segments[1];
		expect(fullBarb[0]).toEqual({ x: 2, y: 0 });
		expect(fullBarb[1].x).toBeCloseTo(2 + Math.cos(Math.PI / 4), 10);
		expect(fullBarb[1].y).toBeCloseTo(-Math.sin(Math.PI / 4), 10);
	});
});
