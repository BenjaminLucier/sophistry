import type { Polyline } from "@sophistry/core/geometry";
import { boundsOf } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import { morphLatex } from "./morph";
import type { PlacedLatex, PlacedPart } from "./placed";

/** A square "glyph" of side `size` with its lower-left corner at (x, y). */
function glyph(char: string, x: number, y: number, size = 1): PlacedPart {
	const ring: Polyline = [
		{ x, y },
		{ x: x + size, y },
		{ x: x + size, y: y + size },
		{ x, y: y + size },
		{ x, y },
	];
	return { kind: "glyph", char, polylines: [ring], box: boundsOf([ring]) };
}

function formula(...parts: PlacedPart[]): PlacedLatex {
	return { parts, width: 10, height: 2 };
}

function centerX(polylines: Polyline[]): number {
	const box = boundsOf(polylines);
	return (box.minX + box.maxX) / 2;
}

describe("morphLatex", () => {
	it("sends an exponent to the exponent, not to the nearer full-size twin", () => {
		// `x^2 + 2` into `y^2`: the target's 2 is small, like the source's
		// exponent, though the coefficient 2 sits closer to it.
		const from = formula(glyph("2", 0, 1, 0.7), glyph("2", 3, 0, 1));
		const to = formula(glyph("2", 4, 1, 0.7));
		const moved = morphLatex(from, to)(0).find((p) => p.role === "moved");
		expect(moved && centerX(moved.polylines)).toBeCloseTo(0.35, 9);
	});

	it("drifts what leaves toward where the new parts arrive, as it fades", () => {
		const from = formula(glyph("a", 0, 0));
		const to = formula(glyph("b", 6, 0));
		const morph = morphLatex(from, to);
		const out = (t: number) => {
			const part = morph(t).find((p) => p.role === "out");
			return part ? centerX(part.polylines) : Number.NaN;
		};
		expect(out(0)).toBeCloseTo(0.5, 9);
		expect(out(0.5)).toBeCloseTo(3.5, 9);
		// What arrives fades in where it lands.
		const arriving = morph(0.5).find((p) => p.role === "in");
		expect(arriving && centerX(arriving.polylines)).toBeCloseTo(6.5, 9);
	});

	it('with mismatch "morph", reshapes a leftover into its partner instead of fading', () => {
		const from = formula(glyph("a", 0, 0));
		const to = formula(glyph("b", 4, 0, 2));
		const parts = morphLatex(from, to, { mismatch: "morph" });
		const at = (t: number) => parts(t);
		expect(at(0.5).map((p) => p.role)).toEqual(["morphed"]);
		expect(at(0.5)[0].opacity).toBe(1);
		expect(boundsOf(at(1)[0].polylines)).toEqual(
			boundsOf(to.parts[0].polylines),
		);
	});
});
