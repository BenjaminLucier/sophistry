/**
 * What the presets that move a shape's *points* share (`applyWave`,
 * `homotopy`, `applyFunction`): a points track holds one polyline or
 * several, and a map that bends space needs more vertices than a straight
 * edge has, or a long edge stays straight while everything around it curves.
 * Internal to `anim/`.
 */

import type { Polyline } from "../geometry";
import { boundsOf } from "../geometry/bounds";

/** A points track's value as rings, and how to put rings back into that shape. */
export function asRings<T extends Polyline | Polyline[]>(
	value: T,
): { rings: Polyline[]; wrap: (rings: Polyline[]) => T } {
	const nested = Array.isArray(value[0]);
	return {
		rings: (nested ? value : [value]) as Polyline[],
		wrap: (rings) => (nested ? rings : (rings[0] ?? [])) as T,
	};
}

/** The larger side of the rings' bounding box, or 0 for none. */
export function extentOf(rings: Polyline[]): number {
	const { minX, minY, maxX, maxY } = boundsOf(rings);
	return maxX >= minX ? Math.max(maxX - minX, maxY - minY) : 0;
}

/** Point budget for {@link splitLongEdges}, across every ring. */
export const MAX_SPLIT_POINTS = 4000;

/**
 * Splits every edge longer than `step` into equal pieces no longer than it,
 * keeping every original vertex. The pieces per edge are capped so the
 * rings together stay near {@link MAX_SPLIT_POINTS}. A `step` of 0 or less
 * leaves the rings as they are.
 */
export function splitLongEdges(rings: Polyline[], step: number): Polyline[] {
	if (!(step > 0)) return rings;
	const total = rings.reduce((n, ring) => n + ring.length, 0);
	const cap = Math.max(1, Math.floor(MAX_SPLIT_POINTS / Math.max(1, total)));
	return rings.map((ring) => {
		const out: Polyline = [];
		ring.forEach((p, i) => {
			out.push(p);
			const q = ring[i + 1];
			if (!q) return;
			const pieces = Math.min(
				Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / step),
				cap,
			);
			for (let j = 1; j < pieces; j++) {
				const k = j / pieces;
				out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
			}
		});
		return out;
	});
}
