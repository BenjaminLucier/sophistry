/**
 * Test helpers for the grids family: a chart mounted around layers, a
 * reports recorder, and readers over batched items. Not exported.
 */

import type { SceneNode } from "@sophistry/core";
import { defineComposite } from "@sophistry/core";
import type { MarksSpec } from "@sophistry/core/internal";
import { chart, chartHandle } from "../chart.js";
import { chartLayersContext } from "../context.js";
import type { ChartLayerExtent, ChartProps } from "../frame/types.js";
import type { MarkItem } from "../test-harness.js";
import { markItems, mount } from "../test-harness.js";

/** Mounts `layers` in a chart; returns the scene and the chart's handle. */
export function inChart(props: Partial<ChartProps>, ...layers: SceneNode[]) {
	const plot = chart.create({
		width: 6,
		height: 4,
		...props,
		children: layers,
	});
	const scene = mount(plot);
	return {
		...scene,
		plot,
		handle: () => {
			const own = chartHandle(plot);
			if (!own) throw new Error("no chart handle");
			return own;
		},
	};
}

/** Every item of every marks spec in a scene, decoded, with its spec's z. */
export function itemsOf(
	marks: readonly MarksSpec[],
): (MarkItem & { zIndex: number; progress: number; reveal: number })[] {
	return marks.flatMap((spec) =>
		markItems(spec).map((item, i) => ({
			...item,
			zIndex: spec.zIndex,
			// The item's whole fade: its own alpha times the layer's (an
			// instances node folds a shared per-item opacity into the style).
			progress: item.alpha * spec.progress * spec.style.opacity,
			// The item's own arc-length reveal (a shape's `progress`).
			reveal: spec.progresses ? (spec.progresses[i] as number) : 1,
		})),
	);
}

/** An item's box from its outline (or its rect extents). */
export function itemBox(item: MarkItem) {
	if (item.polylines.length === 0)
		return {
			minX: item.center.x - item.halfWidth,
			maxX: item.center.x + item.halfWidth,
			minY: item.center.y - item.halfHeight,
			maxY: item.center.y + item.halfHeight,
		};
	const points = item.polylines.flat();
	return {
		minX: Math.min(...points.map((p) => p.x)),
		maxX: Math.max(...points.map((p) => p.x)),
		minY: Math.min(...points.map((p) => p.y)),
		maxY: Math.max(...points.map((p) => p.y)),
	};
}

/** The centre of an item's box. */
export function itemCentre(item: MarkItem) {
	const box = itemBox(item);
	return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/**
 * A node that records what the layers inside it report, as a chart would
 * receive them (put a coordinate system, an `axes`, between it and them).
 */
export function recorder(child: SceneNode) {
	const reports = new Map<object, ChartLayerExtent>();
	const node = defineComposite<{ children?: readonly SceneNode[] }>({
		name: "Recorder",
		props: { children: { kind: "children", invalidates: 0 } },
		setup: (ctx) => {
			ctx.provide(chartLayersContext, {
				report(owner, extent) {
					if (extent === null) reports.delete(owner);
					else reports.set(owner, extent);
				},
			});
			return ctx.children;
		},
	}).create({ children: [child] });
	return { node, reports: () => [...reports.values()] };
}
