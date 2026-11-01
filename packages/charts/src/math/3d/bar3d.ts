/**
 * 3D bar geometry: one box per index, anchored at `(x, y, z)` (not centred)
 * and extended by `(width, height, depth)`. Each extent is a number for
 * every bar or one per bar; arrays pair by index up to the shortest.
 */

import { pairCount } from "../shared/pairs.js";

/** @category Math */
export interface BarSlotBox3D {
	/** Index into the input arrays, keeping a `colors` array aligned past dropped entries. */
	index: number;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	z0: number;
	z1: number;
}

function resolveExtent(
	value: number | readonly number[],
	index: number,
): number {
	return typeof value === "number" ? value : (value[index] ?? Number.NaN);
}

/** `null` for a broadcast scalar (no length to constrain the pairing), else the array's length. */
function extentLength(value: number | readonly number[]): number | null {
	return typeof value === "number" ? null : value.length;
}

/**
 * One box per index: anchored at `(xs[i], ys[i], zs[i])` and extended by
 * that index's `(width, height, depth)`. Negative extents still give a
 * well-formed box; non-finite components drop the entry.
 *
 * @param widths - Extent along x: one number for every bar, or one per bar.
 * @param heights - Extent along y: one number for every bar, or one per bar.
 * @param depths - Extent along z: one number for every bar, or one per bar.
 * @category Math & helpers
 */
export function bar3dSlots(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
	widths: number | readonly number[],
	heights: number | readonly number[],
	depths: number | readonly number[],
): BarSlotBox3D[] {
	let n = pairCount(xs, ys);
	n = Math.min(n, zs.length);
	for (const extent of [widths, heights, depths]) {
		const len = extentLength(extent);
		if (len !== null) n = Math.min(n, len);
	}

	const slots: BarSlotBox3D[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		const z = zs[i];
		const dx = resolveExtent(widths, i);
		const dy = resolveExtent(heights, i);
		const dz = resolveExtent(depths, i);
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!Number.isFinite(z) ||
			!Number.isFinite(dx) ||
			!Number.isFinite(dy) ||
			!Number.isFinite(dz)
		)
			continue;
		slots.push({
			index: i,
			x0: Math.min(x, x + dx),
			x1: Math.max(x, x + dx),
			y0: Math.min(y, y + dy),
			y1: Math.max(y, y + dy),
			z0: Math.min(z, z + dz),
			z1: Math.max(z, z + dz),
		});
	}
	return slots;
}
