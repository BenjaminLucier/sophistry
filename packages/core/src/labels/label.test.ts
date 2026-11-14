/**
 * `label`: it publishes a `TextSpec`,
 * its rotation, size and anchor are scene units scaled only by the group
 * chain, its spec is pinned literally (so routing the style through
 * `bakeTextStyle` cannot drift it), and its handle reports sane bounds that
 * match the hit box on either stage orientation.
 */

import { describe, expect, it } from "vitest";
import { textBoxAt } from "../interact/hit.js";
import { themeContext } from "../scene/context.js";
import { SceneGraph } from "../scene/graph.js";
import type { GroupProps } from "../scene/group.js";
import { group } from "../scene/group.js";
import type { TextNodeProps } from "../scene/text.js";
import { text } from "../scene/text.js";
import type { DrawSpec } from "../spec/types.js";
import { resolveTheme } from "../themes/index.js";

/**
 * A label under a group with `space` (none for the identity), on a scene
 * whose y runs up or down; returns the node and the committed graph.
 */
function mount(
	props: Partial<TextNodeProps>,
	space: GroupProps | null = null,
	yUp = true,
) {
	const graph = new SceneGraph({ schedule: () => {}, yUp });
	graph.root.provide(themeContext, resolveTheme());
	const node = text.create({ text: "r", ...props });
	graph.root.add(space ? group.create({ ...space, children: [node] }) : node);
	graph.commit();
	return { graph, node };
}

function textSpec(spec: DrawSpec | null | undefined) {
	if (spec?.kind !== "text") throw new Error("expected a text spec");
	return spec;
}

describe("label rotation and size are in scene units", () => {
	const specUnder = (space: GroupProps | null, props: Partial<TextNodeProps>) =>
		textSpec(mount(props, space).node.spec);

	it("keeps the rotation prop's own sense: the y flip belongs to the view, not the spec", () => {
		expect(specUnder(null, { rotation: 0.5 }).rotation).toBeCloseTo(0.5, 9);
	});

	it("folds an enclosing group's rotation into the scene-space angle", () => {
		expect(
			specUnder({ rotation: 0.25 }, { rotation: 0.5 }).rotation,
		).toBeCloseTo(0.75, 9);
	});

	it("a mirroring group mirrors the baseline direction", () => {
		expect(
			specUnder({ scale: 1, scaleY: -1 }, { rotation: 0.5 }).rotation,
		).toBeCloseTo(-0.5, 9);
	});

	it("font size, letter spacing and the anchor are scene units, scaled only by the group chain", () => {
		const props = { x: 1, y: 2, fontSize: 0.5, letterSpacing: 0.02 };
		const plain = specUnder(null, props);
		expect(plain.at).toEqual({ x: 1, y: 2 });
		expect(plain.style.fontSize).toBeCloseTo(0.5, 9);
		expect(plain.style.letterSpacing).toBeCloseTo(0.02, 9);

		const grouped = specUnder({ x: 10, scale: 3 }, props);
		expect(grouped.at).toEqual({ x: 13, y: 6 });
		expect(grouped.style.fontSize).toBeCloseTo(1.5, 9);
		expect(grouped.style.letterSpacing).toBeCloseTo(0.06, 9);
	});
});

describe("label spec characterisation", () => {
	const specOf = (
		props: Partial<TextNodeProps>,
		space: GroupProps | null = null,
	) => mount({ text: "hi", ...props }, space).node.spec;

	it("defaults", () => {
		const theme = resolveTheme();
		expect(specOf({})).toEqual({
			kind: "text",
			id: expect.any(Number),
			zIndex: 0,
			text: "hi",
			at: { x: 0, y: 0 },
			rotation: 0,
			style: {
				fill: theme.palette.foreground,
				fontSize: theme.defaults.fontSize,
				fontFamily: theme.defaults.fontFamily,
				fontWeight: 500,
				italic: false,
				align: "center",
				baseline: "middle",
				opacity: 1,
				letterSpacing: 0,
			},
			progress: 1,
		});
	});

	it("every style prop, a halo and a scaled group", () => {
		const theme = resolveTheme();
		const spec = specOf(
			{
				color: "#ff0000",
				fontSize: 0.5,
				fontFamily: "serif",
				fontWeight: 700,
				italic: true,
				align: "left",
				baseline: "top",
				opacity: 0.5,
				letterSpacing: 0.1,
				halo: true,
				progress: 2,
				zIndex: 3,
			},
			{ scale: 2 },
		);
		expect(spec).toEqual({
			kind: "text",
			id: expect.any(Number),
			zIndex: 3,
			text: "hi",
			at: { x: 0, y: 0 },
			rotation: 0,
			style: {
				fill: "#ff0000",
				fontSize: 1,
				fontFamily: "serif",
				fontWeight: 700,
				italic: true,
				align: "left",
				baseline: "top",
				opacity: 0.5,
				letterSpacing: 0.2,
				halo: { color: theme.palette.background, width: 0.25 },
			},
			progress: 1,
		});
		const custom = specOf({
			fontSize: 0.4,
			halo: { color: "#00ff00", width: 0.1 },
		});
		expect(custom?.kind === "text" && custom.style.halo).toEqual({
			color: "#00ff00",
			width: 0.1,
		});
	});
});

describe("label", () => {
	it("publishes one TextSpec with the given text", () => {
		const { graph } = mount({ text: "hello", x: 1, y: 2 });
		expect(graph.frame).toHaveLength(1);
		expect(textSpec(graph.frame[0]).text).toBe("hello");
	});

	it("publishes nothing visible when visible is false", () => {
		const { graph, node } = mount({ text: "hidden", visible: false });
		expect(node.spec).toBeNull();
		expect(graph.frame).toEqual([]);
	});

	it("publishes nothing visible when progress is 0", () => {
		const { node } = mount({ text: "not yet", progress: 0 });
		expect(node.spec).toBeNull();
	});

	it("its handle reports non-null, non-degenerate bounds for non-empty text", () => {
		const { node } = mount({ text: "measure me", x: 5, y: 5 });
		const local = node.localBounds();
		const world = node.bounds();
		expect(local).not.toBeNull();
		expect(world).not.toBeNull();
		if (local) {
			expect(local.maxX).toBeGreaterThan(local.minX);
			expect(local.maxY).toBeGreaterThan(local.minY);
		}
		// The world box is the local one translated by (x, y) = (5, 5) under
		// the identity space used here, so its centre lands near (5, 5).
		if (world) {
			expect((world.minX + world.maxX) / 2).toBeGreaterThan(0);
			expect((world.minY + world.maxY) / 2).toBeGreaterThan(0);
		}
	});
});

describe("label handle on a y-down stage", () => {
	it("matches the hit box, not its mirror, for a non-middle baseline", () => {
		for (const yUp of [true, false]) {
			const { node } = mount({ text: "top", y: 1, baseline: "top" }, null, yUp);
			const spec = textSpec(node.spec);
			const box = node.bounds();
			const hit = textBoxAt(spec, yUp);
			expect(box?.minY).toBeCloseTo(hit.minY, 9);
			expect(box?.maxY).toBeCloseTo(hit.maxY, 9);
			// "top" hangs the text below the anchor on screen: scene y below 1
			// on a y-up stage, above it on a y-down one.
			if (yUp) expect(box?.maxY).toBeCloseTo(1, 9);
			else expect(box?.minY).toBeCloseTo(1, 9);
		}
	});
});
