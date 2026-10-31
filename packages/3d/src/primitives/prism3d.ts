/**
 * Boxes: `prism3D`, a rectangular box drawn as six flat-shaded quads, and
 * `cube3D`, its equal-extents special case. The face-building geometry and
 * its winding live once in `box.ts`; these turn their props into the
 * `center ± half` corners `boxFaces` expects.
 */

import { Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { boxFaces } from "../box";
import { defineMesh3D, type Mesh3DProps, mesh3DProps } from "../mesh";

/** @category Primitives */
export interface Prism3DProps extends Mesh3DProps {
	/** World-space centre. Defaults to the world origin. */
	center?: Point3;
	/**
	 * Full extent along x, in world units.
	 * @default 1
	 */
	width?: number;
	/**
	 * Full extent along y, in world units.
	 * @default 1
	 */
	height?: number;
	/**
	 * Full extent along z, in world units.
	 * @default 1
	 */
	depth?: number;
}

/** @category Primitives */
export interface Cube3DProps extends Mesh3DProps {
	/** World-space centre. Defaults to the world origin. */
	center?: Point3;
	/**
	 * Edge length, in world units.
	 * @default 1
	 */
	size?: number;
}

const DEFAULT_CENTER: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * An axis-aligned, flat-shaded rectangular box with independent extents along
 * x, y and z.
 *
 * Use it for slabs, walls and bars; use `cube3D` when all edges match. Must
 * be inside a `camera3D`. Projection, culling, shading, style and interaction
 * are `meshFaces`'; see {@link Mesh3DProps}.
 *
 * @example
 * ```ts
 * import { prism3D } from "@sophistry/3d";
 *
 * const slab = prism3D.create({ width: 4, height: 0.2, depth: 3, fill: "#888" });
 * ```
 *
 * @category Primitives
 */
export const prism3D = defineMesh3D<Prism3DProps>({
	name: "Prism3D",
	props: {
		...mesh3DProps,
		center: { default: DEFAULT_CENTER, invalidates: Invalidate.GEOMETRY },
		width: { default: 1, invalidates: Invalidate.GEOMETRY },
		height: { default: 1, invalidates: Invalidate.GEOMETRY },
		depth: { default: 1, invalidates: Invalidate.GEOMETRY },
	},
	faces: (props) =>
		boxFaces(
			props.center ?? DEFAULT_CENTER,
			props.width ?? 1,
			props.height ?? 1,
			props.depth ?? 1,
		),
});

/**
 * An axis-aligned, flat-shaded cube.
 *
 * Colour is `fill` (default: theme accent); each face is shaded from a light
 * set by `light`. Must be inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { cube3D } from "@sophistry/3d";
 *
 * const cube = cube3D.create({ size: 2, fill: "tomato" });
 * ```
 *
 * @see {@link prism3D} for unequal edge lengths.
 * @category Primitives
 */
export const cube3D = defineMesh3D<Cube3DProps>({
	name: "Cube3D",
	props: {
		...mesh3DProps,
		center: { default: DEFAULT_CENTER, invalidates: Invalidate.GEOMETRY },
		size: { default: 1, invalidates: Invalidate.GEOMETRY },
	},
	faces: (props) => {
		const size = props.size ?? 1;
		return boxFaces(props.center ?? DEFAULT_CENTER, size, size, size);
	},
});
