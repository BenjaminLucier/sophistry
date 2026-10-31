/**
 * Path batches: one `paths` MarksSpec for many outlines, prepared once,
 * placed through the enclosing space, styled per item, picked per item.
 */

import { describe, expect, it, vi } from "vitest";
import type { Polyline } from "../geometry";
import { pickMark } from "../interact/pick-items";
import type { MarksSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { Invalidate, themeContext } from "./context";
import { SceneGraph } from "./graph";
import { group } from "./group";
import {
	definePathBatch,
	type PathBatchItem,
	type PathBatchProps,
	pathBatch,
	pathBatchProps,
} from "./path-batch";

const theme = resolveTheme({ mode: "dark" });

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, theme);
	return { graph, commit: () => graph.commit() };
}

const left: Polyline = [
	{ x: 0, y: 0 },
	{ x: 2, y: 0 },
	{ x: 2, y: 2 },
	{ x: 0, y: 2 },
];
const right: Polyline = left.map((p) => ({ x: p.x + 4, y: p.y }));

const items: PathBatchItem[] = [
	{ closed: true, polylines: [left], fill: "tomato" },
	{
		closed: true,
		polylines: [right],
		fill: "teal",
		stroke: "white",
		strokeWidth: 0.2,
	},
	{
		closed: false,
		polylines: [
			[
				{ x: 0, y: 4 },
				{ x: 6, y: 4 },
			],
		],
	},
];

/** Item `i`'s points in scene units. */
function placed(spec: MarksSpec, i: number): Polyline[] {
	if (spec.shape.kind !== "paths") throw new Error("expected paths");
	const t = spec.transforms;
	const [a, b, c, d] = t
		? [t[4 * i], t[4 * i + 1], t[4 * i + 2], t[4 * i + 3]]
		: [1, 0, 0, 1];
	const x = spec.centers[2 * i];
	const y = spec.centers[2 * i + 1];
	return (spec.shape.outlines[i]?.polylines ?? []).map((line) =>
		line.map((p) => ({ x: x + a * p.x + c * p.y, y: y + b * p.x + d * p.y })),
	);
}

describe("pathBatch", () => {
	it("publishes one paths spec, each outline about its own box centre", () => {
		const { graph, commit } = manualGraph();
		const node = pathBatch.create({ items, stroke: "black", strokeWidth: 0.1 });
		graph.root.add(node);
		commit();
		const spec = node.spec as MarksSpec;
		expect(spec.kind).toBe("marks");
		expect(spec.shape.kind).toBe("paths");
		expect(spec.count).toBe(3);
		expect([...spec.centers]).toEqual([1, 1, 5, 1, 3, 4]);
		expect(spec.transforms).toBeNull();
		expect(placed(spec, 1)[0]).toEqual(right);
		expect(spec.extents[0]).toBeCloseTo(Math.SQRT2);
		expect(spec.bounds?.minX).toBeCloseTo(1 - Math.SQRT2);
		// Per-item paints where items have their own; the shared rest.
		expect(spec.fills).toEqual(["tomato", "teal", "none"]);
		expect(spec.strokes).toEqual(["black", "white", "black"]);
		expect(
			[...(spec.strokeWidths as Float32Array)].map((w) => Number(w.toFixed(4))),
		).toEqual([0.1, 0.2, 0.1]);
		expect(spec.style.strokeWidth).toBeCloseTo(0.2);
	});

	it("places through the space without re-preparing the outlines", () => {
		const { graph, commit } = manualGraph();
		const outer = group.create({ x: 1, scale: 2 });
		graph.root.add(outer);
		const node = outer.add(pathBatch.create({ items }));
		commit();
		const first = node.spec as MarksSpec;
		expect([...first.centers]).toEqual([3, 2, 11, 2, 7, 8]);
		expect([...(first.transforms as Float64Array).slice(0, 4)]).toEqual([
			2, 0, 0, 2,
		]);
		expect(placed(first, 0)[0]?.[2]).toEqual({ x: 5, y: 4 });
		outer.set("x", 2);
		commit();
		const moved = node.spec as MarksSpec;
		expect(moved.shape).toBe(first.shape);
		expect(moved.centers[0]).toBe(4);
	});

	it("bakes a shared dash, offset, caps and joins into the style", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			pathBatch.create({
				items,
				stroke: "white",
				dash: [0.2, 0.1],
				dashOffset: 0.05,
				lineCap: "butt",
				lineJoin: "miter",
			}),
		);
		commit();
		const style = (node.spec as MarksSpec).style;
		expect(style.dash).toEqual([0.2, 0.1]);
		expect(style.dashOffset).toBeCloseTo(0.05, 12);
		expect(style.lineCap).toBe("butt");
		expect(style.lineJoin).toBe("miter");
		node.set("dash", undefined);
		commit();
		expect((node.spec as MarksSpec).style.dash).toBeNull();
	});

	it("keeps the spec object while nothing changed", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(pathBatch.create({ items }));
		commit();
		const first = node.spec;
		node.invalidate(Invalidate.SPEC);
		commit();
		expect(node.spec).toBe(first);
	});

	it("picks the item under the point", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			pathBatch.create({ items, stroke: "black", strokeWidth: 0.1 }),
		);
		commit();
		const spec = node.spec as MarksSpec;
		expect(pickMark(spec, { x: 1, y: 1 })).toBe(0);
		expect(pickMark(spec, { x: 5, y: 1 })).toBe(1);
		expect(pickMark(spec, { x: 3, y: 1 })).toBeNull();
		// The open line: near it, not inside anything.
		expect(pickMark(spec, { x: 3, y: 4.02 })).toBe(2);
	});
});

describe("definePathBatch", () => {
	interface StripesProps extends PathBatchProps {
		count: number;
	}

	it("reruns paths for geometry props only and reuses prepared items", () => {
		const cache = new Map<number, PathBatchItem>();
		const paths = vi.fn((props: Readonly<StripesProps>) => ({
			items: Array.from({ length: props.count }, (_, i) => {
				let item = cache.get(i);
				if (!item) {
					item = {
						closed: true,
						polylines: [left.map((p) => ({ x: p.x + 3 * i, y: p.y }))],
					};
					cache.set(i, item);
				}
				return item;
			}),
		}));
		const stripes = definePathBatch<StripesProps>({
			name: "Stripes",
			props: {
				...pathBatchProps,
				count: { default: 2, invalidates: Invalidate.GEOMETRY },
			},
			paths,
		});
		const { graph, commit } = manualGraph();
		const node = graph.root.add(stripes.create({ count: 2, fill: "red" }));
		commit();
		const first = node.spec as MarksSpec;
		expect(first.fills).toBe("red");
		node.set("fill", "blue");
		commit();
		expect(paths).toHaveBeenCalledTimes(1);
		expect((node.spec as MarksSpec).fills).toBe("blue");
		node.set("count", 3);
		commit();
		expect(paths).toHaveBeenCalledTimes(2);
		const next = node.spec as MarksSpec;
		if (next.shape.kind !== "paths" || first.shape.kind !== "paths")
			throw new Error();
		// The unchanged items' prepared outlines are the same objects.
		expect(next.shape.outlines[0]).toBe(first.shape.outlines[0]);
		expect(next.count).toBe(3);
	});
});

describe("path batch: per-item reveals and dash offsets", () => {
	it("publishes item progress as progresses, null when every item is at 1", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(
			pathBatch.create({
				items: items.map((item, i) => ({ ...item, progress: [0.5, 1, -1][i] })),
				stroke: "white",
				progress: 0.7,
			}),
		);
		commit();
		const first = node.spec as MarksSpec;
		expect([...(first.progresses as Float32Array)]).toEqual([0.5, 1, 0]);
		// The batch's own progress stays the whole batch's fade.
		expect(first.progress).toBe(0.7);
		node.set(
			"items",
			items.map((item) => ({ ...item, progress: 1 })),
		);
		commit();
		const revealed = node.spec as MarksSpec;
		expect("progresses" in revealed).toBe(false);
		node.set("items", items);
		commit();
		expect("progresses" in (node.spec as MarksSpec)).toBe(false);
	});

	it("keeps each outline's identity across new items around the same geometry", () => {
		const { graph, commit } = manualGraph();
		const at = (progress: number) =>
			items.map((item) => ({ ...item, progress }));
		const node = graph.root.add(pathBatch.create({ items: at(0.25) }));
		commit();
		const first = node.spec as MarksSpec;
		node.set("items", at(0.5));
		commit();
		const next = node.spec as MarksSpec;
		if (next.shape.kind !== "paths" || first.shape.kind !== "paths")
			throw new Error("expected paths");
		expect(next.shape.outlines[0]).toBe(first.shape.outlines[0]);
		expect(next.shape.outlines[0]?.polylines).toBe(
			first.shape.outlines[0]?.polylines,
		);
		expect([...(next.progresses as Float32Array)]).toEqual([0.5, 0.5, 0.5]);
	});

	it("publishes item dash offsets in scene units, the batch's offset for the others", () => {
		const { graph, commit } = manualGraph();
		const outer = graph.root.add(group.create({ scale: 2 }));
		const node = outer.add(
			pathBatch.create({
				items: items.map((item, i) =>
					i === 1 ? { ...item, dashOffset: 0.3 } : item,
				),
				stroke: "white",
				dash: [0.2, 0.1],
				dashOffset: 0.05,
			}),
		);
		commit();
		const offsets = [...((node.spec as MarksSpec).dashOffsets as Float32Array)];
		expect(offsets[0]).toBeCloseTo(0.1, 6);
		expect(offsets[1]).toBeCloseTo(0.6, 6);
		expect(offsets[2]).toBeCloseTo(0.1, 6);
		node.set("items", items);
		commit();
		expect("dashOffsets" in (node.spec as MarksSpec)).toBe(false);
	});
});
