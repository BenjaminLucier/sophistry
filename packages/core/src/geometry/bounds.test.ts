import { describe, expect, it } from "vitest";
import { boundsOf, boundsUnder, unionBounds } from "./bounds.js";
import type { Polyline } from "./path/types.js";
import {
	applyToPolyline,
	fromTranslationRotationScale,
	IDENTITY,
} from "./transform.js";

describe("boundsUnder", () => {
	const lines: Polyline[] = [
		[
			{ x: 0.1, y: -2.3 },
			{ x: 1.7, y: 0.3 },
		],
		[],
		[{ x: -0.9, y: 4.1 }],
	];

	it("matches mapping then measuring, bit for bit, without the copies", () => {
		for (const m of [
			IDENTITY,
			fromTranslationRotationScale({
				x: 0.3,
				y: -1.1,
				rotation: 0.7,
				scaleX: 1.3,
			}),
			fromTranslationRotationScale({
				scaleX: -2,
				scaleY: 0.5,
				origin: { x: 1, y: 1 },
			}),
		]) {
			expect(boundsUnder(m, lines)).toEqual(
				boundsOf(lines.map((line) => applyToPolyline(m, line))),
			);
		}
	});

	it("is null with no points", () => {
		expect(boundsUnder(IDENTITY, [])).toBeNull();
		expect(boundsUnder(IDENTITY, [[], []])).toBeNull();
	});
});

describe("unionBounds", () => {
	it("combines boxes, skipping missing ones; null when empty", () => {
		expect(unionBounds()).toBeNull();
		expect(
			unionBounds(
				null,
				{ minX: 0, minY: 0, maxX: 1, maxY: 1 },
				{ minX: -1, minY: 0.5, maxX: 0.5, maxY: 3 },
			),
		).toEqual({ minX: -1, minY: 0, maxX: 1, maxY: 3 });
	});
});
