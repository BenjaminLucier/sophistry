/** 3D scatter geometry: one marker per finite `(x, y, z)` triple. */

import { pairCount } from "../shared/pairs";

/** @category Math */
export interface ScatterPoint3 {
	/** Index into the input arrays, keeping `sizes`/`colors` aligned past dropped triples. */
	index: number;
	x: number;
	y: number;
	z: number;
}

/**
 * The finite `(x, y, z)` triples, paired by index, each keeping its index.
 *
 * @category Math & helpers
 */
export function scatterPoints3(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
): ScatterPoint3[] {
	let n = pairCount(xs, ys);
	n = Math.min(n, zs.length);

	const points: ScatterPoint3[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		const z = zs[i];
		if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))
			points.push({ index: i, x, y, z });
	}
	return points;
}
