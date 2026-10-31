/**
 * Test harness for the 3D primitives: a scene graph committed by hand, with a
 * theme and a fixed visible frame, and readers over its frame. Not exported
 * from the package.
 */

import {
	frameContext,
	type SceneNode,
	themeContext,
	track,
} from "@sophistry/core";
import type { Bounds } from "@sophistry/core/geometry";
import {
	plainShapeSpec,
	SceneGraph,
	type ShapeSpec,
} from "@sophistry/core/internal";
import { resolveTheme } from "@sophistry/core/themes";

export const theme = resolveTheme({ mode: "dark" });

/** The default scene's visible frame: 16 by 9 units. */
export const FRAME: Bounds = { minX: -8, minY: -4.5, maxX: 8, maxY: 4.5 };

/**
 * A graph committed by hand, with `nodes` added to its root under a dark
 * theme and a visible frame you can drive (`frame.set(...)`).
 */
export function mount(...nodes: SceneNode[]) {
	const graph = new SceneGraph({ schedule: () => {} });
	const frame = track(FRAME);
	graph.root.provide(themeContext, theme);
	graph.root.provide(frameContext, frame);
	for (const node of nodes) graph.root.add(node);
	graph.commit();
	return {
		graph,
		frame,
		commit: () => graph.commit(),
		/** The shape specs in paint order (as the renderer sorts them). */
		shapes: () => graph.frame.filter((s): s is ShapeSpec => s.kind === "shape"),
		/** The shape specs as plain objects, for `toEqual`. */
		plainShapes: () =>
			graph.frame
				.filter((s): s is ShapeSpec => s.kind === "shape")
				.map((s) => plainShapeSpec(s)),
	};
}
