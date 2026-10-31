/**
 * Readers the point-mark tests share: a mounted chart's batched items as
 * rounded dots, segments and boxes. Test-only; not exported from the barrel.
 */

import type { CoordinateSystem, SceneNode } from "@sophistry/core";
import type { MarksSpec } from "@sophistry/core/internal";
import { chart, chartHandle } from "../chart";
import type { ChartProps } from "../frame/types";
import type { MarkItem } from "../test-harness";
import { markItems, mount } from "../test-harness";

export const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** The marks layers at paint order `z` (so axes and guides are left out). */
export function layersAt(marks: readonly MarksSpec[], z: number) {
	return marks.filter((spec) => spec.zIndex === z);
}

/** Item `i`'s reveal (1 when the layer has no per-item reveals). */
const progressOf = (spec: MarksSpec, i: number) => spec.progresses?.[i] ?? 1;

/** Whether item `i` of `spec` is a closed outline (discs, symbols and boxes are). */
function closedAt(spec: MarksSpec, i: number): boolean {
	const shape = spec.shape;
	if (shape.kind === "outline") return shape.closed;
	if (shape.kind === "paths") return shape.outlines[i]?.closed ?? false;
	return true;
}

/** Half the larger side of an item's placed outline's box (a traced disc's radius). */
const reachOf = (item: MarkItem) => {
	const points = item.polylines.flat();
	if (points.length === 0) return 0;
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	return (
		Math.max(
			Math.max(...xs) - Math.min(...xs),
			Math.max(...ys) - Math.min(...ys),
		) / 2
	);
};

/**
 * Every filled item (disc, symbol, box) of `marks` as rounded centre, radius, fill and alpha,
 * sorted. A disc layer partly revealed is drawn from outlines (`outline`, or `paths` when radii
 * differ): its radius is the item's reach, and a partly revealed item's alpha carries its
 * reveal (its fill comes up with it).
 */
export function dotsOf(marks: readonly MarksSpec[]) {
	return marks
		.flatMap((spec) =>
			markItems(spec).flatMap((item, i) =>
				closedAt(spec, i) ? [{ spec, item, i }] : [],
			),
		)
		.map(({ spec, item, i }) => ({
			x: rounded(item.center.x),
			y: rounded(item.center.y),
			r: rounded(
				spec.shape.kind === "outline" || spec.shape.kind === "paths"
					? reachOf(item)
					: item.radius,
			),
			fill: item.fill,
			alpha: rounded(
				item.alpha * (spec.style?.opacity ?? 1) * progressOf(spec, i),
			),
		}))
		.filter((dot) => dot.alpha > 0)
		.sort((p, q) => p.x - q.x || p.y - q.y);
}

/**
 * Every open segment of `marks` (`line` items) as rounded ends, colour and alpha, sorted by
 * start. A partly revealed segment ends where its trace has reached.
 */
export function segmentsOf(marks: readonly MarksSpec[]) {
	return marks
		.filter(
			(spec) =>
				spec.shape.kind === "paths" ||
				(spec.shape.kind === "outline" && !spec.shape.closed),
		)
		.flatMap((spec) =>
			markItems(spec).flatMap((item, i) => {
				if (closedAt(spec, i)) return [];
				const points = item.polylines.flat();
				const a = points[0];
				const end = points[points.length - 1];
				const progress = progressOf(spec, i);
				if (!a || !end || !(progress > 0)) return [];
				const b =
					progress >= 1
						? end
						: {
								x: a.x + (end.x - a.x) * progress,
								y: a.y + (end.y - a.y) * progress,
							};
				return [
					{
						x0: rounded(a.x),
						y0: rounded(a.y),
						x1: rounded(b.x),
						y1: rounded(b.y),
						stroke: item.stroke ?? (spec.style?.stroke as string | undefined),
						alpha: rounded(item.alpha * (spec.style?.opacity ?? 1)),
					},
				];
			}),
		)
		.sort((p, q) => p.x0 - q.x0 || p.y0 - q.y0);
}

/**
 * Mounts `chart({ ...frame, children: [layer] })` and hands back the scene,
 * its coordinates and readers of the layers at `z`.
 */
export function plot(layer: SceneNode, frame: Partial<ChartProps> = {}, z = 7) {
	const node = chart.create({
		width: 8,
		height: 4,
		...frame,
		children: [layer],
	});
	const scene = mount(node);
	const coords = () => chartHandle(node)?.coords as CoordinateSystem;
	return {
		node,
		scene,
		coords,
		handle: () => chartHandle(node),
		layers: () => layersAt(scene.marks(), z),
		dots: () => dotsOf(layersAt(scene.marks(), z)),
		segments: () => segmentsOf(layersAt(scene.marks(), z)),
		/** A data point in scene units, rounded. */
		at: (x: number, y: number) => {
			const p = coords().coordsToPoint(x, y);
			return { x: rounded(p.x), y: rounded(p.y) };
		},
	};
}
