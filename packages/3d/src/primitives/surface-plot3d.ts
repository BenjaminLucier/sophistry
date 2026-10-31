/**
 * `surfacePlot3D`: a parametric surface sampled onto a grid of flat-shaded
 * quads. Each cell becomes a `MeshFace`, so culling, shading and the scene
 * plumbing are `mesh.ts`'s. {@link surfaceFaces} is the face builder, shared
 * with `torus3D`.
 */

import { Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { defineMesh3D, type Mesh3DProps, mesh3DProps } from "../mesh";
import type { MeshFace } from "../mesh-math";

/** @category Plots */
export interface SurfacePlot3DProps extends Mesh3DProps {
	/**
	 * Parametric surface: maps `u` and `v`, both in [0,1], to a world-space
	 * point. Called for every grid point each time the faces are rebuilt (when
	 * it or `resolution` changes, never on a camera move): keep it cheap.
	 */
	function: (u: number, v: number) => Point3;
	/**
	 * Quads per parametric axis (rounded, at least 1), so the surface has `resolution^2` quads.
	 * @default 24
	 */
	resolution?: number;
}

const DEFAULT_RESOLUTION = 24;

function sampleGrid(
	surface: (u: number, v: number) => Point3,
	resolution: number,
): Point3[][] {
	const size = resolution + 1;
	const grid: Point3[][] = new Array(size);
	for (let j = 0; j < size; j++) {
		const row: Point3[] = new Array(size);
		const v = j / resolution;
		for (let i = 0; i < size; i++) {
			row[i] = surface(i / resolution, v);
		}
		grid[j] = row;
	}
	return grid;
}

/**
 * The faces of a parametric surface sampled on a `resolution × resolution`
 * grid: one quad per cell, wound so its normal is `d surface/dv × d surface/du`.
 *
 * @param surface - Maps `u` and `v` in [0,1] to a world-space point.
 * @param resolution - Quads per parametric axis (rounded, at least 1).
 * @returns The quads, row by row.
 * @category Math & helpers
 */
export function surfaceFaces(
	surface: (u: number, v: number) => Point3,
	resolution: number,
): MeshFace[] {
	const cells = Math.max(1, Math.round(resolution));
	const grid = sampleGrid(surface, cells);

	const out: MeshFace[] = [];
	for (let j = 0; j < cells; j++) {
		for (let i = 0; i < cells; i++) {
			const world0 = grid[j][i];
			const world1 = grid[j][i + 1];
			const world2 = grid[j + 1][i + 1];
			const world3 = grid[j + 1][i];

			// The natural grid-traversal order [world0, world1, world2, world3]
			// is a valid quad boundary, but the mesh's normal (from its first
			// three points, `(p1-p0)×(p2-p0)`) comes out negated from what this
			// primitive's outward-normal convention wants: algebraically, for
			// the near-planar quad a smooth surface's grid cell approximates
			// (world1 ≈ world0+a, world3 ≈ world0+b, world2 ≈ world0+a+b),
			// `cross(world1-world0, world2-world0) = cross(a, a+b) = cross(a,b)`,
			// the *negative* of the intended `cross(b,a)`. Traversing the same
			// four corners in reverse, [world0, world3, world2, world1], is still
			// a valid boundary (a simple polygon reversed is still simple) and
			// its first-three-point normal is
			// `cross(world3-world0, world2-world0) = cross(b, a+b) = cross(b,a)`,
			// the intended sign under the same approximation. So the reversal
			// alone, with no separate normal computed here, gives the outward
			// direction.
			out.push({ points: [world0, world3, world2, world1] });
		}
	}
	return out;
}

/**
 * A parametric surface, sampled onto a `resolution × resolution` grid and
 * drawn as flat-shaded quads.
 *
 * The surface is one-sided: it is visible from the side that the cross
 * product `d function/dv x d function/du` points toward, and culled from
 * behind. In the example below (`u` along +x, `v` along +z) that is the top,
 * so it shows from above. Swap `u` and `v` to flip which side is drawn. Must
 * be inside a `camera3D`; see {@link Mesh3DProps} for paint and light.
 *
 * @example
 * ```ts
 * import { surfacePlot3D } from "@sophistry/3d";
 *
 * const saddle = surfacePlot3D.create({
 * 	function: (u, v) => {
 * 		const x = u * 4 - 2;
 * 		const z = v * 4 - 2;
 * 		return { x, y: (x * x - z * z) / 4, z };
 * 	},
 * 	resolution: 20,
 * });
 * ```
 *
 * @category Plots
 */
export const surfacePlot3D = defineMesh3D<SurfacePlot3DProps>({
	name: "SurfacePlot3D",
	props: {
		...mesh3DProps,
		function: { invalidates: Invalidate.GEOMETRY },
		resolution: {
			default: DEFAULT_RESOLUTION,
			invalidates: Invalidate.GEOMETRY,
		},
	},
	// No `function` yet (a bound one not set, say): no faces.
	faces: (props) =>
		props.function
			? surfaceFaces(props.function, props.resolution ?? DEFAULT_RESOLUTION)
			: [],
});
