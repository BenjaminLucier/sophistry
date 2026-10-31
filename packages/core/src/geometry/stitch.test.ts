import { describe, expect, it } from "vitest";
import { stitchSegments } from "./stitch";

describe("stitchSegments", () => {
	it("joins an open chain from a free end, whatever order the segments come in", () => {
		expect(
			stitchSegments([
				[2, 3],
				[1, 2],
				[3, 4],
			]),
		).toEqual([{ keys: [1, 2, 3, 4], segments: [1, 0, 2], closed: false }]);
	});

	it("follows reversed segments either way", () => {
		const pairs: [number, number][] = [
			[2, 1],
			[3, 2],
			[3, 4],
		];
		expect(stitchSegments(pairs)).toEqual([
			{ keys: [1, 2, 3, 4], segments: [0, 1, 2], closed: false },
		]);
		// In order: the first segment's direction (2 → 1) sets the run's.
		expect(stitchSegments(pairs, "in-order")).toEqual([
			{ keys: [4, 3, 2, 1], segments: [2, 1, 0], closed: false },
		]);
	});

	it("closes a ring without repeating its first key", () => {
		const ring: [number, number][] = [
			[0, 1],
			[1, 2],
			[2, 3],
			[3, 0],
		];
		const expected = [
			{ keys: [0, 1, 2, 3], segments: [0, 1, 2, 3], closed: true },
		];
		expect(stitchSegments(ring)).toEqual(expected);
		expect(stitchSegments(ring, "in-order")).toEqual(expected);
		// A ring whose first segment is reversed starts there and runs its way.
		expect(
			stitchSegments([
				[1, 0],
				[1, 2],
				[2, 3],
				[3, 0],
			]),
		).toEqual([{ keys: [1, 0, 3, 2], segments: [0, 3, 2, 1], closed: true }]);
	});

	it("separates components: open runs first, or in segment order", () => {
		const pairs: [number, number][] = [
			[0, 1],
			[10, 11],
			[1, 2],
			[2, 0],
			[11, 12],
		];
		const chain = { keys: [10, 11, 12], segments: [1, 4], closed: false };
		const ring = { keys: [0, 1, 2], segments: [0, 2, 3], closed: true };
		expect(stitchSegments(pairs)).toEqual([chain, ring]);
		expect(stitchSegments(pairs, "in-order")).toEqual([ring, chain]);
	});

	it("passes through a saddle point shared by four segments without splitting a run", () => {
		// Two curves crossing at key 5 (a corner exactly on the level).
		expect(
			stitchSegments([
				[1, 5],
				[5, 2],
				[3, 5],
				[5, 4],
			]),
		).toEqual([
			{ keys: [1, 5, 2], segments: [0, 1], closed: false },
			{ keys: [3, 5, 4], segments: [2, 3], closed: false },
		]);
	});

	it("keeps the two crossings of a saddle cell apart when paired apart", () => {
		// One cell's four edge crossings (top 0, right 1, bottom 2, left 3), paired
		// by the saddle tie-break.
		expect(
			stitchSegments([
				[0, 1],
				[2, 3],
			]).map((run) => run.keys),
		).toEqual([
			[0, 1],
			[2, 3],
		]);
	});

	it("does not call a there-and-back pair closed, and keeps a zero-length segment", () => {
		expect(
			stitchSegments([
				[0, 1],
				[1, 0],
			]),
		).toEqual([{ keys: [0, 1, 0], segments: [0, 1], closed: false }]);
		expect(stitchSegments([[7, 7]])).toEqual([
			{ keys: [7, 7], segments: [0], closed: false },
		]);
	});

	it("works with string keys", () => {
		expect(
			stitchSegments([
				["b", "c"],
				["a", "b"],
			]).map((run) => run.keys),
		).toEqual([["c", "b", "a"]]);
		expect(stitchSegments([])).toEqual([]);
	});
});
