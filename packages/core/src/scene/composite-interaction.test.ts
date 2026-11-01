/**
 * A composite takes part in interaction only through props its descriptor
 * takes from `interactionProps` (or `node.on` handlers): a plain value prop
 * that shares a name with one (`label`) does not register it.
 */

import { describe, expect, it } from "vitest";
import { rect } from "../shapes/rect.js";
import { defineComposite } from "./composite.js";
import { Invalidate } from "./context.js";
import { interactionProps } from "./interaction-props.js";
import { createScene, sceneInternals } from "./scene.js";

describe("composite interaction", () => {
	it("a composite's own `label` value prop does not make it interactive", () => {
		const labelled = defineComposite<{ label?: string }>({
			name: "Labelled",
			props: { label: { invalidates: Invalidate.UPDATE } },
			setup: (ctx) => [
				rect.create({ width: 1, height: 1, label: `${ctx.props.label} part` }),
			],
		});
		const scene = createScene({ headless: true });
		scene.add(labelled.create({ label: "whole" }));
		scene.commit();
		const registry = sceneInternals(scene)?.registry;
		expect(registry?.records().map((r) => r.label())).toEqual(["whole part"]);
		scene.dispose();
	});

	it("one taken from interactionProps, or an on() handler, still does", () => {
		const tappable = defineComposite<{ label?: string }>({
			name: "Tappable",
			props: { label: interactionProps.label as never },
			setup: () => [],
		});
		const scene = createScene({ headless: true });
		scene.add(tappable.create({ label: "own" }));
		const plain = defineComposite<object>({
			name: "Plain",
			props: {},
			setup: () => [],
		}).create({});
		scene.add(plain);
		plain.on("tap", () => {});
		scene.commit();
		const registry = sceneInternals(scene)?.registry;
		expect(registry?.records().length).toBe(2);
		scene.dispose();
	});
});
