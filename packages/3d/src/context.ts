/**
 * The active 3D camera, handed down through the scene graph's context the way
 * a theme is: `camera3D` provides one {@link Camera3DValue} (a stable object)
 * to its subtree, and every 3D primitive under it reads it, subscribes to it
 * and projects through it.
 *
 * There is deliberately no fallback camera: a 3D shape with no `camera3D`
 * above it has nothing to project through, so it throws on its first refresh.
 * This is also the whole of the "free when unused" story: no `Projection` is
 * ever constructed for a scene without a `camera3D`.
 */

import { type ContextKey, createContextKey } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import type { Projection } from "@sophistry/core/internal";
import type { DepthSorter } from "./depth-sort.js";

/**
 * What `camera3D` publishes to the shapes under it. Read it with
 * `node.context(camera3DContext)` (or {@link requireCamera3D}); the helpers
 * `projectPoint`, `clipSegment` and `projectScale` take one as their first
 * argument.
 *
 * @category Camera
 */
export interface Camera3DValue {
	/**
	 * Where the camera's target projects to, in scene units: every 3D shape
	 * adds its own projected offset to this, exactly as a 2D shape adds `x`/`y`
	 * to its geometry.
	 */
	origin(): Point;
	/**
	 * The shared, zero-alloc `Projection`, synced to the camera's current
	 * eye/target/up/fov. Brings the camera node up to date first, so a shape
	 * refreshed before its camera in a commit still projects through this
	 * frame's camera.
	 */
	ensure(): Projection;
	/**
	 * Calls `onChange` whenever the projection or the origin changed (after
	 * the camera's refresh). It must only mark (invalidate), never compute.
	 *
	 * @returns Unsubscribe.
	 */
	subscribe(onChange: () => void): () => void;
	/**
	 * The camera's depth sort: every mesh face, sphere, curve, vector and grid
	 * under the camera registers its pieces here and gets back a paint-order
	 * `zIndex` that interleaves it correctly with every other primitive's (see
	 * `sortByDepth`). Optional so a hand-built value (a test) can leave it
	 * out; the primitives then fall back to `depthZ` of their own centroid.
	 */
	depthOrder?: DepthSorter;
}

/**
 * The context key `camera3D` provides its {@link Camera3DValue} under.
 * Provide a hand-built value on any container to project through a custom
 * camera (a test, an offscreen view).
 *
 * @category Camera
 */
export const camera3DContext: ContextKey<Camera3DValue | undefined> =
	createContextKey<Camera3DValue>("camera3D");

/**
 * The camera a 3D node projects through: the nearest provided
 * {@link camera3DContext}.
 *
 * @param node - Anything with a `context` lookup (a scene node).
 * @returns The active camera value.
 * @throws If no `camera3D` is above the node.
 *
 * @category Camera
 */
export function requireCamera3D(node: {
	readonly type: string;
	context<T>(key: ContextKey<T>): T;
}): Camera3DValue {
	const camera = node.context(camera3DContext);
	if (!camera) {
		throw new Error(`${node.type} must be inside a camera3D.`);
	}
	return camera;
}
