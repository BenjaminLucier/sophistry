/**
 * `group` composes matrix, opacity, clip and pen scale down its subtree,
 * checked against `compose`/`fromTranslationRotationScale` (the primitives the
 * group itself uses) so a wiring mistake shows, not matrix algebra. Plus the
 * space's economy: the same object while nothing changed, the parent's clip
 * list by identity, and only the changed fields told to the children.
 */

import { describe, expect, it, vi } from "vitest";
import {
	applyToPoint,
	compose,
	fromTranslationRotationScale,
	IDENTITY,
	type Matrix,
} from "../geometry/transform";
import { circle, rect } from "../shapes";
import type { ShapeSpec } from "../spec/types";
import { resolveTheme } from "../themes";
import { BaseContainer } from "./container";
import { themeContext } from "./context";
import { SceneGraph } from "./graph";
import { group } from "./group";
import type { BaseNode } from "./node";
import { definePrimitive } from "./primitive";
import type { SceneNode, Space } from "./types";
import { SpaceChange } from "./types";

function manualGraph() {
	const graph = new SceneGraph({ schedule: () => {} });
	graph.root.provide(themeContext, resolveTheme({ mode: "dark" }));
	return { graph, commit: () => graph.commit() };
}

/** The space a child of `node` sees (refreshing the chain first). */
function spaceUnder(node: SceneNode): Space {
	const probe = circle.create({ radius: 1 });
	(node as unknown as BaseContainer).add(probe);
	probe.bounds();
	const space = (probe as unknown as BaseNode).space;
	probe.dispose();
	return space;
}

/**
 * A container handing its children a fixed space: a stand-in for
 * `linearTransform` (a matrix plus a pinned pen).
 */
class FixedSpace extends BaseContainer<{ children?: readonly SceneNode[] }> {
	fixed: Space = {
		matrix: IDENTITY,
		opacity: 1,
		clip: undefined,
		penScale: undefined,
		yUp: true,
	};
	override get childSpace(): Space {
		return this.fixed;
	}
}
const fixedSpace = (space: Partial<Space>) => {
	const node = definePrimitive<{ children?: readonly SceneNode[] }, FixedSpace>(
		{
			name: "FixedSpace",
			container: true,
			props: { children: { kind: "children", invalidates: 0 } },
			node: (definition) => new FixedSpace(definition),
		},
	).create();
	node.fixed = { ...node.fixed, ...space };
	return node;
};

describe("group composition", () => {
	it("composes matrix and opacity down one level", () => {
		const { graph } = manualGraph();
		const node = graph.root.add(
			group.create({
				x: 3,
				y: -1,
				rotation: Math.PI / 4,
				scale: 2,
				opacity: 0.5,
			}),
		);
		const seen = spaceUnder(node);
		const expected = compose(
			IDENTITY,
			fromTranslationRotationScale({
				x: 3,
				y: -1,
				rotation: Math.PI / 4,
				scaleX: 2,
				scaleY: 2,
			}),
		);
		expect(seen.matrix).toEqual(expected);
		const p = { x: 1, y: 1 };
		expect(applyToPoint(seen.matrix, p)).toEqual(applyToPoint(expected, p));
		expect(seen.opacity).toBeCloseTo(0.5);
	});

	it("compounds across two nested groups (opacity multiplies, matrices compose)", () => {
		const { graph } = manualGraph();
		const inner = group.create({ x: 1, scale: 3, opacity: 0.4 });
		graph.root.add(group.create({ scale: 2, opacity: 0.5, children: [inner] }));
		const seen = spaceUnder(inner);
		expect(seen.opacity).toBeCloseTo(0.2);
		const expected = compose(
			fromTranslationRotationScale({ scaleX: 2, scaleY: 2 }),
			fromTranslationRotationScale({ x: 1, scaleX: 3, scaleY: 3 }),
		);
		const p = { x: 2, y: -1 };
		expect(applyToPoint(seen.matrix, p)).toEqual(applyToPoint(expected, p));
	});

	it("a plain group is the identity at full opacity, handing its parent's space values on", () => {
		const { graph } = manualGraph();
		const node = graph.root.add(group.create());
		const seen = spaceUnder(node);
		expect(seen.matrix).toBe(graph.root.childSpace.matrix);
		expect(seen.opacity).toBe(1);
		expect(seen.clip).toBeUndefined();
	});

	it("scaleY overrides scale on y only", () => {
		const { graph } = manualGraph();
		const node = graph.root.add(group.create({ scale: 2, scaleY: 3 }));
		const { matrix } = spaceUnder(node);
		expect(applyToPoint(matrix, { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
	});

	it("children's specs and handles carry the group's transform and opacity", () => {
		const { graph, commit } = manualGraph();
		const child = rect.create({ width: 2, height: 1, opacity: 0.5 });
		graph.root.add(
			group.create({ x: 4, scale: 2, opacity: 0.5, children: [child] }),
		);
		commit();
		const spec = child.spec as ShapeSpec;
		expect(spec.style.opacity).toBeCloseTo(0.25);
		expect(child.bounds()).toEqual({ minX: 2, minY: -1, maxX: 6, maxY: 1 });
		expect(graph.root.children[0]?.bounds()).toEqual(child.bounds());
	});
});

describe("group space economy", () => {
	it("keeps the same space object while nothing in it changed", () => {
		const { graph, commit } = manualGraph();
		const node = graph.root.add(group.create({ x: 1 }));
		commit();
		const before = node.childSpace;
		node.set("x", 2);
		node.set("x", 1);
		commit();
		expect(node.childSpace).toBe(before);
		node.set("opacity", 0.5);
		commit();
		expect(node.childSpace).not.toBe(before);
		expect(node.childSpace.matrix).toBe(before.matrix);
	});

	it("tells children only the fields that changed", () => {
		const { graph, commit } = manualGraph();
		const child = circle.create({ radius: 1 });
		const node = graph.root.add(group.create({ children: [child] }));
		commit();
		const spy = vi.spyOn(child, "spaceChanged");
		node.set("opacity", 0.5);
		commit();
		expect(spy.mock.calls).toEqual([[SpaceChange.OPACITY]]);
		spy.mockClear();
		node.set("rotation", 1);
		commit();
		expect(spy.mock.calls).toEqual([[SpaceChange.MATRIX]]);
		spy.mockClear();
		// The parent's yUp flips: forwarded as is, and a shape ignores it.
		const refreshes = graph.stats.refreshes;
		graph.setYUp(false);
		commit();
		expect(spy.mock.calls).toEqual([[SpaceChange.Y_UP]]);
		// The group itself refreshed; the circle had nothing to do.
		expect(graph.stats.refreshes).toBe(refreshes + 1);
	});

	it("an opacity change restyles children without touching their outline or matrix", () => {
		const { graph, commit } = manualGraph();
		const child = circle.create({ radius: 1, center: { x: 1, y: 0 } });
		const node = graph.root.add(group.create({ x: 2, children: [child] }));
		commit();
		const before = child.spec as ShapeSpec;
		node.set("opacity", 0.3);
		commit();
		const after = child.spec as ShapeSpec;
		expect(after.style.opacity).toBeCloseTo(0.3);
		expect(after.local?.transform).toBe(before.local?.transform);
		expect(after.local?.curvePaths).toBe(before.local?.curvePaths);
	});

	it("a group's move is a new matrix for its children, never a new outline", () => {
		const { graph, commit } = manualGraph();
		const child = circle.create({ radius: 1 });
		const node = graph.root.add(group.create({ children: [child] }));
		commit();
		const before = child.spec as ShapeSpec;
		node.set("x", 5);
		commit();
		const after = child.spec as ShapeSpec;
		expect(after.local?.transform.e).toBe(5);
		expect(after.local?.curvePaths).toBe(before.local?.curvePaths);
		expect(after.style).toBe(before.style);
	});

	it("hands the parent's clip list on by identity when it adds none", () => {
		const { graph, commit } = manualGraph();
		const inner = group.create({ x: 3 });
		const outer = graph.root.add(
			group.create({
				clip: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
				children: [inner],
			}),
		);
		commit();
		expect(outer.childSpace.clip).toHaveLength(1);
		expect(inner.childSpace.clip).toBe(outer.childSpace.clip);
	});

	it("forwards a pen scale only when an ancestor pinned one", () => {
		const { graph } = manualGraph();
		const plain = graph.root.add(group.create({ scale: 2 }));
		expect(spaceUnder(plain).penScale).toBeUndefined();
		const pinned = fixedSpace({ penScale: 1.5 });
		const inner = group.create({ scale: 2 });
		pinned.add(inner);
		graph.root.add(pinned);
		expect(spaceUnder(inner).penScale).toBe(3);
	});

	it("follows a move to another parent", () => {
		const { graph, commit } = manualGraph();
		const child = circle.create({ radius: 1 });
		const inner = group.create({ children: [child] });
		const left = graph.root.add(group.create({ x: -5, children: [inner] }));
		const right = graph.root.add(group.create({ x: 5 }));
		commit();
		expect((child.spec as ShapeSpec).local?.transform.e).toBe(-5);
		right.add(inner);
		commit();
		expect((child.spec as ShapeSpec).local?.transform.e).toBe(5);
		expect(left.children).toEqual([]);
	});

	it("binds its props like any node", async () => {
		const { track } = await import("../reactive");
		const { graph, commit } = manualGraph();
		const angle = track(0);
		const child = rect.create({ width: 2, height: 2 });
		graph.root.add(group.create({ rotation: angle, children: [child] }));
		commit();
		angle.set(Math.PI / 2);
		commit();
		const m = (child.spec as ShapeSpec).local?.transform as Matrix;
		expect(m.a).toBeCloseTo(0, 9);
		expect(m.b).toBeCloseTo(1, 9);
	});
});
