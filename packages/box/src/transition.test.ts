/**
 * `layoutTo`: boxes blend from their old places to their new layout, matched
 * by identity, and get their old styles and children back when rewound.
 */

import {
	pixelsPerUnitContext,
	resolveTheme,
	themeContext,
} from "@sophistry/core";
import { SceneGraph } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { box } from "./box.js";
import { layoutTo } from "./transition.js";

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	graph.root.provide(pixelsPerUnitContext, 100);
	return { graph, commit: () => graph.commit() };
}

const left = (node: { bounds(): { minX: number } | null }) =>
	node.bounds()?.minX ?? Number.NaN;
const width = (node: { bounds(): { minX: number; maxX: number } | null }) => {
	const bounds = node.bounds();
	return bounds ? bounds.maxX - bounds.minX : Number.NaN;
};

describe("layoutTo", () => {
	it("slides reordered children past each other", () => {
		const { graph, commit } = manualGraph();
		const a = box.create({ style: { width: 100, height: 100 } });
		const b = box.create({ style: { width: 100, height: 100 } });
		const row = graph.root.add(box.create({ children: [a, b] }));
		commit();
		const aStart = left(a);
		const bStart = left(b);
		const swap = layoutTo(
			row,
			{ children: [b, a] },
			{ duration: 1, easing: "linear" },
		);
		swap.begin?.();
		swap.seek(0.5);
		commit();
		expect(left(a)).toBeCloseTo((aStart + bStart) / 2);
		expect(left(b)).toBeCloseTo((aStart + bStart) / 2);
		swap.seek(1);
		commit();
		expect(left(a)).toBeCloseTo(bStart);
		expect(left(b)).toBeCloseTo(aStart);
		expect(row.children).toEqual([b, a]);
	});

	it("resizes boxes on the way, and nested boxes move with them", () => {
		const { graph, commit } = manualGraph();
		const inner = box.create({ style: { width: 100, height: 50 } });
		const outer = graph.root.add(
			box.create({ style: { padding: 0 }, children: [inner] }),
		);
		commit();
		const grow = layoutTo([[inner, { style: { width: 300, height: 50 } }]], {
			duration: 1,
			easing: "linear",
		});
		grow.begin?.();
		grow.seek(0.5);
		commit();
		expect(width(inner)).toBeCloseTo(2);
		expect(width(outer)).toBeCloseTo(2);
		grow.seek(1);
		commit();
		expect(width(outer)).toBeCloseTo(3);
	});

	it("puts the old style and children back when rewound to its start", () => {
		const { graph, commit } = manualGraph();
		const a = box.create({ style: { width: 100, height: 100 } });
		const b = box.create({ style: { width: 100, height: 100 } });
		const style = { gap: 0 };
		const row = graph.root.add(box.create({ style, children: [a, b] }));
		commit();
		const aStart = left(a);
		const change = layoutTo(row, { children: [b, a], style: { gap: 40 } });
		change.begin?.();
		change.seek(1);
		commit();
		expect(row.get("style")).toEqual({ gap: 40 });
		change.restore?.();
		commit();
		expect(row.children).toEqual([a, b]);
		expect(row.get("style")).toBe(style);
		expect(left(a)).toBeCloseTo(aStart);
	});
});
