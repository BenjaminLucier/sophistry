import type { Range } from "@sophistry/core/geometry";
import { describe, expect, it } from "vitest";
import {
	KEYS_GAP,
	LEGEND_GAP,
	TITLE_FONT_SIZE,
	TITLE_GAP,
} from "./guide-metrics.js";
import {
	atLowEdge,
	centerOffset,
	DEFAULT_SUBTITLE_FONT_SIZE,
	headingRoom,
	keysColumnOf,
	keysRoom,
	keysRowOf,
	MIN_PLOT_SHARE,
	marginBand,
	mixRoom,
	plotExtent,
	roomOver,
	SUBTITLE_GAP,
	widestMargins,
} from "./layout.js";

const key = (width: number, height: number, presence = 1) => ({
	width,
	height,
	presence,
});

describe("chart layout rooms", () => {
	it("mixes two ends' rooms, or keeps the larger in a group", () => {
		expect(mixRoom(1, 3, 0.25, false)).toBe(1.5);
		expect(mixRoom(1, 3, 0.25, true)).toBe(3);
		expect(mixRoom(2, 2, 0.5, false)).toBe(2);
	});

	it("measures a range transition at both ends, clamping its progress", () => {
		const measure = (at: Range) => at[1] - at[0];
		expect(roomOver([0, 4], measure, false)).toBe(4);
		expect(roomOver({ from: [0, 2], to: [0, 6], t: 0.5 }, measure, false)).toBe(
			4,
		);
		expect(roomOver({ from: [0, 2], to: [0, 6], t: 2 }, measure, false)).toBe(
			6,
		);
		expect(roomOver({ from: [0, 2], to: [0, 6], t: 0 }, measure, true)).toBe(6);
	});

	it("knows when an axis stands on the plot's low edge", () => {
		// A continuous x axis at zero over a y range spanning it: inside.
		expect(atLowEdge("zero", false, [-2, 3], false)).toBe(false);
		// Zero out of range: pinned to the low end.
		expect(atLowEdge("zero", false, [1, 3], false)).toBe(true);
		// A band axis at "zero" stands at its edge.
		expect(atLowEdge("zero", true, [-2, 3], false)).toBe(true);
		expect(atLowEdge("edge", false, [-2, 3], false)).toBe(true);
	});

	it("takes the widest margin requested per side", () => {
		expect(
			widestMargins([
				{ margin: { left: 1, top: 0.5 } },
				{},
				{ margin: { left: 2, right: 0.3 } },
			]),
		).toEqual({ top: 0.5, right: 0.3, bottom: 0, left: 2 });
	});

	it("stacks the keys on the right, or sets them side by side when too tall", () => {
		expect(keysColumnOf(undefined, undefined, () => 10)).toBeUndefined();
		expect(keysColumnOf(key(1, 2), undefined, () => 0)).toEqual({
			...key(1, 2),
			beside: false,
		});
		expect(keysColumnOf(key(1, 2), key(3, 1), () => 10)).toEqual({
			width: 3,
			height: 3 + KEYS_GAP,
			presence: 1,
			beside: false,
		});
		expect(keysColumnOf(key(1, 2), key(3, 1), () => 2)).toEqual({
			width: 4 + LEGEND_GAP,
			height: 2,
			presence: 1,
			beside: true,
		});
	});

	it("drops the gap between keys when one end lists nothing", () => {
		expect(keysRowOf(key(2, 1), key(1, 1, 0))).toEqual(key(2, 2));
		expect(keysRowOf(key(2, 1), key(1, 1))).toEqual(key(2, 2 + KEYS_GAP));
		expect(keysRowOf(undefined, undefined)).toBeUndefined();
	});

	it("reserves the gap before a top key as present as it is", () => {
		expect(keysRoom(undefined)).toBe(LEGEND_GAP);
		expect(keysRoom(key(1, 2, 0.5))).toBe(LEGEND_GAP * 0.5 + 2);
	});

	it("measures the heading", () => {
		expect(headingRoom({})).toBe(0);
		expect(headingRoom({ title: "T" })).toBeCloseTo(
			TITLE_GAP + TITLE_FONT_SIZE * 1.2,
		);
		expect(headingRoom({ title: "T", subtitle: "S" })).toBeCloseTo(
			TITLE_GAP +
				TITLE_FONT_SIZE * 1.2 +
				SUBTITLE_GAP +
				DEFAULT_SUBTITLE_FONT_SIZE * 1.2,
		);
	});

	it("keeps a share of the plot and centres it toward the roomier side", () => {
		expect(plotExtent(10, { low: 1, high: 2 })).toBe(7);
		expect(plotExtent(10, { low: 5, high: 5 })).toBe(10 * MIN_PLOT_SHARE);
		expect(centerOffset(3, { low: 1, high: 2 })).toBe(-0.5);
		expect(centerOffset(0, { low: 0, high: 0 })).toBe(0);
	});

	it("places a reserved margin past the side's axis numbers", () => {
		const box = { minX: 0, maxX: 4, minY: 0, maxY: 2 };
		expect(marginBand(box, "left", 1, 0.5)).toEqual({
			minX: -1.5,
			maxX: -0.5,
			minY: 0,
			maxY: 2,
		});
		expect(marginBand(box, "top", 1, 0.25)).toEqual({
			minX: 0,
			maxX: 4,
			minY: 2.25,
			maxY: 3.25,
		});
	});
});
