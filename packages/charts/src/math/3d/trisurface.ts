/** Triangulated surface faces: the xy-plane Delaunay triangulation, lifted to each point's `z`. */

import type { Point3 } from "@sophistry/core/internal";
import { delaunayTriangleIndices } from "@sophistry/core/internal";

/**
 * The xy-plane Delaunay triangles, each as 3 world points with `zs` as height.
 *
 * @param zs - Heights per point; triangles with a non-finite height are skipped.
 * @category Math & helpers
 */
export function trisurfaceFaces(
	xs: readonly number[],
	ys: readonly number[],
	zs: readonly number[],
): { points: Point3[] }[] {
	const indices = delaunayTriangleIndices(xs, ys);
	const faces: { points: Point3[] }[] = [];
	for (const [ia, ib, ic] of indices) {
		const za = zs[ia];
		const zb = zs[ib];
		const zc = zs[ic];
		if (!Number.isFinite(za) || !Number.isFinite(zb) || !Number.isFinite(zc))
			continue;
		faces.push({
			points: [
				{ x: xs[ia], y: ys[ia], z: za },
				{ x: xs[ib], y: ys[ib], z: zb },
				{ x: xs[ic], y: ys[ic], z: zc },
			],
		});
	}
	return faces;
}
