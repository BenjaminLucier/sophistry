/**
 * A triangulated surface through scattered vertices. y is up, so the
 * Delaunay triangulation runs over the `(x, z)` ground plane and `y` is the
 * height.
 */

import type { MeshFace, MeshFacesProps } from "@sophistry/3d";
import { defineMesh3D, mesh3DProps } from "@sophistry/3d";
import { Invalidate } from "@sophistry/core";
import { delaunayTriangleIndices } from "@sophistry/core/internal";
import type { Channel } from "../data/channels.js";
import { numberValues } from "../data/channels.js";
import type { AnyDatum } from "../props.js";

/** @category Plots */
export interface TriSurface3DProps<T = unknown>
	extends Omit<MeshFacesProps, "faces"> {
	/** One vertex per datum. */
	data: readonly T[];
	/** World x of the vertex, a key of `T` or `(d, i) => number`. */
	x: Channel<T, number>;
	/** World y (height) of the vertex. Triangles with a non-finite height are dropped. */
	y: Channel<T, number>;
	/** World z of the vertex. The triangulation runs over `(x, z)`. A data channel, not the paint order: see `zIndex`. */
	z: Channel<T, number>;
}

type Props = TriSurface3DProps<AnyDatum>;

const NO_DATA: readonly AnyDatum[] = [];

/**
 * The ground-plane Delaunay triangles lifted to each vertex's height. Not
 * `trisurfaceFaces` from the chart maths: that one triangulates over
 * `(x, y)` with `z` as height, while here y is up.
 */
function triSurfaceFaces(props: Readonly<Props>): MeshFace[] {
	const data = props.data ?? NO_DATA;
	const xs = numberValues(data, props.x);
	const ys = numberValues(data, props.y);
	const zs = numberValues(data, props.z);
	const indices = delaunayTriangleIndices(zs, xs);
	const faces: MeshFace[] = [];
	for (const [ia, ib, ic] of indices) {
		const ya = ys[ia];
		const yb = ys[ib];
		const yc = ys[ic];
		if (!Number.isFinite(ya) || !Number.isFinite(yb) || !Number.isFinite(yc))
			continue;
		faces.push({
			points: [
				{ x: xs[ia], y: ya, z: zs[ia] },
				{ x: xs[ib], y: yb, z: zs[ib] },
				{ x: xs[ic], y: yc, z: zs[ic] },
			],
		});
	}
	return faces;
}

/**
 * A surface through scattered vertices (`x`, `z` on the ground, `y` the
 * height), Delaunay-triangulated over the ground plane and drawn as
 * flat-shaded triangles. Fewer than three usable or all-collinear points
 * draw nothing. The triangles are rebuilt only when the data or a channel
 * changes, never on a camera move. Render under a `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { triSurface3D } from "@sophistry/charts/3d";
 *
 * const samples = [
 * 	{ x: 0, y: 0, z: 0 },
 * 	{ x: 1, y: 0.5, z: 0 },
 * 	{ x: 0, y: 0.8, z: 1 },
 * 	{ x: 1, y: 0.2, z: 1 },
 * ];
 * camera3D.create({ children: [triSurface3D.create({ data: samples, x: "x", y: "y", z: "z" })] });
 * ```
 *
 * @category Plots
 */
export const triSurface3D = defineMesh3D<Props>({
	name: "TriSurface3D",
	props: {
		...mesh3DProps,
		data: { default: NO_DATA, invalidates: Invalidate.GEOMETRY },
		x: { invalidates: Invalidate.GEOMETRY },
		y: { invalidates: Invalidate.GEOMETRY },
		z: { invalidates: Invalidate.GEOMETRY },
	},
	faces: triSurfaceFaces,
});
