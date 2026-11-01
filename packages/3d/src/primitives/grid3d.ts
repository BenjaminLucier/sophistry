/**
 * `grid3D`: a reference grid over one coordinate plane, as one piece of many
 * short polylines (lines need no per-line shading or paint slot). The lines'
 * world segments are built once per `plane`/`extent`/`step`/`offset`; a
 * camera move only clips and projects them.
 */

import { Invalidate } from "@sophistry/core";
import type { Point, Polyline } from "@sophistry/core/geometry";
import type { Point3 } from "@sophistry/core/internal";
import type { ProjectedPoint } from "../project.js";
import { clipSegment, depthZ, projectPoint, projectScale } from "../project.js";
import type { Shape3DProps } from "../props3d.js";
import { shape3DProps } from "../props3d.js";
import type { ProjectedPiece } from "../shape3d.js";
import { defineShape3D } from "../shape3d.js";

/**
 * Which coordinate plane a {@link grid3D} lies in; the normal is the omitted axis.
 *
 * @category Primitives
 */
export type GridPlane = "xz" | "xy" | "yz";

/** @category Primitives */
export interface Grid3DProps extends Shape3DProps {
	/**
	 * Which coordinate plane the grid lies in. Defaults to `"xz"`, the ground
	 * plane under this framework's y-up convention.
	 */
	plane?: GridPlane;
	/**
	 * Half-extent of the grid along each in-plane axis, in world units: an
	 * `extent` of 5 draws a 10×10 square. Defaults to 5.
	 */
	extent?: number;
	/**
	 * Spacing between lines, in world units.
	 * @default 1
	 */
	step?: number;
	/**
	 * Offset along the plane's normal (e.g. `y` for `"xz"`).
	 * @default 0
	 */
	offset?: number;
	/**
	 * Line thickness, in world units: see `curve3D`'s `worldWidth` for why
	 * this is separate from the inherited `strokeWidth`. Defaults to 0.015.
	 */
	worldWidth?: number;
}

const DEFAULT_EXTENT = 5;
const DEFAULT_STEP = 1;
const DEFAULT_OPACITY = 0.35;
const DEFAULT_WORLD_WIDTH = 0.015;
/** Most lines drawn on each side of the centre line (so at most `2 * MAX + 1` per axis). */
const MAX_LINES_PER_SIDE = 100;

/**
 * Lines per side of centre: `floor(extent / step)` so the outermost line never
 * overshoots `extent`, clamped to `[1, MAX_LINES_PER_SIDE]`. A non-finite or
 * non-positive `step` is treated as the default step, 1.
 *
 * @param extent - Half-extent of the grid, in world units.
 * @param step - Spacing between lines, in world units.
 * @returns How many lines to draw on each side of the centre line.
 *
 * @category Primitives
 */
export function gridLineCount(extent: number, step: number): number {
	const safeStep = step > 0 && Number.isFinite(step) ? step : DEFAULT_STEP;
	const raw = Math.floor(extent / safeStep + 1e-9);
	return Math.min(MAX_LINES_PER_SIDE, Math.max(1, raw));
}

/** The unit normal of each grid plane, for the depth sort. */
const PLANE_NORMALS: Record<GridPlane, Point3> = {
	xz: { x: 0, y: 1, z: 0 },
	xy: { x: 0, y: 0, z: 1 },
	yz: { x: 1, y: 0, z: 0 },
};

/**
 * A point on `plane`, at in-plane coordinates `(u, v)` and `offset` along the
 * plane's normal: `xz`'s normal is `y`, `xy`'s is `z`, `yz`'s is `x`.
 */
function pointOnPlane(
	plane: GridPlane,
	u: number,
	v: number,
	offset: number,
): Point3 {
	switch (plane) {
		case "xz":
			return { x: u, y: offset, z: v };
		case "xy":
			return { x: u, y: v, z: offset };
		case "yz":
			return { x: offset, y: u, z: v };
	}
}

/** A grid's world geometry: every line as a segment, and its plane. */
export interface GridLines {
	plane: GridPlane;
	segments: [Point3, Point3][];
}

/** Every line of the grid, in drawing order: for each offset, the line along `v` then the one along `u`. */
function gridLines(props: Readonly<Grid3DProps>): GridLines {
	const plane = props.plane ?? "xz";
	const extent = Math.max(1e-6, props.extent ?? DEFAULT_EXTENT);
	const rawStep = props.step ?? DEFAULT_STEP;
	const step = rawStep > 0 && Number.isFinite(rawStep) ? rawStep : DEFAULT_STEP;
	const offset = props.offset ?? 0;
	const count = gridLineCount(extent, step);

	const segments: [Point3, Point3][] = [];
	for (let i = -count; i <= count; i++) {
		const distance = i * step;
		segments.push(
			[
				pointOnPlane(plane, distance, -extent, offset),
				pointOnPlane(plane, distance, extent, offset),
			],
			[
				pointOnPlane(plane, -extent, distance, offset),
				pointOnPlane(plane, extent, distance, offset),
			],
		);
	}
	return { plane, segments };
}

/**
 * A ruled reference grid over one coordinate plane, `extent` world units out
 * from the origin in every in-plane direction.
 *
 * The default `"xz"` plane is the ground under the library's y-up
 * convention. Lines are stroked in the theme's muted colour at 0.35 opacity
 * unless you pass `stroke`/`opacity`, and their thickness is `worldWidth`
 * (world units), not `strokeWidth`. The whole grid is one shape, so pointer
 * handlers fire for the grid as a whole. Must be inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { grid3D } from "@sophistry/3d";
 *
 * const floor = grid3D.create({ extent: 4, step: 0.5 });
 * const wall = grid3D.create({ plane: "xy", offset: -4 });
 * ```
 *
 * @see {@link axes3D}
 * @category Primitives
 */
export const grid3D = defineShape3D<Grid3DProps, GridLines>({
	name: "Grid3D",
	props: {
		...shape3DProps,
		stroke: { invalidates: Invalidate.UPDATE },
		opacity: { default: DEFAULT_OPACITY, invalidates: Invalidate.UPDATE },
		plane: { default: "xz", invalidates: Invalidate.GEOMETRY },
		extent: { default: DEFAULT_EXTENT, invalidates: Invalidate.GEOMETRY },
		step: { default: DEFAULT_STEP, invalidates: Invalidate.GEOMETRY },
		offset: { default: 0, invalidates: Invalidate.GEOMETRY },
		worldWidth: {
			default: DEFAULT_WORLD_WIDTH,
			invalidates: Invalidate.UPDATE,
		},
	},
	world: gridLines,
	project: ({ plane, segments }, camera, props, theme): ProjectedPiece[] => {
		const polylines: Polyline[] = [];
		const world: Point3[] = [];
		const screen: ProjectedPoint[] = [];
		let depthSum = 0;
		let depthCount = 0;

		for (const [from, to] of segments) {
			const clipped = clipSegment(camera, from, to);
			if (!clipped) continue;
			const pa = projectPoint(camera, clipped.from);
			const pb = projectPoint(camera, clipped.to);
			if (!pa || !pb) continue;
			polylines.push([pa, pb] as Point[]);
			world.push(clipped.from, clipped.to);
			screen.push(pa, pb);
			depthSum += pa.depth + pb.depth;
			depthCount += 2;
		}

		const stroke = props.stroke ?? theme.palette.muted;
		const opacity = props.opacity ?? DEFAULT_OPACITY;
		if (polylines.length === 0) {
			return [
				{
					geometry: { polylines: [], closed: false },
					z: 0,
					style: {
						stroke,
						strokeWidth: 0,
						fill: undefined,
						fillOpacity: 0,
						opacity,
					},
				},
			];
		}

		const zAvg = depthSum / depthCount;
		return [
			{
				geometry: { polylines, closed: false },
				z: depthZ(zAvg),
				// One flat piece: the grid's plane lets the sort put a solid standing
				// on it in front, even though the grid's centroid may be nearer.
				depth: { world, screen, normal: PLANE_NORMALS[plane] },
				style: {
					stroke,
					strokeWidth: projectScale(
						camera,
						props.worldWidth ?? DEFAULT_WORLD_WIDTH,
						zAvg,
					),
					fill: undefined,
					fillOpacity: 0,
					opacity,
				},
			},
		];
	},
});
