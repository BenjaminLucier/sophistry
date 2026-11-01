import { describe, expect, it } from "vitest";
import { bandScale, interpolateBandScale, slotBandScale } from "./band.js";

describe("bandScale", () => {
	it("gives each category a unit slot, its band centred in it", () => {
		const x = bandScale(["a", "b", "c"]);
		expect(x.range).toEqual([0, 3, 1]);
		expect(x.bandwidth).toBeCloseTo(0.6);
		expect(x.index("b")).toBe(1);
		expect(x.start("b")).toBeCloseTo(1.2);
		expect(x.center("b")).toBeCloseTo(1.5);
	});

	it("keeps the first occurrence of a repeated category", () => {
		const x = bandScale(["b", "a", "b"]);
		expect(x.domain).toEqual(["b", "a"]);
		expect(x.index("a")).toBe(1);
	});

	it("answers -1 / undefined for a category it does not have", () => {
		const x = bandScale<string>(["a"]);
		expect(x.index("z")).toBe(-1);
		expect(x.start("z")).toBeUndefined();
		expect(x.center("z")).toBeUndefined();
	});

	it("treats numbers and strings as different categories", () => {
		const x = bandScale<string | number>([1, "1"]);
		expect(x.domain).toEqual([1, "1"]);
	});

	it("honours padding, align and outer padding", () => {
		const x = bandScale(["a", "b"], { padding: 0, paddingOuter: 0.5 });
		expect(x.bandwidth).toBe(1);
		expect(x.range).toEqual([-0.5, 2.5, 1]);
		const flush = bandScale(["a"], { padding: 0.5, align: 0 });
		expect(flush.start("a")).toBe(0);
		expect(flush.center("a")).toBeCloseTo(0.25);
	});

	it("clamps nonsense padding instead of inverting bands", () => {
		expect(bandScale(["a"], { padding: 3 }).bandwidth).toBe(0);
		expect(bandScale(["a"], { padding: -1 }).bandwidth).toBe(1);
		expect(bandScale(["a"], { padding: Number.NaN }).bandwidth).toBeCloseTo(
			0.6,
		);
	});

	it("still spans one slot with no categories", () => {
		expect(bandScale([]).range).toEqual([0, 1, 1]);
	});

	it("reverse lays the first category out in the last slot", () => {
		const y = bandScale(["top", "mid", "bottom"], { reverse: true });
		expect(y.domain).toEqual(["top", "mid", "bottom"]);
		expect(y.index("top")).toBe(2);
		expect(y.center("bottom")).toBeCloseTo(0.5);
	});
});

describe("interpolateBandScale", () => {
	it("is `from` at 0 and places everything as `to` does at 1", () => {
		const from = bandScale(["a", "b", "c"]);
		const to = bandScale(["c", "a"]);
		const start = interpolateBandScale(from, to, 0);
		const end = interpolateBandScale(from, to, 1);
		for (const key of ["a", "b", "c"] as const) {
			expect(start.start(key)).toBe(from.start(key));
		}
		expect(end.start("a")).toBe(to.start("a"));
		expect(end.start("c")).toBe(to.start("c"));
		expect(end.range).toEqual(to.range);
	});

	it("slides shared categories at slotT and blends the range at rangeT", () => {
		const from = bandScale(["a", "b"]);
		const to = bandScale(["b", "a", "c"]);
		const mid = interpolateBandScale(from, to, 0, 0.5);
		expect(mid.range).toEqual(from.range);
		expect(mid.center("a")).toBeCloseTo(1);
		expect(mid.center("b")).toBeCloseTo(1);
		// A category only `to` has stays in its own band.
		expect(mid.center("c")).toBe(to.center("c"));
		expect(mid.domain).toEqual(["a", "b", "c"]);
		const wider = interpolateBandScale(from, to, 0.5, 0);
		expect(wider.range[1]).toBeCloseTo(2.5);
		expect(wider.center("a")).toBe(from.center("a"));
	});
});

describe("slotBandScale", () => {
	it("stands categories at their (fractional) slots, in reading order", () => {
		const band = bandScale(["a", "b", "c"]);
		const sorted = slotBandScale(band, (key) =>
			key === "a" ? 2 : key === "c" ? 0.5 : undefined,
		);
		expect(sorted.center("a")).toBe(band.center("c"));
		expect(sorted.center("b")).toBe(band.center("b"));
		expect(sorted.center("c")).toBeCloseTo(1);
		expect(sorted.index("c")).toBe(1);
		expect(sorted.range).toEqual(band.range);
	});

	it("counts slots from the far end of a reversed (y) axis", () => {
		const band = bandScale(["a", "b", "c"], { reverse: true });
		const moved = slotBandScale(
			band,
			(key) => (key === "c" ? 0 : undefined),
			true,
		);
		// Slot 0 is the top: where "a" stands.
		expect(moved.center("c")).toBe(band.center("a"));
	});
});
