/**
 * `ctx.space()`: a composite that reads its space is rerun, with `"space"`
 * in `changed`, when an ancestor's matrix, clip, opacity or pen scale
 * changes in a field it asked about; one that never reads it is never rerun
 * by a space change.
 */

import { describe, expect, it } from "vitest";
import { scaleFactorOf } from "../geometry/transform.js";
import { rect } from "../shapes/rect.js";
import { defineComposite } from "./composite.js";
import { Invalidate } from "./context.js";
import { group } from "./group.js";
import { createScene } from "./scene.js";
import type { Space } from "./types.js";
import { SpaceChange } from "./types.js";

/** A composite that records every update's reasons and the space it read. */
function probe(watch?: number) {
	const updates: string[][] = [];
	const spaces: Space[] = [];
	const definition = defineComposite<{ tick?: number }>({
		name: "SpaceProbe",
		props: { tick: { invalidates: Invalidate.UPDATE } },
		setup: (ctx) => {
			spaces.push(ctx.space(watch));
			return [rect.create({ width: 1, height: 1 })];
		},
		update: (changed, ctx) => {
			updates.push([...changed].map(String));
			spaces.push(ctx.space(watch));
			return undefined;
		},
	});
	return { node: definition.create({}), updates, spaces };
}

describe("composite space reads", () => {
	it("reruns with 'space' when an ancestor's matrix changes", () => {
		const { node, updates, spaces } = probe();
		const parent = group.create({ scale: 1, children: [node] });
		const scene = createScene({ headless: true });
		scene.add(parent);
		scene.commit();
		expect(updates).toEqual([]);
		parent.set("scale", 3);
		scene.commit();
		expect(updates).toEqual([["space"]]);
		expect(scaleFactorOf(spaces.at(-1)?.matrix as never)).toBeCloseTo(3);
		scene.dispose();
	});

	it("reruns when an ancestor's clip changes", () => {
		const { node, updates, spaces } = probe(SpaceChange.CLIP);
		const parent = group.create({ children: [node] });
		const scene = createScene({ headless: true });
		scene.add(parent);
		scene.commit();
		parent.set("clip", { shape: "rect", width: 2, height: 2 } as never);
		scene.commit();
		expect(updates).toEqual([["space"]]);
		expect(spaces.at(-1)?.clip?.length).toBe(1);
		scene.dispose();
	});

	it("reruns only for the fields it asked about", () => {
		const { node, updates } = probe(SpaceChange.CLIP);
		const parent = group.create({ children: [node] });
		const scene = createScene({ headless: true });
		scene.add(parent);
		scene.commit();
		parent.set("scale", 2);
		scene.commit();
		expect(updates).toEqual([]);
		scene.dispose();
	});

	it("a composite that never reads its space is not rerun by one", () => {
		const updates: unknown[] = [];
		const plain = defineComposite<object>({
			name: "NoSpace",
			props: {},
			setup: () => [rect.create({ width: 1, height: 1 })],
			update: (changed) => {
				updates.push(changed);
				return undefined;
			},
		}).create({});
		const parent = group.create({ children: [plain] });
		const scene = createScene({ headless: true });
		scene.add(parent);
		scene.commit();
		parent.set("scale", 2);
		scene.commit();
		expect(updates).toEqual([]);
		scene.dispose();
	});

	it("sees the space of a nested composite's own ancestors, not its children's", () => {
		const { node, updates } = probe();
		const outer = defineComposite<object>({
			name: "Outer",
			props: {},
			setup: () => [node],
		}).create({});
		const parent = group.create({ children: [outer] });
		const scene = createScene({ headless: true });
		scene.add(parent);
		scene.commit();
		parent.set("scale", 2);
		scene.commit();
		expect(updates).toEqual([["space"]]);
		scene.dispose();
	});
});
