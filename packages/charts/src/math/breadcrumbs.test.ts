import { describe, expect, it } from "vitest";
import {
	breadcrumbLayout,
	flattenPathSpec,
	pathTarget,
	samePath,
} from "./breadcrumbs";

/** One unit per character, so widths are easy to read. */
const options = {
	root: "All",
	measure: (text: string) => text.length,
	separatorWidth: 1,
	gap: 0.5,
};

describe("flattenPathSpec", () => {
	it("is a plain path with weight 1", () => {
		expect(flattenPathSpec(["a", "b"])).toEqual([
			{ path: ["a", "b"], weight: 1 },
		]);
	});

	it("weighs a transition's ends by t, recursively, merging equal paths", () => {
		const terms = flattenPathSpec({
			from: { from: [], to: ["a"], t: 0.5 },
			to: ["a"],
			t: 0.5,
		});
		expect(terms).toEqual([
			{ path: [], weight: 0.25 },
			{ path: ["a"], weight: 0.75 },
		]);
	});

	it("drops ends with no weight and clamps t", () => {
		expect(flattenPathSpec({ from: ["a"], to: ["b"], t: 2 })).toEqual([
			{ path: ["b"], weight: 1 },
		]);
	});
});

describe("pathTarget and samePath", () => {
	it("follows `to` down to a plain path", () => {
		expect(
			pathTarget({ from: [], to: { from: ["a"], to: ["b"], t: 0.2 }, t: 0.4 }),
		).toEqual(["b"]);
		expect(samePath(["a"], ["a"])).toBe(true);
		expect(samePath(["a"], ["a", "b"])).toBe(false);
	});
});

describe("breadcrumbLayout", () => {
	it("lays crumbs left to right with a separator between", () => {
		const { items, width } = breadcrumbLayout(["src", "charts"], options);
		expect(items.map((i) => i.name)).toEqual(["All", "src", "charts"]);
		// "All" (3) + gap + "›" (1) + gap = 5 per step.
		expect(items.map((i) => i.x)).toEqual([0, 5, 10]);
		expect(items[1].separatorX).toBeCloseTo(4, 9);
		expect(items.map((i) => i.path)).toEqual([[], ["src"], ["src", "charts"]]);
		expect(items.map((i) => i.current)).toEqual([0, 0, 1]);
		expect(width).toBe(16);
	});

	it("aligns about the anchor", () => {
		const centred = breadcrumbLayout(["ab"], { ...options, align: "center" });
		// "All" + step + "ab" = 3 + 2 + 2 = 7 wide.
		expect(centred.items[0].x).toBeCloseTo(-3.5, 9);
		const right = breadcrumbLayout(["ab"], { ...options, align: "right" });
		expect(right.items[1].x + right.items[1].width).toBeCloseTo(0, 9);
	});

	it("keeps shared crumbs whole during a transition and fades the rest", () => {
		const { items } = breadcrumbLayout(
			{ from: ["a", "x"], to: ["b"], t: 0.25 },
			options,
		);
		const byName = Object.fromEntries(items.map((i) => [i.name, i]));
		expect(byName.All.weight).toBeCloseTo(1, 9);
		expect(byName.a.weight).toBeCloseTo(0.75, 9);
		expect(byName.x.weight).toBeCloseTo(0.75, 9);
		expect(byName.b.weight).toBeCloseTo(0.25, 9);
		// Paths that part ways cross-fade in place.
		expect(byName.b.x).toBe(byName.a.x);
		// The root crumb is a link from either end; b is the current crumb of its end.
		expect(byName.All.current).toBe(0);
		expect(byName.b.current).toBe(1);
		expect(byName.a.current).toBe(0);
	});

	it("blends how current a crumb is when one end stops at it", () => {
		const { items } = breadcrumbLayout(
			{ from: ["a"], to: ["a", "b"], t: 0.75 },
			options,
		);
		const a = items.find((i) => i.name === "a");
		expect(a?.weight).toBeCloseTo(1, 9);
		expect(a?.current).toBeCloseTo(0.25, 9);
	});
});

describe("breadcrumbLayout truncation", () => {
	// All(3) › aa(2) › bb(2) › cc(2) › dd(2): 11 + 4 steps of 2 = 19 wide.
	const deep = ["aa", "bb", "cc", "dd"];

	it("leaves a trail that fits alone", () => {
		const { items, width } = breadcrumbLayout(deep, {
			...options,
			maxWidth: 19,
		});
		expect(items.map((i) => i.name)).toEqual(["All", "aa", "bb", "cc", "dd"]);
		expect(width).toBe(19);
	});

	it("collapses the middle into an ellipsis that climbs to the deepest hidden crumb", () => {
		const { items, width } = breadcrumbLayout(deep, {
			...options,
			ellipsis: "~",
			maxWidth: 16,
		});
		// All › ~ › cc › dd = 3 + 2 + 1 + 2 + 2 + 2 + 2 = 14; adding bb would make 18.
		expect(items.map((i) => i.name)).toEqual(["All", "~", "cc", "dd"]);
		expect(width).toBe(14);
		const dots = items[1];
		expect(dots.ellipsis).toBe(true);
		expect(dots.key).toBe("…");
		expect(dots.path).toEqual(["aa", "bb"]);
		expect(dots.hidden).toEqual(["aa", "bb"]);
		expect(dots.depth).toBe(1);
		expect(items.map((i) => i.x)).toEqual([0, 5, 8, 12]);
		expect(items[3].current).toBe(1);
	});

	it("always keeps the root, the ellipsis and the last crumb", () => {
		const { items } = breadcrumbLayout(deep, {
			...options,
			ellipsis: "~",
			maxWidth: 1,
		});
		expect(items.map((i) => i.name)).toEqual(["All", "~", "dd"]);
		// A path one below the root has nothing to collapse.
		expect(
			breadcrumbLayout(["a-very-long-name"], { ...options, maxWidth: 1 }).items,
		).toHaveLength(2);
	});

	it("slides a crumb between two ends that collapse differently", () => {
		const { items } = breadcrumbLayout(
			{ from: ["aa", "bb"], to: deep, t: 0.5 },
			{ ...options, ellipsis: "~", maxWidth: 16 },
		);
		const byName = Object.fromEntries(items.map((i) => [i.name, i]));
		// `from` fits whole: bb at 10. `to` hides aa and bb.
		expect(byName.aa.weight).toBeCloseTo(0.5, 9);
		expect(byName.bb.weight).toBeCloseTo(0.5, 9);
		expect(byName["~"].weight).toBeCloseTo(0.5, 9);
		expect(byName.cc.weight).toBeCloseTo(0.5, 9);
		// The root holds still; the ellipsis cross-fades with aa in place.
		expect(byName.All.x).toBe(0);
		expect(byName["~"].x).toBe(byName.aa.x);
	});
});

describe("breadcrumbLayout back control", () => {
	it("reserves room before the root and targets the parent of where it heads", () => {
		const { items, back, width } = breadcrumbLayout(["src", "charts"], {
			...options,
			backWidth: 1,
		});
		// back (1) + 2 gaps (1) before the root.
		expect(items[0].x).toBe(2);
		expect(width).toBe(18);
		expect(back).toEqual({ x: 0, width: 1, weight: 1, path: ["src"] });
	});

	it("fades with the paths below the root and goes nowhere from it", () => {
		const out = breadcrumbLayout(
			{ from: ["a"], to: [], t: 0.25 },
			{ ...options, backWidth: 1 },
		);
		expect(out.back?.weight).toBeCloseTo(0.75, 9);
		expect(out.back?.path).toBeNull();
		expect(
			breadcrumbLayout([], { ...options, backWidth: 1 }).back?.weight,
		).toBe(0);
		// Without backWidth, nothing is reserved or returned.
		expect(breadcrumbLayout(["a"], options).back).toBeUndefined();
	});

	it("counts the back control against maxWidth", () => {
		const { items } = breadcrumbLayout(["aa", "bb", "cc", "dd"], {
			...options,
			ellipsis: "~",
			backWidth: 1,
			maxWidth: 19,
		});
		expect(items.some((i) => i.ellipsis)).toBe(true);
	});
});
