import { describe, expect, it } from "vitest";
import { keyframeAt, raceTimeline, trailPolyline } from "./keyframes";

describe("keyframeAt", () => {
	it("finds the keyframes either side and the blend between", () => {
		expect(keyframeAt([0, 10, 20], 15)).toEqual({ lo: 1, hi: 2, u: 0.5 });
		expect(keyframeAt([0, 10, 20], 10)).toEqual({ lo: 1, hi: 1, u: 0 });
		expect(keyframeAt([0, 10, 20], 20)).toEqual({ lo: 2, hi: 2, u: 0 });
		expect(keyframeAt([0, 10, 20], 0)).toEqual({ lo: 0, hi: 0, u: 0 });
	});

	it("is undefined outside the keyframes", () => {
		expect(keyframeAt([0, 10], -1)).toBeUndefined();
		expect(keyframeAt([0, 10], 11)).toBeUndefined();
		expect(keyframeAt([], 0)).toBeUndefined();
	});
});

describe("trailPolyline", () => {
	const points = [
		{ x: 0, y: 0 },
		{ x: 1, y: 2 },
		{ x: 2, y: 2 },
	];
	const times = [0, 1, 2];

	it("runs from the first keyframe to the interpolated present", () => {
		expect(trailPolyline(points, times, 1.5)).toEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 2 },
			{ x: 1.5, y: 2 },
		]);
	});

	it("keeps only the last `length` of time, cut by interpolation", () => {
		expect(trailPolyline(points, times, 2, 0.5)).toEqual([
			{ x: 1.5, y: 2 },
			{ x: 2, y: 2 },
		]);
	});

	it("is empty before the first keyframe, and stops at the last", () => {
		expect(trailPolyline(points, times, -1)).toEqual([]);
		expect(trailPolyline(points, times, 5)).toEqual(points);
	});
});

describe("raceTimeline", () => {
	const keys = ["a", "b", "c"];
	const times = [0, 1];
	// a overtakes b at t = 0.25 and c at t = 0.5.
	const values = [
		[1, 2, 3],
		[5, 2, 3],
	];

	it("interpolates values and ranks them, largest first", () => {
		const race = raceTimeline(keys, times, values, { swap: 0 });
		expect(race.at(0).map((e) => e.rank)).toEqual([2, 1, 0]);
		const end = race.at(1);
		expect(end.map((e) => e.value)).toEqual([5, 2, 3]);
		expect(end.map((e) => e.rank)).toEqual([0, 2, 1]);
	});

	it("swaps exactly where interpolated values cross", () => {
		const race = raceTimeline(keys, times, values, { swap: 0 });
		expect(race.at(0.24)[0].rank).toBe(2);
		expect(race.at(0.26)[0].rank).toBe(1);
		expect(race.at(0.51)[0].rank).toBe(0);
	});

	it("slides each swap on its own ease, settling on the rank after `swap`", () => {
		const race = raceTimeline(keys, times, values, { swap: 0.1 });
		const a = (t: number) => race.at(t)[0];
		// The rank changes at once; the drawn position follows.
		expect(a(0.26).rank).toBe(1);
		expect(a(0.26).position).toBeGreaterThan(1.9);
		expect(a(0.3).position).toBeCloseTo(1.5);
		expect(a(0.36).position).toBeCloseTo(1);
		expect(a(1).position).toBeCloseTo(0);
	});

	it("is a pure function of time: scrubbing back lands where playing did", () => {
		const race = raceTimeline(keys, times, values, { swap: 0.2 });
		const forward = [0, 0.3, 0.6, 0.9].map((t) => race.at(t));
		const backward = [0.9, 0.6, 0.3, 0].map((t) => race.at(t)).reverse();
		expect(backward).toEqual(forward);
	});

	it("cuts at `top`: an entry sliding past the last place fades, and the view keeps `top` slots", () => {
		// a climbs from third to first; c drops from first to second, b from
		// second to third (past a top of 2).
		const race = raceTimeline(keys, times, values, { swap: 0.2, top: 2 });
		expect(race.top).toBe(2);
		expect(race.at(0).map((e) => e.presence)).toEqual([0, 1, 1]);
		expect(race.at(1).map((e) => e.presence)).toEqual([1, 0, 1]);
		// Mid-swap at t = 0.35 (a and b swapped at 0.25): both half way.
		const mid = race.at(0.35);
		expect(mid[0].position).toBeCloseTo(1.5);
		expect(mid[0].presence).toBeCloseTo(0.5);
		expect(mid[1].presence).toBeCloseTo(0.5);
		const view = race.view(0);
		expect(view.categories).toEqual(["b", "c"]);
		expect(view.entries.map((e) => e.key)).toEqual(["b", "c"]);
		expect(view.slot("a")).toBe(2);
		expect(race.view(1).categories).toEqual(["a", "c"]);
		// Always exactly `top` categories, so the axis keeps its slots.
		for (const t of [0, 0.2, 0.3, 0.35, 0.4, 0.6, 0.8, 1])
			expect(race.view(t).categories).toHaveLength(2);
	});

	it("shows every entry without a `top`", () => {
		const race = raceTimeline(keys, times, values);
		expect(race.top).toBeUndefined();
		expect(race.at(0.5).every((e) => e.presence === 1)).toBe(true);
		expect(race.view(0.5).categories).toEqual(keys);
	});

	it("puts the smallest first when ascending, and reads missing values as 0", () => {
		const race = raceTimeline(["x", "y"], [0], [[2, Number.NaN]], {
			order: "ascending",
		});
		expect(race.at(0).map((e) => [e.value, e.rank])).toEqual([
			[2, 1],
			[0, 0],
		]);
	});
});
