/** A surface from three precomputed coordinate grids, drawn as flat-shaded quads. */

import type { MeshFacesProps } from "@sophistry/3d";
import { defineMesh3D, mesh3DProps } from "@sophistry/3d";
import { Invalidate } from "@sophistry/core";
import { surfaceGridFaces } from "../math/3d/surfaceGrid3d";

/** @category Plots */
export interface SurfaceGrid3DProps extends Omit<MeshFacesProps, "faces"> {
	/** `nrows x ncols` grid of world x coordinates, `xs[row][col]`. All three grids must share a shape, or this throws. */
	xs: number[][];
	/** Grid of world y (height) coordinates, same shape as `xs`. */
	ys: number[][];
	/** Grid of world z coordinates, same shape as `xs`. */
	zs: number[][];
}

const NO_GRID: number[][] = [];

/**
 * A surface given as three coordinate grids (`xs`, `ys`, `zs`) you compute
 * yourself, drawn as flat-shaded quads. Faces are one-sided: with `xs`
 * increasing along columns and `zs` along rows, the top (+y) side shows.
 * The quads are rebuilt only when a grid changes, never on a camera move.
 * Render under a `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { surfaceGrid3D } from "@sophistry/charts/3d";
 *
 * const xs = [[0, 1], [0, 1]];
 * const ys = [[0, 0.5], [0.5, 1]];
 * const zs = [[0, 0], [1, 1]];
 * camera3D.create({ children: [surfaceGrid3D.create({ xs, ys, zs, fill: "#4af" })] });
 * ```
 *
 * @see {@link surfacePlot3D} for a surface from a function.
 * @category Plots
 */
export const surfaceGrid3D = defineMesh3D<SurfaceGrid3DProps>({
	name: "SurfaceGrid3D",
	props: {
		...mesh3DProps,
		xs: { default: NO_GRID, invalidates: Invalidate.GEOMETRY },
		ys: { default: NO_GRID, invalidates: Invalidate.GEOMETRY },
		zs: { default: NO_GRID, invalidates: Invalidate.GEOMETRY },
	},
	faces: (props) =>
		surfaceGridFaces(
			props.xs ?? NO_GRID,
			props.ys ?? NO_GRID,
			props.zs ?? NO_GRID,
		),
});
