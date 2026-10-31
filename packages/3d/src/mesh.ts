/**
 * `meshFaces`: the shared engine behind the solid 3D primitives and surfaces.
 * It culls back faces, projects each face, flat-shades it and draws it as one
 * piece (one child shape) in the camera's depth sort. Style and interaction
 * props go to every face (so the whole solid answers the pointer).
 *
 * {@link defineMesh3D} makes a mesh primitive from a `faces(props)` builder:
 * the faces and their normals are the world stage (rebuilt only when a face
 * input changes), culling, projection and shading the projection stage (rerun
 * on a camera move).
 */

import { Invalidate } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import { shadeColor, toCss } from "@sophistry/core/color";
import type { Point3 } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import type { Camera3DValue } from "./context";
import type { MeshFace, MeshLight } from "./mesh-math";
import {
	cross3,
	dot3,
	isFrontFacing,
	normalize3,
	subtract3,
} from "./mesh-math";
import type { ProjectedPoint } from "./project";
import { depthZ, projectPoint } from "./project";
import type { Shape3DProps } from "./props3d";
import { shape3DProps } from "./props3d";
import type { ProjectedPiece, Shape3DOptions } from "./shape3d";
import { defineShape3D } from "./shape3d";

export type { MeshFace, MeshLight } from "./mesh-math";

const DEFAULT_AMBIENT = 0.35;
const DEFAULT_DIFFUSE = 0.75;
const DEFAULT_LIGHT_DIRECTION: Point3 = { x: -0.4, y: 0.8, z: 0.4 };

/**
 * The props every mesh primitive shares: `Shape3DProps` with `fill` narrowed
 * to a flat colour (a mesh's interior paint is always the per-face flat
 * shading of `fill` under `light`, so a gradient, which has no sensible
 * per-face meaning, doesn't apply). `stroke` still means what it means on
 * any shape: an outline drawn on top of each face's silhouette, `"none"` by
 * default because a stroke on every face would double the rim the shading
 * already darkens where faces meet.
 *
 * @category Primitives
 */
export interface Mesh3DProps extends Omit<Shape3DProps, "fill"> {
	/**
	 * Base colour, flat-shaded per face. Defaults to the theme's accent,
	 * matching every other primitive's default (`sphere3D`, `dot`). Any CSS
	 * colour `parseColor` recognises, or a `Color`.
	 */
	fill?: ColorInput;
	/** Lighting for the flat shading; see {@link MeshLight} for the defaults. */
	light?: MeshLight;
}

/** @category Primitives */
export interface MeshFacesProps extends Mesh3DProps {
	/** The polygons to draw, as world-space corners in winding order (counter-clockwise seen from outside). */
	faces: MeshFace[];
}

/**
 * Descriptor entries for {@link Mesh3DProps}: `shape3DProps` with `fill`,
 * `stroke` and `light` re-projecting (they set each face's own paint).
 *
 * @category Extending
 */
export const mesh3DProps = Object.freeze({
	...shape3DProps,
	fill: { invalidates: Invalidate.UPDATE },
	stroke: { invalidates: Invalidate.UPDATE },
	light: { invalidates: Invalidate.UPDATE },
});

/**
 * A face ready to project: its corners and its outward unit normal (from the
 * first three corners), computed once per world rebuild.
 *
 * @category Extending
 */
export interface PreparedFace {
	/** Corners in world units, at least 3, in winding order. */
	points: Point3[];
	/** Unit normal from `(p1 - p0) x (p2 - p0)`. */
	normal: Point3;
}

/**
 * The world stage of a mesh: drops faces with fewer than three corners and
 * computes each face's normal.
 *
 * @param faces - World-space faces in winding order.
 * @returns The faces with their normals.
 * @category Extending
 */
export function prepareFaces(faces: readonly MeshFace[]): PreparedFace[] {
	const out: PreparedFace[] = [];
	for (const face of faces) {
		const points = face.points;
		if (points.length < 3) continue;
		out.push({
			points,
			normal: normalize3(
				cross3(
					subtract3(points[1], points[0]),
					subtract3(points[2], points[0]),
				),
			),
		});
	}
	return out;
}

/**
 * The projection stage of a mesh: culls back faces, projects the rest and
 * shades each by `fill` under `light`. One piece per drawn face, each its own
 * depth item.
 *
 * @param faces - From {@link prepareFaces}.
 * @param camera - The camera to project through.
 * @param props - The mesh's paint and light.
 * @param theme - For the default `fill`.
 * @returns The pieces.
 * @category Extending
 */
export function projectFaces(
	faces: readonly PreparedFace[],
	camera: Camera3DValue,
	props: Readonly<Mesh3DProps>,
	theme: Theme,
): ProjectedPiece[] {
	const ambient = props.light?.ambient ?? DEFAULT_AMBIENT;
	const diffuse = props.light?.diffuse ?? DEFAULT_DIFFUSE;
	const lightDir = normalize3(
		props.light?.direction ?? DEFAULT_LIGHT_DIRECTION,
	);
	const base = props.fill ?? theme.palette.accent;
	const stroke = props.stroke ?? "none";
	const eye = camera.ensure().eye;

	const out: ProjectedPiece[] = [];
	for (const face of faces) {
		const { points, normal } = face;
		// True 3D backface cull (`N·V`): `box.ts`/`ring.ts` wind every face
		// counter-clockwise as seen from *outside* the solid, so `normal`
		// always points outward, and `isFrontFacing` culls whenever it points
		// away from the eye. Tested before projection so a culled face skips
		// projection work entirely.
		if (!isFrontFacing(normal, eye, points[0])) continue;

		const screen: ProjectedPoint[] = [];
		let behind = false;
		for (const point of points) {
			const p = projectPoint(camera, point);
			if (!p) {
				behind = true;
				break;
			}
			screen.push(p);
		}
		// Any corner behind the eye has no honest screen position, so the whole
		// face is skipped: true near-plane *polygon* clipping (as opposed to the
		// segment clipping `vector3D`/`curve3D` do) is a bigger lift than a
		// solid's faces need, since a face this close to the eye is usually one
		// of many on the same solid and losing it briefly reads as nothing worse
		// than the solid thinning out as the camera passes through it.
		if (behind) continue;

		const intensity = ambient + diffuse * Math.max(0, dot3(normal, lightDir));

		let depthSum = 0;
		for (const p of screen) depthSum += p.depth;

		out.push({
			geometry: { polylines: [[...screen, screen[0]]], closed: true },
			z: depthZ(depthSum / screen.length),
			depth: { world: points, screen, normal },
			style: { fill: toCss(shadeColor(base, intensity)), stroke },
		});
	}
	return out;
}

/**
 * Options for {@link defineMesh3D}.
 *
 * @category Extending
 */
export interface Mesh3DOptions<P extends Mesh3DProps> {
	/** PascalCase display and codegen name. */
	name: string;
	/** One entry per prop: `...mesh3DProps` plus the face inputs (`Invalidate.GEOMETRY`). */
	props: Shape3DOptions<P, readonly PreparedFace[]>["props"];
	/** The world-space faces, wound counter-clockwise seen from outside. */
	faces: (props: Readonly<P>) => readonly MeshFace[];
}

/**
 * Makes a flat-shaded mesh primitive from a face builder: `meshFaces`,
 * `prism3D`, `cylinder3D` and the polyhedra are all this.
 *
 * @param options - See {@link Mesh3DOptions}.
 * @returns The definition.
 * @category Extending
 */
export function defineMesh3D<P extends Mesh3DProps>(options: Mesh3DOptions<P>) {
	return defineShape3D<P, readonly PreparedFace[]>({
		name: options.name,
		props: options.props,
		world: (props) => prepareFaces(options.faces(props)),
		project: projectFaces,
	});
}

const NO_FACES: MeshFace[] = [];

/**
 * Draws a list of world-space polygons as flat-shaded faces; the engine under
 * the solids and surfaces, usable for your own mesh. Faces are one-sided
 * (visible when counter-clockwise from the camera) and depth-sorted with
 * everything else under the camera; intersecting faces are not split. An
 * explicit `zIndex` takes the mesh out of the sort.
 *
 * @example
 * ```ts
 * import { meshFaces } from "@sophistry/3d";
 *
 * const triangle = meshFaces.create({
 * 	faces: [{ points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }] }],
 * 	fill: "tomato",
 * });
 * ```
 *
 * @see {@link MeshFace}
 * @category Primitives
 */
export const meshFaces = defineMesh3D<MeshFacesProps>({
	name: "MeshFaces",
	props: {
		...mesh3DProps,
		faces: { default: NO_FACES, invalidates: Invalidate.GEOMETRY },
	},
	faces: (props) => props.faces ?? NO_FACES,
});
