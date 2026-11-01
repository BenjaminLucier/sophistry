/**
 * Clip regions for `<Group clip>`. A clip is authored in the group's own units
 * and baked to scene units through the children's matrix, so it turns and scales
 * with them; the camera applies at paint time. Nested clips are kept as a list
 * (Canvas2D intersects successive `clip()` calls), and picking tests "inside
 * all of them".
 */

import type { Bounds, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import { applyToPoint } from "../geometry/transform.js";
import type { ClipRegion } from "./types.js";

/**
 * What `<Group clip>` accepts, in the group's own units: a box, one polygon,
 * or several rings (filled by the non-zero rule, so a ring wound the other
 * way punches a hole).
 *
 * @category Shapes
 */
export type ClipShape =
	| Bounds
	| readonly Point[]
	| readonly (readonly Point[])[];

function isRingList(
	shape: readonly Point[] | readonly (readonly Point[])[],
): shape is readonly (readonly Point[])[] {
	return shape.length > 0 && Array.isArray(shape[0]);
}

/**
 * A {@link ClipShape} as closed rings in its own units. A box becomes its
 * four corners, counter-clockwise from the bottom-left.
 *
 * @param shape - The authored clip.
 * @returns The rings, unmapped.
 *
 * @category Extending
 */
export function clipRings(shape: ClipShape): Polyline[] {
	if (!Array.isArray(shape)) {
		const box = shape as Bounds;
		return [
			[
				{ x: box.minX, y: box.minY },
				{ x: box.maxX, y: box.minY },
				{ x: box.maxX, y: box.maxY },
				{ x: box.minX, y: box.maxY },
			],
		];
	}
	const list = shape as readonly Point[] | readonly (readonly Point[])[];
	if (isRingList(list)) return list.map((ring) => [...ring]);
	return [[...(list as readonly Point[])]];
}

/**
 * Bakes a {@link ClipShape} into a scene-unit {@link ClipRegion} through
 * `matrix` (the local-to-scene matrix of the space the shape is stated in).
 *
 * @param shape - The authored clip, in local units.
 * @param matrix - Local units → scene units.
 * @returns The region in scene units.
 *
 * @category Extending
 */
export function clipRegion(shape: ClipShape, matrix: Matrix): ClipRegion {
	return {
		rings: clipRings(shape).map((ring) =>
			ring.map((p) => applyToPoint(matrix, p)),
		),
	};
}

/**
 * The box every region in `clip` overlaps — an upper bound on what a clipped
 * node can show. Empty (`minX > maxX` or `minY > maxY`) when the regions'
 * boxes do not meet; `null` for no clip at all.
 *
 * @param clip - A spec's clip list.
 * @returns The intersection of the regions' bounding boxes, or null.
 *
 * @category Extending
 */
export function clipBounds(
	clip: readonly ClipRegion[] | undefined,
): Bounds | null {
	if (!clip || clip.length === 0) return null;
	let box: Bounds = {
		minX: Number.NEGATIVE_INFINITY,
		minY: Number.NEGATIVE_INFINITY,
		maxX: Number.POSITIVE_INFINITY,
		maxY: Number.POSITIVE_INFINITY,
	};
	for (const region of clip) {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const ring of region.rings) {
			for (const p of ring) {
				if (p.x < minX) minX = p.x;
				if (p.y < minY) minY = p.y;
				if (p.x > maxX) maxX = p.x;
				if (p.y > maxY) maxY = p.y;
			}
		}
		box = {
			minX: Math.max(box.minX, minX),
			minY: Math.max(box.minY, minY),
			maxX: Math.min(box.maxX, maxX),
			maxY: Math.min(box.maxY, maxY),
		};
	}
	return box;
}

/**
 * `box` cut down to what `clip` lets through (by bounding box), or `box`
 * itself when there is no clip; `null` when nothing of it is left.
 *
 * @param box - A node's own bounds, scene units.
 * @param clip - The node's clip list.
 *
 * @category Extending
 */
export function clipBox(
	box: Bounds,
	clip: readonly ClipRegion[] | undefined,
): Bounds | null {
	const limit = clipBounds(clip);
	if (!limit) return box;
	const cut = {
		minX: Math.max(box.minX, limit.minX),
		minY: Math.max(box.minY, limit.minY),
		maxX: Math.min(box.maxX, limit.maxX),
		maxY: Math.min(box.maxY, limit.maxY),
	};
	return cut.minX <= cut.maxX && cut.minY <= cut.maxY ? cut : null;
}

/**
 * `{ clip }` for a spec built in `space`, or `{}` when nothing clips it —
 * spread into a spec literal so an unclipped spec carries no `clip` key at
 * all.
 *
 * @param space - The space the node is drawn in (only its current `clip` list is read).
 *
 * @category Extending
 */
export function clipOf(space: {
	readonly clip?: readonly ClipRegion[] | undefined;
}): {
	clip?: readonly ClipRegion[];
} {
	const clip = space.clip;
	return clip ? { clip } : {};
}

/**
 * A space's clip list with `shape` added — what `<Group clip>` hands its
 * children. `inherited` itself (same identity) when `shape` is undefined, so
 * a group that adds nothing does not break the run of shared lists the
 * renderer batches on.
 *
 * @param inherited - The enclosing space's list.
 * @param shape - This level's clip, in the units `matrix` maps from.
 * @param matrix - Local units → scene units.
 *
 * @category Extending
 */
export function nestClip(
	inherited: readonly ClipRegion[] | undefined,
	shape: ClipShape | undefined,
	matrix: Matrix,
): readonly ClipRegion[] | undefined {
	if (!shape) return inherited;
	const region = clipRegion(shape, matrix);
	return inherited ? [...inherited, region] : [region];
}
