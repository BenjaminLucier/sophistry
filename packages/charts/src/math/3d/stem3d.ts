/** 3D stem geometry: a drop line along world y (up) from `baseline`, and a marker, per finite `(x, y, z)`. */

import type { Point3 } from "@sophistry/core/internal";
import { pairCount } from "../shared/pairs";

/** @category Math */
export interface StemPoint3 {
	/** Index into the input arrays, keeping a `colors` array aligned past dropped triples. */
	index: number;
	/** `(x, baseline, z) → (x, y, z)`, in data coordinates. */
	drop: [Point3, Point3];
	marker: Point3;
}

/** @category Math */
export interface Stem3DOptions {
	/** The y (height) value each drop line starts from. @default 0 */
	baseline?: number;
}

const DEFAULT_BASELINE = 0;

/**
 * One drop line and marker per finite `(x, y, z)`, paired by index.
 *
 * @param ys - Heights; the drop runs along this axis.
 * @category Math & helpers
 */
export function stemPoints3(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
	options: Stem3DOptions = {},
): StemPoint3[] {
	const baseline = options.baseline ?? DEFAULT_BASELINE;
	let n = pairCount(xs, ys);
	n = Math.min(n, zs.length);

	const points: StemPoint3[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		const z = zs[i];
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
			continue;
		points.push({
			index: i,
			drop: [
				{ x, y: baseline, z },
				{ x, y, z },
			],
			marker: { x, y, z },
		});
	}
	return points;
}
