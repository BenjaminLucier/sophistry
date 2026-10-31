/**
 * The collector, against `SceneGraph` with
 * real shapes: the incremental frame always equals `compileFrame` over the
 * drawables in tree order, patches specs in place when only their contents
 * changed, splices visibility and `zIndex` changes in by binary search
 * instead of re-sorting, keeps ties in tree order, and does not swallow an
 * error thrown while building a spec.
 */

import { describe, expect, it, vi } from "vitest";
import { circle } from "../shapes";
import { compileFrame } from "../spec/compile";
import type { DrawSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { Invalidate, themeContext } from "./context";
import { SceneGraph } from "./graph";
import { defineShape, type ShapeProps, shapeProps } from "./shape";
import type { NodeOf } from "./types";

type Circle = NodeOf<typeof circle>;

function fixture(count: number, zIndex: (i: number) => number = () => 0) {
	const frames: { frame: readonly DrawSpec[]; membershipChanged: boolean }[] =
		[];
	const graph = new SceneGraph({
		schedule: () => {},
		onFrame: (frame, options) => frames.push({ frame, ...options }),
	});
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	const pool = Array.from({ length: count }, (_, i) =>
		circle.create({ radius: 1, zIndex: zIndex(i) }),
	);
	graph.root.setChildren(pool);
	graph.commit();
	return {
		graph,
		pool,
		frames,
		commit: () => graph.commit(),
		frame: () => graph.frame,
		/** What the pure function says the frame should be, right now. */
		expected: () =>
			compileFrame(
				graph.ordered.map((node) => ({ id: node.id, spec: () => node.spec })),
			),
	};
}

const ids = (specs: readonly DrawSpec[]) => specs.map((spec) => spec.id);
const idsOf = (nodes: Circle[]) => nodes.map((node) => node.id);

describe("SceneGraph frame collection", () => {
	it("does not swallow a real error thrown while building a spec", () => {
		const broken = defineShape<ShapeProps & { fail?: boolean }>({
			name: "Broken",
			props: { ...shapeProps, fail: { invalidates: Invalidate.GEOMETRY } },
			geometry: (props) => {
				if (props.fail) throw new Error("boom");
				return { closed: false, polylines: [[{ x: 0, y: 0 }]] };
			},
		});
		const f = fixture(1);
		const node = f.graph.root.add(broken.create({}));
		f.commit();
		node.set("fail", true);
		expect(() => f.commit()).toThrow("boom");
	});

	it("starts out equal to compileFrame, sorted by z", () => {
		const f = fixture(3, (i) => [2, 0, 1][i] as number);
		const [a, b, c] = f.pool as [Circle, Circle, Circle];
		expect(f.frame()).toEqual(f.expected());
		expect(ids(f.frame())).toEqual(idsOf([b, c, a]));
	});

	it("patches a changed spec in place without rebuilding or re-sorting", () => {
		const f = fixture(3, (i) => i);
		const before = f.frame();
		const rebuilds = f.graph.stats.rebuilds;
		f.pool[1]?.set("progress", 0.5);
		f.commit();
		const after = f.frame();
		expect(after).not.toBe(before); // a new array, so consumers re-run
		expect(after[1]).toBe(f.pool[1]?.spec);
		// Untouched specs keep their identity: the point of patching.
		expect(after[0]).toBe(before[0]);
		expect(after[2]).toBe(before[2]);
		expect(f.graph.stats.rebuilds).toBe(rebuilds);
		expect(f.frames.at(-1)?.membershipChanged).toBe(false);
		expect(after).toEqual(f.expected());
	});

	it("keeps the array identity when nothing changed", () => {
		const f = fixture(1);
		const first = f.frame();
		expect(f.commit()).toBe(false);
		expect(f.frame()).toBe(first);
	});

	it("re-sorts when a node's z changes, keeping ties in tree order", () => {
		const f = fixture(3);
		const [a, b, c] = f.pool as [Circle, Circle, Circle];
		expect(ids(f.frame())).toEqual(idsOf([a, b, c]));
		a.set("zIndex", 5);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([b, c, a]));
		// And back down: a, now z=-1, jumps in front of b and c.
		a.set("zIndex", -1);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([a, b, c]));
		expect(f.frame()).toEqual(f.expected());
	});

	it("a z change that lands on a tie takes the node's tree position", () => {
		const f = fixture(3, (i) => [1, 0, 1][i] as number);
		const [a, b, c] = f.pool as [Circle, Circle, Circle];
		expect(ids(f.frame())).toEqual(idsOf([b, a, c]));
		b.set("zIndex", 1);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([a, b, c]));
	});

	it("visibility toggles add and remove a node at its sorted place", () => {
		const f = fixture(3);
		const [a, b, c] = f.pool as [Circle, Circle, Circle];
		b.set("visible", false);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([a, c]));
		expect(f.frame()).toEqual(f.expected());
		b.set("visible", true);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([a, b, c]));
		expect(f.frame()).toEqual(f.expected());
	});

	it("handles nodes added, removed and reordered", () => {
		const f = fixture(2);
		const [a, b] = f.pool as [Circle, Circle];
		const c = circle.create({ radius: 1 });
		f.graph.root.setChildren([a, b, c]);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([a, b, c]));
		f.graph.root.setChildren([c, a, b]);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([c, a, b]));
		f.graph.root.setChildren([c, b]);
		f.commit();
		expect(ids(f.frame())).toEqual(idsOf([c, b]));
		expect(f.frame()).toEqual(f.expected());
	});

	it("a node that left the scene no longer disturbs the frame", () => {
		const f = fixture(2);
		const [a, b] = f.pool as [Circle, Circle];
		f.graph.root.setChildren([a]);
		f.commit();
		const frame = f.frame();
		b.set("progress", 0.2);
		f.commit();
		expect(f.frame()).toBe(frame);
	});

	it("toggles and z changes are binary-inserted, not re-sorted", () => {
		const f = fixture(20, (i) => i % 4);
		const spy = vi.spyOn(Array.prototype, "sort");
		try {
			f.pool[5]?.set("visible", false);
			f.commit();
			expect(f.frame().length).toBe(19);
			f.pool[5]?.set("visible", true);
			f.commit();
			expect(f.frame().length).toBe(20);
			f.pool[7]?.set("zIndex", 10);
			f.commit();
			f.pool[7]?.set("zIndex", -3);
			f.commit();
			expect(spy.mock.calls.length).toBe(0);
		} finally {
			spy.mockRestore();
		}
		// `expected()` sorts, so it is compared only after the spy is gone.
		expect(f.frame()).toEqual(f.expected());
	});

	it("matches compileFrame through heavy toggling, z changes and reorders", () => {
		let seed = 99;
		const random = () => {
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return seed / 4294967296;
		};
		const f = fixture(16, (i) => i % 3);
		const all = [...f.pool];
		for (let step = 0; step < 300; step++) {
			// Several writes per commit, so batches mix patches, toggles and z moves.
			for (let k = 0; k < 1 + Math.floor(random() * 4); k++) {
				const pick = all[Math.floor(random() * all.length)] as Circle;
				if (pick.disposed) continue;
				const action = random();
				if (action < 0.35) pick.set("visible", !pick.get("visible"));
				else if (action < 0.7) pick.set("zIndex", Math.floor(random() * 4));
				else if (action < 0.9) pick.set("progress", random());
				else {
					const members = all.filter(
						(node) => !node.disposed && random() < 0.9,
					);
					// Shuffle: tree order is arbitrary as far as the collector knows.
					members.sort(() => random() - 0.5);
					f.graph.root.setChildren(members);
				}
			}
			f.commit();
			expect(f.frame()).toEqual(f.expected());
		}
	});

	it("patches and rebuilds a wide scene like compileFrame", () => {
		const f = fixture(400, (i) => i % 5);
		expect(f.frame()).toEqual(f.expected());
		for (const index of [0, 127, 128, 255, 256, 399]) {
			f.pool[index]?.set("progress", 0.25);
			f.commit();
			expect(f.frame()).toEqual(f.expected());
		}
		f.pool[130]?.set("visible", false);
		f.pool[300]?.set("zIndex", 9);
		f.commit();
		expect(f.frame()).toEqual(f.expected());
		f.pool[0]?.dispose();
		f.commit();
		expect(f.frame()).toEqual(f.expected());
		f.graph.root.setChildren(f.pool.slice(1, 100));
		f.commit();
		expect(f.frame()).toEqual(f.expected());
		expect(f.frame()).toHaveLength(99);
	});
});
