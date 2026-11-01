/**
 * Test helpers of the statistics family: what "the same chart" means for
 * batched layers (every marks item and every label, rounded), and readers
 * over a box or violin plot's path batch. Not exported from the package.
 */

import { parseColor, toCss } from "@sophistry/core/color";
import type { Polyline } from "@sophistry/core/geometry";
import type { MarksSpec } from "@sophistry/core/internal";
import type { MarkItem } from "../test-harness.js";
import { markItems, type mount } from "../test-harness.js";

export type Mounted = ReturnType<typeof mount>;

export const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** A paint as one CSS spelling, so `#fab387` and the `rgba(...)` a blend lands on compare equal. */
export const paint = (value: unknown) =>
	typeof value === "string" && value !== "none"
		? toCss({ ...parseColor(value) })
		: String(value);

export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function boxOf(lines: readonly Polyline[]): Box {
	const points = lines.flat();
	return {
		minX: Math.min(...points.map((p) => p.x)),
		minY: Math.min(...points.map((p) => p.y)),
		maxX: Math.max(...points.map((p) => p.x)),
		maxY: Math.max(...points.map((p) => p.y)),
	};
}

/** Every drawn item of every marks spec, with its box and paints; `alpha` folds in the spec's shared opacity (uniform per-item values are shared). */
export function items(
	scene: Mounted,
): (MarkItem & { spec: MarksSpec; progress: number; closed: boolean })[] {
	return scene
		.marks()
		.filter((spec) => spec.count > 0)
		.flatMap((spec) =>
			markItems(spec).map((item, i) => ({
				...item,
				alpha: item.alpha * (spec.style?.opacity ?? 1),
				spec,
				/** Its arc-length reveal, 0..1. */
				progress: spec.progresses?.[i] ?? 1,
				/** Whether it is a filled outline (a disc, box or violin), not a line. */
				closed:
					spec.shape.kind === "outline"
						? spec.shape.closed
						: spec.shape.kind === "paths"
							? (spec.shape.outlines[i]?.closed ?? false)
							: true,
			})),
		);
}

/** An item's box: its outline's, or its disc's. */
export function itemBox(item: MarkItem): Box {
	if (item.polylines.length > 0) return boxOf(item.polylines);
	return {
		minX: item.center.x - item.radius,
		maxX: item.center.x + item.radius,
		minY: item.center.y - item.radius,
		maxY: item.center.y + item.radius,
	};
}

/** Per-item strokes of a paths spec, else its shared stroke. */
function strokeOf(item: MarkItem & { spec: MarksSpec }): string {
	return paint(item.stroke ?? item.spec.style?.stroke ?? "none");
}

/** Everything drawn, comparable across mounts: each item's box, paints and opacity, each label's text, place and opacity. */
export function picture(scene: Mounted) {
	const drawn = items(scene)
		.filter((item) => item.alpha > 0)
		.map((item) => {
			const box = itemBox(item);
			return [
				rounded(box.minX),
				rounded(box.minY),
				rounded(box.maxX),
				rounded(box.maxY),
				paint(item.fill),
				strokeOf(item),
				rounded(item.alpha),
			].join(" ");
		})
		.sort();
	const words = scene
		.texts()
		.map(
			(s) =>
				`${s.text} ${rounded(s.at.x)} ${rounded(s.at.y)} ${rounded(s.style.opacity)}`,
		)
		.sort();
	return { drawn, words };
}

/** The path batch items of the scene (box plot whiskers/boxes/medians, violin bodies/ticks). */
export function pathItems(scene: Mounted) {
	return items(scene).filter((item) => item.spec.shape.kind === "paths");
}

/** Closed path items (box bodies, violin bodies), left to right. */
export function bodies(scene: Mounted) {
	return pathItems(scene)
		.filter((item) => item.fill !== "none" && item.polylines.length > 0)
		.sort((a, b) => itemBox(a).minX - itemBox(b).minX);
}

/** Text specs of the scene by text. */
export function label(scene: Mounted, text: string) {
	return scene.texts().find((s) => s.text === text);
}
