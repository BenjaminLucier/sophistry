/**
 * The 3D charts' definitions, keyed by export name and sorted: merged into
 * `@sophistry/charts/definitions`, which codegen reads to generate the
 * bindings' 3D chart components (`export const BarChart3D = wrap(barChart3D);`).
 * Listed by hand (eight entries) rather than collected from the barrel, so
 * the 2D definitions record decides when to pull the `3d` peer in.
 */

import { barChart3D } from "./bar-chart3d.js";
import { quiver3D } from "./quiver3d.js";
import { scatter3D } from "./scatter3d.js";
import { stem3D } from "./stem3d.js";
import { surfaceGrid3D } from "./surface-grid3d.js";
import { triSurface3D } from "./tri-surface3d.js";
import { voxels3D } from "./voxels3d.js";
import { wireframe3D } from "./wireframe3d.js";

/**
 * Every 3D chart definition, by export name.
 *
 * @category Scene graph
 */
export const charts3DDefinitions = Object.freeze({
	barChart3D,
	quiver3D,
	scatter3D,
	stem3D,
	surfaceGrid3D,
	triSurface3D,
	voxels3D,
	wireframe3D,
});

/**
 * The same record under the name `@sophistry/codegen` reads.
 *
 * @category Charts
 */
export const definitions = charts3DDefinitions;
