/** Readers the bar family's tests share. Not exported from the package. */

import type { SceneNode } from "@sophistry/core";
import type { MarksSpec } from "@sophistry/core/internal";
import { markItems } from "../test-harness.js";

/** A batched rect, decoded: its box, fill, stroke and effective opacity. */
export interface DrawnBox {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	fill: string;
	stroke: string | undefined;
	/** Per-item alpha times the layer's shared opacity. */
	opacity: number;
	zIndex: number;
}

/** Every rect item of the given marks specs, decoded, in order. */
export function boxes(marks: readonly MarksSpec[]): DrawnBox[] {
	return marks.flatMap((spec) =>
		markItems(spec).map((item) => ({
			minX: item.center.x - item.halfWidth,
			maxX: item.center.x + item.halfWidth,
			minY: item.center.y - item.halfHeight,
			maxY: item.center.y + item.halfHeight,
			fill: item.fill,
			stroke:
				item.stroke ??
				(typeof spec.style.stroke === "string" ? spec.style.stroke : undefined),
			opacity: item.alpha * spec.style.opacity * spec.progress,
			zIndex: spec.zIndex,
		})),
	);
}

/** The rect items with area and opacity. */
export function drawnBoxes(marks: readonly MarksSpec[]): DrawnBox[] {
	return boxes(marks).filter(
		(box) =>
			box.opacity > 0 && box.maxY - box.minY > 0 && box.maxX - box.minX > 0,
	);
}

/** The ids of `node` and every node under it. */
export function subtreeIds(node: SceneNode): Set<number> {
	const ids = new Set<number>();
	const walk = (own: SceneNode) => {
		ids.add(own.id);
		for (const child of (own as { children?: readonly SceneNode[] }).children ??
			[])
			walk(child);
	};
	walk(node);
	return ids;
}

/** The specs of `frame` drawn by `node` or a node under it (a chart's axes left out). */
export function specsOf<S extends { id: number }>(
	frame: readonly S[],
	node: SceneNode,
): S[] {
	const ids = subtreeIds(node);
	return frame.filter((spec) => ids.has(spec.id));
}
