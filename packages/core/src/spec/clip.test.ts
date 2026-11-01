/**
 * Clip-region maths: boxes, polygons and ring lists to rings, bounds
 * intersected across nested regions. (Baking through a group's matrix is the
 * scene graph's; picking through a clip is in `interact/hit.test.ts`; the
 * paint half is in `render/canvas-renderer.test.ts`.)
 */

import { describe, expect, it } from "vitest";
import { clipBounds, clipBox, clipOf, clipRings, nestClip } from "./clip.js";
import type { ClipRegion } from "./types.js";

const unit = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

describe("clipRings / clipBounds / clipBox", () => {
	it("a box becomes its four corners; a polygon one ring; a ring list stays", () => {
		expect(clipRings(unit)).toEqual([
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 1, y: 1 },
				{ x: 0, y: 1 },
			],
		]);
		const tri = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 2 },
		];
		expect(clipRings(tri)).toEqual([tri]);
		expect(clipRings([tri, tri])).toHaveLength(2);
	});

	it("bounds intersect across regions; a box outside them is gone", () => {
		const a: ClipRegion = { rings: clipRings(unit) };
		const b: ClipRegion = {
			rings: clipRings({ minX: 0.5, minY: -1, maxX: 3, maxY: 0.75 }),
		};
		expect(clipBounds([a, b])).toEqual({
			minX: 0.5,
			minY: 0,
			maxX: 1,
			maxY: 0.75,
		});
		expect(clipBounds(undefined)).toBeNull();
		expect(clipBox({ minX: -1, minY: -1, maxX: 0.8, maxY: 5 }, [a])).toEqual({
			minX: 0,
			minY: 0,
			maxX: 0.8,
			maxY: 1,
		});
		expect(clipBox({ minX: 2, minY: 2, maxX: 3, maxY: 3 }, [a])).toBeNull();
	});
});

describe("clipOf / nestClip", () => {
	it("an unclipped space adds no clip key at all", () => {
		expect(clipOf({})).toEqual({});
		expect("clip" in clipOf({ clip: undefined })).toBe(false);
		const list: ClipRegion[] = [{ rings: clipRings(unit) }];
		expect(clipOf({ clip: list }).clip).toBe(list);
	});

	it("nesting nothing hands the parent's list down by identity", () => {
		const list: ClipRegion[] = [{ rings: clipRings(unit) }];
		const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
		expect(nestClip(list, undefined, identity)).toBe(list);
		const nested = nestClip(list, unit, { ...identity, e: 2 });
		expect(nested).toHaveLength(2);
		expect(nested?.[0]).toBe(list[0]);
		expect(nested?.[1].rings[0][0]).toEqual({ x: 2, y: 0 });
	});
});
