import { describe, expect, it } from "vitest";
import { legendLayout } from "./legend.js";
import {
	datumKeys,
	observable10,
	okabeIto,
	ordinalColorScale,
	tableau10,
	uniqueKeys,
} from "./ordinal.js";

describe("uniqueKeys", () => {
	it("keeps first-seen order, drops repeats and nullish entries", () => {
		expect(uniqueKeys(["b", "a", "b", null, undefined, "c", "a"])).toEqual([
			"b",
			"a",
			"c",
		]);
	});

	it("tells 1 and '1' apart, as a band scale does, and drops NaN", () => {
		expect(uniqueKeys([1, "1", 1, Number.NaN])).toEqual([1, "1"]);
	});
});

describe("ordinalColorScale", () => {
	it("maps categories to the range in domain order", () => {
		const scale = ordinalColorScale(["x", "y", "z"], ["red", "green", "blue"]);
		expect(scale("x")).toBe("red");
		expect(scale("z")).toBe("blue");
		expect(scale.index("y")).toBe(1);
		expect(scale.domain).toEqual(["x", "y", "z"]);
	});

	it("cycles the range when there are more categories than colours", () => {
		const scale = ordinalColorScale(["a", "b", "c"], ["red", "green"]);
		expect(scale("c")).toBe("red");
	});

	it("gives unknown and nullish keys the unknown colour", () => {
		const scale = ordinalColorScale(["a"], ["red", "green"], {
			unknown: "grey",
		});
		expect(scale("nope")).toBe("grey");
		expect(scale(undefined)).toBe("grey");
		expect(scale.index("nope")).toBe(-1);
		expect(ordinalColorScale(["a"], ["red"])("nope")).toBe("red");
	});

	it("deduplicates its domain", () => {
		expect(ordinalColorScale(["a", "a", "b"], ["red"]).domain).toEqual([
			"a",
			"b",
		]);
	});

	it("refuses an empty range", () => {
		expect(() => ordinalColorScale(["a"], [])).toThrow(RangeError);
	});

	it("ships categorical schemes of 8 and 10 distinct colours", () => {
		expect(okabeIto).toHaveLength(8);
		expect(tableau10).toHaveLength(10);
		expect(observable10).toHaveLength(10);
		for (const scheme of [okabeIto, tableau10, observable10]) {
			expect(new Set(scheme).size).toBe(scheme.length);
			for (const color of scheme) expect(color).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});

describe("datumKeys", () => {
	it("defaults to the index", () => {
		expect(datumKeys(3)).toEqual([0, 1, 2]);
	});

	it("uses an explicit key, telling repeats apart by order", () => {
		const keys = ["a", "b", "a", 3, 3];
		expect(datumKeys(5, (i) => keys[i])).toEqual(["a", "b", "a#2", 3, "3#2"]);
	});

	it("keys by place within the series, so other series don't shift it", () => {
		const series = ["n", "s", "n", "s"];
		const keys = datumKeys(4, undefined, (i) => series[i]);
		expect(new Set(keys).size).toBe(4);
		// Drop the first "s": the "n" keys are unchanged.
		const filtered = ["n", "n", "s"];
		const after = datumKeys(3, undefined, (i) => filtered[i]);
		expect(after[0]).toBe(keys[0]);
		expect(after[1]).toBe(keys[2]);
	});

	it("keeps series 1 and '1' apart", () => {
		const series: (string | number)[] = [1, "1"];
		const [a, b] = datumKeys(2, undefined, (i) => series[i]);
		expect(a).not.toBe(b);
	});
});

describe("legendLayout", () => {
	const options = {
		rowHeight: 0.5,
		swatchWidth: 0.3,
		swatchGap: 0.1,
		itemGap: 0.4,
	};

	it("stacks a column top-down, labels beside their swatches", () => {
		const layout = legendLayout([1, 2], { ...options, direction: "column" });
		expect(layout.items[0].swatch).toEqual({ x: 0.15, y: -0.25 });
		expect(layout.items[0].label).toEqual({ x: 0.4, y: -0.25 });
		expect(layout.items[1].swatch.y).toBe(-0.75);
		expect(layout.width).toBeCloseTo(2.4);
		expect(layout.height).toBe(1);
		expect(layout.title).toBeUndefined();
	});

	it("puts a title line on top", () => {
		const layout = legendLayout([1], {
			...options,
			direction: "column",
			titleWidth: 3,
		});
		expect(layout.title).toEqual({ x: 0, y: -0.25 });
		expect(layout.items[0].swatch.y).toBe(-0.75);
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(1);
	});

	it("lays a row out side by side and wraps at maxWidth", () => {
		const layout = legendLayout([1, 1, 1], {
			...options,
			direction: "row",
			maxWidth: 3.5,
		});
		// Each entry is 1.4 wide plus a 0.4 gap: two fit in 3.5, the third wraps.
		expect(layout.items[1].swatch.x).toBeCloseTo(1.8 + 0.15);
		expect(layout.items[1].swatch.y).toBe(-0.25);
		expect(layout.items[2].swatch).toEqual({ x: 0.15, y: -0.75 });
		expect(layout.height).toBe(1);
	});
});
