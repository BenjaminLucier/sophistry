/** A boolean voxel grid drawn as flat-shaded cube faces, hidden shared faces culled. */

import type { MeshFacesProps } from "@sophistry/3d";
import { defineMesh3D, mesh3DProps } from "@sophistry/3d";
import { Invalidate } from "@sophistry/core";
import { voxelFaces } from "../math/3d/voxels";

/** @category Plots */
export interface Voxels3DProps extends Omit<MeshFacesProps, "faces"> {
	/** `values[i][j][k]`; ragged or `undefined` entries are empty. A `true` voxel fills the unit cube `[i,i+1] x [j,j+1] x [k,k+1]`. */
	values: readonly (readonly (readonly boolean[])[])[];
}

const NO_VALUES: Voxels3DProps["values"] = [];

/**
 * A grid of unit cubes, drawn as flat-shaded quads (faces hidden by a
 * neighbour are skipped). The faces are rebuilt only when `values` changes,
 * never on a camera move. Render under a `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { voxels3D } from "@sophistry/charts/3d";
 *
 * // An L of three cubes.
 * const values = [[[true], [true]], [[true]]];
 * camera3D.create({ children: [voxels3D.create({ values, fill: "#fa4" })] });
 * ```
 *
 * @category Plots
 */
export const voxels3D = defineMesh3D<Voxels3DProps>({
	name: "Voxels3D",
	props: {
		...mesh3DProps,
		values: { default: NO_VALUES, invalidates: Invalidate.GEOMETRY },
	},
	faces: (props) => voxelFaces(props.values ?? NO_VALUES),
});
