/**
 * The 3D to 2D projection: a view matrix plus a manual perspective divide with
 * focal length `f = height / (2 tan(fovY / 2))`. Results are in scene units, so
 * 3D content shares the 2D pipeline.
 */

import type { Mat4, Point3, Scratch, Vec3 } from "./mat";
import { createMat4, createScratch, mat4, vec3 } from "./mat";

/**
 * Everything a {@link Projection} needs to build its view matrix: where the
 * camera is, what it looks at, and which way is up. The coordinate system is
 * right-handed (`+x` right, `+y` up, `+z` toward the viewer for the default
 * camera); the camera looks from `eye` toward `target`.
 *
 * @category Camera
 */
export interface Camera3DState {
	/** Camera position, in world units. Must differ from `target`; if equal, the {@link Projection} projects nothing (every `project()` returns `null`). */
	eye: Point3;
	/** The world point the camera looks at, in world units. */
	target: Point3;
	/** Up direction, in world units. If zero or parallel to `eye - target`, world +y (or +z when looking along y) is used instead. */
	up: Point3;
	/** Vertical field of view, radians; clamped into (0, π). Non-finite falls back to π/3. */
	fovY: number;
}

/** Mutable so `Projection` can update it in place each `update()` without
 * allocating; callers that need a stable snapshot should copy it.
 *
 * @category Camera
 */
export interface MutablePoint3 {
	x: number;
	y: number;
	z: number;
}

/**
 * The result of projecting one world point: a scene-unit offset from the
 * optical axis plus the point's camera-space depth. Allocate one with
 * {@link createProjected} and reuse it as the `out` argument of
 * {@link Projection.project}.
 *
 * @category Camera
 */
export interface Projected {
	/**
	 * Offset from the camera's optical axis, in scene units, already oriented
	 * so `+y` is up — the same convention a `yUp` stage's `x`/`y` shape props
	 * use. A 3D component adds this to wherever it wants the camera's target
	 * to sit on screen (its `origin`, {0,0} by default) to get a final
	 * scene-unit position, exactly as a 2D shape adds its own `x`/`y` before
	 * `space.matrix()` converts to pixels. Neither this struct nor `project()`
	 * knows about the stage's centre, size, or `yUp` — that composition happens
	 * one layer up, in `scene3d/`.
	 */
	x: number;
	y: number;
	/**
	 * Camera-space depth: distance along the view direction, in scene units.
	 * Larger is farther from the eye. Used for painter's-algorithm sorting and
	 * for scaling radii/line widths by distance.
	 */
	depth: number;
}

/**
 * A perspective camera: turns world-space points into scene-unit offsets and
 * depths.
 *
 * Call {@link Projection.update} once per frame with the camera state, then
 * {@link Projection.project} for each point. Most code never constructs one:
 * `<Camera3D>` owns a `Projection` and shares it with its children through
 * {@link useCamera3D}. Reach for this class directly only for custom 3D
 * components or tests.
 *
 * Stateful only in its scratch buffers — `update()` and `project()` are each
 * idempotent given the same inputs. One instance is shared by every 3D shape
 * under a `<Camera3D>`, rebuilt once per frame by the component that owns the
 * camera rather than once per projected point.
 *
 * @category Camera
 */
export class Projection {
	private readonly scratch: Scratch = createScratch();
	private readonly view: Mat4 = createMat4();
	private readonly eyeVec: Vec3 = vec3.create();
	private focalLength = 0;
	private ready = false;

	/**
	 * The camera's world-space eye position, updated in place by `update()`.
	 * Exposed for true `N·V` backface culling (dot of a face's world-space
	 * normal with the direction from the face to the eye) — everything else in
	 * this class works in camera space or scene-unit projections, but that
	 * test needs the eye itself, before either transform.
	 */
	readonly eye: MutablePoint3 = { x: 0, y: 0, z: 0 };

	/**
	 * Rebuilds the view matrix and focal length for one frame's viewport.
	 *
	 * `viewportHeight` is in scene units (the stage's `frame()` height, not
	 * device pixels) — see the module doc for why projected coordinates stay
	 * in scene units.
	 *
	 * @param state - Eye, target, up and vertical field of view (radians).
	 * @param viewportHeight - Height of the visible scene area, in scene units.
	 */
	update(state: Camera3DState, viewportHeight: number): void {
		const { vecA: targetVec, vecB: upVec } = this.scratch;
		this.eye.x = state.eye.x;
		this.eye.y = state.eye.y;
		this.eye.z = state.eye.z;

		// eye == target (or a non-finite state) has no view direction; there is
		// nothing sensible to project, so behave as before the first update().
		const dx = state.target.x - state.eye.x;
		const dy = state.target.y - state.eye.y;
		const dz = state.target.z - state.eye.z;
		const dist = Math.hypot(dx, dy, dz);
		if (!(dist > 1e-12) || !Number.isFinite(dist)) {
			this.ready = false;
			return;
		}

		// A zero or view-parallel `up` makes the basis collapse; fall back to
		// world +y, or +z when the camera looks straight along y.
		let up = state.up;
		const upLen = Math.hypot(up.x, up.y, up.z);
		const crossLen = Math.hypot(
			dy * up.z - dz * up.y,
			dz * up.x - dx * up.z,
			dx * up.y - dy * up.x,
		);
		if (!(upLen > 0) || !(crossLen > 1e-6 * dist * upLen)) {
			up =
				Math.abs(dy) / dist < 1 - 1e-6
					? { x: 0, y: 1, z: 0 }
					: { x: 0, y: 0, z: 1 };
		}

		vec3.set(state.eye.x, state.eye.y, state.eye.z, this.eyeVec);
		vec3.set(state.target.x, state.target.y, state.target.z, targetVec);
		vec3.set(up.x, up.y, up.z, upVec);
		mat4.lookAt(this.eyeVec, targetVec, upVec, this.view);
		// fovY of 0 or >= pi would give an infinite or negative focal length.
		const fov = Number.isFinite(state.fovY)
			? Math.min(Math.max(state.fovY, 1e-4), Math.PI - 1e-4)
			: Math.PI / 3;
		this.focalLength = viewportHeight / (2 * Math.tan(fov / 2));
		this.ready = true;
	}

	/**
	 * Projects one world point, writing into `out`. Returns `null` when the
	 * point is behind the eye (or closer than a tiny epsilon, `1e-6`) — callers
	 * skip drawing it rather than dividing by a near-zero or negative depth.
	 * Also returns `null` before the first `update()`, and after an `update()`
	 * whose `eye` equals its `target` (no view direction exists).
	 *
	 * @param point - World-space point.
	 * @param out - Receives the result; returned on success.
	 * @returns `out`, or `null` if the point cannot be projected.
	 */
	project(point: Point3, out: Projected): Projected | null {
		if (!this.ready) return null;
		const cam = this.scratch.vecC;
		vec3.set(point.x, point.y, point.z, this.scratch.vecA);
		vec3.transformMat4(this.scratch.vecA, this.view, cam);

		// `lookAt` is right-handed: the eye looks down -Z, so a point in front
		// of the camera has a negative Z in camera space.
		const depth = -cam[2];
		if (depth <= 1e-6) return null;

		const invDepth = 1 / depth;
		out.x = cam[0] * this.focalLength * invDepth;
		out.y = cam[1] * this.focalLength * invDepth;
		out.depth = depth;
		return out;
	}

	/**
	 * Screen-space size (scene units) of a world-space length at `depth`.
	 *
	 * @param worldLength - A length in world units, perpendicular to the view direction.
	 * @param depth - Camera-space depth, as in {@link Projected.depth}.
	 * @returns The on-screen length in scene units, or `0` for a non-positive depth.
	 */
	scaleAt(worldLength: number, depth: number): number {
		if (depth <= 1e-6) return 0;
		return (worldLength * this.focalLength) / depth;
	}

	/**
	 * A world point's camera-space depth, without the divide `project()` does —
	 * for near-plane clipping, which needs to know *how far* behind the eye a
	 * point is (to interpolate toward it), not just whether it's safe to
	 * project. `view` is a rigid transform (rotation + translation, no
	 * perspective), so depth is an affine function of world position; that is
	 * what makes lerping two endpoints' *world* coordinates by depth alone
	 * exact, with no need to lerp in camera or screen space.
	 *
	 * @param point - World-space point.
	 * @returns Signed depth in world units; negative or zero means behind the eye.
	 */
	depthOf(point: Point3): number {
		const cam = this.scratch.vecC;
		vec3.set(point.x, point.y, point.z, this.scratch.vecA);
		vec3.transformMat4(this.scratch.vecA, this.view, cam);
		return -cam[2];
	}
}

/**
 * Returns a fresh zeroed {@link Projected} to use as an `out` buffer.
 *
 * @category Camera
 */
export function createProjected(): Projected {
	return { x: 0, y: 0, depth: 0 };
}
