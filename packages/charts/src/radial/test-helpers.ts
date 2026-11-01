/**
 * Readers for the radial charts' tests: batched items (path batch or
 * instances) decoded to scene-unit outlines, labels, boxes, and a rounded
 * "picture" of everything drawn for "same chart" comparisons. Test-only.
 */

import type { SceneNode } from "@sophistry/core";
import type { Point, Polyline } from "@sophistry/core/geometry";
import type { MarksSpec, ShapeSpec, TextSpec } from "@sophistry/core/internal";
import { markItems, mount } from "../test-harness.js";

export type Scene = ReturnType<typeof mount>;

export const rounded = (value: number) => Math.round(value * 1e6) / 1e6 + 0;
export const TAU = 2 * Math.PI;

/** One batched item, with the paints of the spec it is in. */
export interface Item {
	fill: string;
	stroke: string | undefined;
	/** The item's own opacity times its spec's. */
	opacity: number;
	fillOpacity: number;
	zIndex: number;
	progress: number;
	polylines: Polyline[];
	spec: MarksSpec;
	index: number;
}

/** Every item of every marks spec, in paint order. */
export function items(scene: Scene): Item[] {
	return scene.marks().flatMap((spec) =>
		markItems(spec).map((item, index) => ({
			fill: item.fill,
			stroke: item.stroke,
			opacity: item.alpha * spec.style.opacity,
			fillOpacity: spec.style.fillOpacity,
			zIndex: spec.zIndex,
			progress: spec.progress,
			polylines: item.polylines,
			spec,
			index,
		})),
	);
}

/** Filled items (not `"none"`). */
export const filled = (scene: Scene) =>
	items(scene).filter((item) => item.fill !== "none" && item.fill !== "");

export const pointsOf = (lines: readonly Polyline[]) => lines.flat();

export function boxOf(lines: readonly Polyline[] | { polylines: Polyline[] }) {
	const all = pointsOf("polylines" in lines ? lines.polylines : lines);
	return {
		minX: Math.min(...all.map((p) => p.x)),
		minY: Math.min(...all.map((p) => p.y)),
		maxX: Math.max(...all.map((p) => p.x)),
		maxY: Math.max(...all.map((p) => p.y)),
	};
}

/** A closed outline's area (shoelace), over its first ring. */
export function areaOf(lines: readonly Polyline[]): number {
	const p = lines[0] ?? [];
	let sum = 0;
	for (let i = 0; i < p.length; i++) {
		const a = p[i] as Point;
		const b = p[(i + 1) % p.length] as Point;
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

/** How far clockwise from `from` (radians from +x) an outline reaches. */
export function reach(
	lines: readonly Polyline[],
	from: number,
	cx = 0,
	cy = 0,
): number {
	let most = 0;
	for (const p of pointsOf(lines)) {
		if (Math.hypot(p.x - cx, p.y - cy) < 1e-6) continue;
		const cw = (((from - Math.atan2(p.y - cy, p.x - cx)) % TAU) + TAU) % TAU;
		if (cw < TAU - 1e-6) most = Math.max(most, cw);
	}
	return most;
}

export const labels = (scene: Scene): TextSpec[] => scene.texts();
export const label = (scene: Scene, text: string) =>
	scene.texts().find((s) => s.text === text);
/** A label's angle round the centre, radians from +x. */
export const angleOf = (spec: TextSpec | undefined) =>
	spec ? Math.atan2(spec.at.y, spec.at.x) : Number.NaN;
/** Clockwise turn from 12 o'clock to an angle, 0..1. */
export const turnOf = (angle: number) => {
	const turn = (Math.PI / 2 - angle) / TAU;
	return turn - Math.floor(turn);
};

/** Every filled item, as its fill, opacity and rounded outline, in a stable order. */
export const filledPicture = (scene: Scene) =>
	filled(scene)
		.map((s) => ({
			fill: s.fill,
			opacity: rounded(s.opacity),
			points: pointsOf(s.polylines).map((p) => [rounded(p.x), rounded(p.y)]),
		}))
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Every label, as its text, rounded anchor and opacity, in a stable order. */
export const labelled = (scene: Scene) =>
	scene
		.texts()
		.map((s) => ({
			text: s.text,
			x: rounded(s.at.x),
			y: rounded(s.at.y),
			opacity: rounded(s.style.opacity),
		}))
		.sort((a, b) => a.text.localeCompare(b.text) || a.x - b.x);

/** Shape specs as rounded outlines and paints, in a stable order. */
export const shapePicture = (scene: Scene) =>
	scene
		.shapes()
		.map((s: ShapeSpec) => ({
			stroke: s.style.stroke,
			opacity: rounded(s.style.opacity),
			points: s.polylines.flat().map((p) => [rounded(p.x), rounded(p.y)]),
		}))
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Everything drawn, rounded: items, shapes and labels. */
export const picture = (scene: Scene) => ({
	items: items(scene)
		.map((s) => ({
			fill: s.fill,
			stroke: s.stroke,
			opacity: rounded(s.opacity),
			points: pointsOf(s.polylines).map((p) => [rounded(p.x), rounded(p.y)]),
		}))
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
	shapes: shapePicture(scene),
	labels: labelled(scene),
});

/** Mounts `node` and returns the scene. */
export const show = (node: SceneNode) => mount(node);
