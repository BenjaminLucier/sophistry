/**
 * `curve3D`: a parametric curve `function(t)`, `t` in `[0, 1]`, sampled into a
 * polyline and projected. One piece, so `progress` reveals it by arc length
 * and handles and interaction work as on any shape.
 *
 * Sampling is the world half (it reruns only when `function` or `samples`
 * changes); clipping, projection and the perspective-scaled width are the
 * projection half, rerun on every camera move. `line3D` reuses that half
 * (`projectCurve`) over its two endpoints.
 */

import { Invalidate } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { Point3 } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import type { Camera3DValue } from "../context.js";
import type { ProjectedPoint } from "../project.js";
import { clipSegment, depthZ, projectPoint, projectScale } from "../project.js";
import type { Shape3DProps } from "../props3d.js";
import { shape3DProps } from "../props3d.js";
import type { ProjectedPiece } from "../shape3d.js";
import { defineShape3D } from "../shape3d.js";

/** @category Plots */
export interface Curve3DProps extends Shape3DProps {
	/**
	 * The curve, parameterized over `t` in `[0, 1]`. Called `samples + 1`
	 * times whenever it (or `samples`) changes, never on a camera move.
	 */
	function: (t: number) => Point3;
	/**
	 * Straight segments to flatten the curve into.
	 * @default 64
	 */
	samples?: number;
	/**
	 * Stroke thickness, in **world** units, perspective-scaled by depth via
	 * `projectScale` the same way the curve's own points are. Defaults to
	 * 0.04. Deliberately a separate prop from `Shape3DProps`'s inherited
	 * `strokeWidth` (which this primitive ignores) rather than an overload of
	 * it: `strokeWidth` on every other shape is a fixed scene-unit number,
	 * and a curve nearer the camera needs a *visually* thicker stroke than
	 * one farther away for the same `worldWidth`. The two units answer
	 * different questions and conflating them would silently break whichever
	 * one a caller assumed they were setting.
	 */
	worldWidth?: number;
}

const DEFAULT_SAMPLES = 64;
const DEFAULT_WORLD_WIDTH = 0.04;

/** One visible stretch of the curve, between near-plane cuts. */
interface Run {
	points: Point[];
	depthSum: number;
	depthCount: number;
}

/** What a curve's projection reads, besides its samples. */
export interface CurveLook {
	/** The stroke, else the theme foreground. */
	stroke: Shape3DProps["stroke"];
	/** Thickness in world units. */
	worldWidth: number;
}

/**
 * Samples `fn` at `samples + 1` evenly spaced `t` in `[0, 1]`: a curve's
 * world geometry. `samples` is rounded and at least 1.
 *
 * @internal
 */
export function sampleCurve(
	fn: (t: number) => Point3,
	samples: number,
): Point3[] {
	const count = Math.max(1, Math.round(samples));
	const points: Point3[] = new Array(count + 1);
	for (let i = 0; i <= count; i++) points[i] = fn(i / count);
	return points;
}

/**
 * The one piece a sampled curve draws: every segment clipped to the part in
 * front of the eye rather than dropped whole (see `clipSegment`'s doc for
 * why that distinction matters). A curve that dips behind the camera midway
 * comes out as several disjoint polylines in one piece (Canvas2D strokes
 * more than one subpath per call), not one that vanishes or that draws a
 * spurious chord across the gap. Shared by `curve3D` and `line3D`.
 *
 * @internal
 */
export function projectCurve(
	points: readonly Point3[],
	camera: Camera3DValue,
	look: CurveLook,
	theme: Theme,
): ProjectedPiece[] {
	const runs: Run[] = [];
	let current: Run | null = null;

	// Every drawn point, in world space and projected: the curve's piece in
	// the camera's depth sort.
	const world: Point3[] = [];
	const screen: ProjectedPoint[] = [];
	const pushPoint = (at: Point3, run: Run) => {
		const p = projectPoint(camera, at);
		if (!p) return;
		world.push(at);
		screen.push(p);
		run.points.push(p);
		run.depthSum += p.depth;
		run.depthCount++;
	};

	for (let i = 0; i < points.length - 1; i++) {
		const clipped = clipSegment(camera, points[i], points[i + 1]);
		if (!clipped) {
			// Wholly behind the eye: whatever run was in progress ends here, and
			// the next visible segment starts a new subpath rather than joining
			// this one across the gap.
			if (current) {
				runs.push(current);
				current = null;
			}
			continue;
		}
		if (!current) current = { points: [], depthSum: 0, depthCount: 0 };
		// Only push `from` when this run is just starting: every interior join
		// reuses the previous segment's `to`, so a run doesn't carry a duplicate
		// point at every sample boundary.
		if (current.points.length === 0) pushPoint(clipped.from, current);
		pushPoint(clipped.to, current);
		// A clipped endpoint is where this segment crosses the near plane: the
		// curve is cut here whether or not the *next* sample is visible, so a
		// run never carries a clipped point in its interior.
		if (clipped.toClipped) {
			runs.push(current);
			current = null;
		}
	}
	if (current) runs.push(current);

	const stroke = look.stroke ?? theme.palette.foreground;
	const visibleRuns = runs.filter((run) => run.points.length >= 2);
	if (visibleRuns.length === 0) {
		return [
			{
				geometry: { polylines: [], closed: false },
				z: 0,
				style: { stroke, strokeWidth: 0, fill: undefined, fillOpacity: 0 },
			},
		];
	}

	let depthSum = 0;
	let depthCount = 0;
	for (const run of visibleRuns) {
		depthSum += run.depthSum;
		depthCount += run.depthCount;
	}
	const zAvg = depthSum / depthCount;

	return [
		{
			geometry: {
				polylines: visibleRuns.map((run) => run.points),
				closed: false,
				fillFrom: 0,
			},
			z: depthZ(zAvg),
			depth: { world, screen },
			// Never filled; the width follows the curve's mean depth.
			style: {
				stroke,
				strokeWidth: projectScale(camera, look.worldWidth, zAvg),
				fill: undefined,
				fillOpacity: 0,
			},
		},
	];
}

/**
 * A parametric 3D curve, drawn as `samples` straight segments, each clipped
 * to the part in front of the eye, so a curve passing behind the camera
 * breaks into separate strokes instead of vanishing.
 *
 * Stroke colour is `stroke`, else the theme foreground; the curve is never
 * filled. Thickness is `worldWidth` (world units), not `strokeWidth`.
 * `progress` reveals it along its arc length. Must be inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { curve3D } from "@sophistry/3d";
 *
 * const helix = curve3D.create({
 * 	function: (t) => ({ x: Math.cos(t * 12), y: t * 3, z: Math.sin(t * 12) }),
 * 	samples: 128,
 * 	stroke: "#4af",
 * });
 * ```
 *
 * @see {@link line3D} for the straight-line case.
 * @category Plots
 */
export const curve3D = defineShape3D<Curve3DProps, Point3[]>({
	name: "Curve3D",
	props: {
		...shape3DProps,
		stroke: { invalidates: Invalidate.UPDATE },
		function: { invalidates: Invalidate.GEOMETRY },
		samples: { default: DEFAULT_SAMPLES, invalidates: Invalidate.GEOMETRY },
		worldWidth: {
			default: DEFAULT_WORLD_WIDTH,
			invalidates: Invalidate.UPDATE,
		},
	},
	world: (props) =>
		props.function
			? sampleCurve(props.function, props.samples ?? DEFAULT_SAMPLES)
			: [],
	project: (points, camera, props, theme) =>
		projectCurve(
			points,
			camera,
			{
				stroke: props.stroke,
				worldWidth: props.worldWidth ?? DEFAULT_WORLD_WIDTH,
			},
			theme,
		),
});
