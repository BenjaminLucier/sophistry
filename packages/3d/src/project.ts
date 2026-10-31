/**
 * Shared plumbing for 3D shapes, the 3D counterpart of what core's shape
 * pipeline does for 2D: turn author-facing world geometry into a scene-unit
 * `Point`/`Polyline` a `ShapeSpec` can carry.
 */

import type { Point } from "@sophistry/core/geometry";
import { lerpPoint3 } from "@sophistry/core/geometry";
import type { Point3 } from "@sophistry/core/internal";
import { createProjected } from "@sophistry/core/internal";
import type { Camera3DValue } from "./context";

/** Depth a clipped near-plane point is nudged to — see `clipSegment`. */
const NEAR = 1e-3;

/**
 * A projected point plus its camera-space depth, for painter's-algorithm sort.
 *
 * @category Camera
 */
export interface ProjectedPoint extends Point {
	/** Camera-space depth in world units; larger is farther from the eye. */
	depth: number;
}

/**
 * Projects one world point through `camera`, in the camera's `origin`. Returns
 * `null` when the point is behind the eye — callers skip drawing it.
 *
 * Allocates one small object per call. A projected outline is a fresh array
 * per re-projection anyway, so this matches the surrounding convention; the
 * zero-allocation discipline lives in `geometry3d/`'s `Projection`, which this
 * calls into and which owns no per-point garbage of its own.
 *
 * @param camera - The camera value (see `requireCamera3D`).
 * @param point - World-space point.
 * @returns Scene-unit position (including the camera's `origin`) and depth, or `null` if behind the eye.
 *
 * @category Camera
 */
export function projectPoint(
	camera: Camera3DValue,
	point: Point3,
): ProjectedPoint | null {
	const projection = camera.ensure();
	const scratch = createProjected();
	const projected = projection.project(point, scratch);
	if (!projected) return null;
	const origin = camera.origin();
	return {
		x: origin.x + projected.x,
		y: origin.y + projected.y,
		depth: projected.depth,
	};
}

/**
 * A world-space segment trimmed to the part in front of the camera (the
 * near-plane crossing is an exact lerp by depth), or `null` when all of it is
 * behind the eye.
 *
 * @param camera - The camera value (see `requireCamera3D`).
 * @param from - World-space start.
 * @param to - World-space end.
 * @returns The visible part with flags for which end was moved, or `null`.
 *
 * @category Camera
 */
export function clipSegment(
	camera: Camera3DValue,
	from: Point3,
	to: Point3,
): {
	from: Point3;
	to: Point3;
	fromClipped: boolean;
	toClipped: boolean;
} | null {
	const projection = camera.ensure();
	const depthFrom = projection.depthOf(from);
	const depthTo = projection.depthOf(to);
	if (depthFrom <= NEAR && depthTo <= NEAR) return null;

	if (depthFrom <= NEAR) {
		const t = (NEAR - depthFrom) / (depthTo - depthFrom);
		return {
			from: lerpPoint3(from, to, t),
			to,
			fromClipped: true,
			toClipped: false,
		};
	}
	if (depthTo <= NEAR) {
		const t = (NEAR - depthTo) / (depthFrom - depthTo);
		return {
			from,
			to: lerpPoint3(to, from, t),
			fromClipped: false,
			toClipped: true,
		};
	}
	return { from, to, fromClipped: false, toClipped: false };
}

/**
 * Screen-space (scene-unit) length of a world-space length at `depth` —
 * `lineWidth = worldWidth * f / zAvg` and `rScreen = R * f / zCam` from the
 * analytical fast paths both go through this.
 *
 * @param camera - The camera value (see `requireCamera3D`).
 * @param worldLength - Length in world units.
 * @param depth - Camera-space depth at which to measure it.
 * @returns The on-screen length in scene units.
 *
 * @category Camera
 */
export function projectScale(
	camera: Camera3DValue,
	worldLength: number,
	depth: number,
): number {
	return camera.ensure().scaleAt(worldLength, depth);
}

/**
 * The `zIndex` a 3D shape publishes so nearer things draw later: `-depth`
 * (always negative). A 2D overlay above the whole 3D scene needs a larger
 * `zIndex`. Under a `camera3D` the depth sort reorders pieces within the same
 * set of values.
 *
 * @param depth - Camera-space depth in world units.
 * @returns `-depth`.
 *
 * @category Camera
 */
export function depthZ(depth: number): number {
	return -depth;
}
