/**
 * Zero-allocation 3D math primitives, built on `wgpu-matrix`.
 *
 * This module owns no state and knows nothing about scenes or any UI framework — it is
 * the `geometry/` layer's 3D counterpart, and follows the same rule: pure
 * functions over plain typed arrays, nothing else in the framework required.
 * Callers own their buffers; every function here writes into a caller-supplied
 * `dst` rather than allocating, so a render loop that reuses its scratch state
 * across frames never allocates either.
 */

import { mat4, vec3 } from "wgpu-matrix";

/**
 * A 3-component `wgpu-matrix` vector (a `Float32Array`).
 *
 * @category Math & helpers
 */
export type Vec3 = Float32Array;
/**
 * A column-major 4x4 `wgpu-matrix` matrix (a `Float32Array` of 16).
 *
 * @category Math & helpers
 */
export type Mat4 = Float32Array;

/**
 * A plain `{x,y,z}` — the 3D counterpart of `geometry/path/types.ts`'s `Point`.
 *
 * @category Math & helpers
 */
export interface Point3 {
	/** World-space x (right). */
	x: number;
	/** World-space y (up). */
	y: number;
	/** World-space z (toward the viewer for the default camera). */
	z: number;
}

/**
 * Allocates a {@link Vec3} initialised to `(x, y, z)`; defaults to the zero vector.
 *
 * @category Math & helpers
 */
export function createVec3(x = 0, y = 0, z = 0): Vec3 {
	return vec3.create(x, y, z);
}

/**
 * Allocates a {@link Mat4} initialised to the identity matrix.
 *
 * @category Math & helpers
 */
export function createMat4(): Mat4 {
	return mat4.identity();
}

/**
 * A reusable block of scratch vectors/matrices for one call site's inner loop.
 *
 * `wgpu-matrix` functions all accept a `dst` and none allocate when given one,
 * so the only allocations left in a 3D projection loop are the ones a call
 * site introduces itself by not reusing a buffer. One `Scratch` per component
 * instance (not per frame, not per point) is the intended lifetime.
 *
 * @category Math & helpers
 */
export interface Scratch {
	vecA: Vec3;
	vecB: Vec3;
	vecC: Vec3;
	matA: Mat4;
	matB: Mat4;
}

/**
 * Allocates a fresh {@link Scratch} block (zero vectors, identity matrices).
 *
 * @category Math & helpers
 */
export function createScratch(): Scratch {
	return {
		vecA: createVec3(),
		vecB: createVec3(),
		vecC: createVec3(),
		matA: createMat4(),
		matB: createMat4(),
	};
}

export { mat4, vec3 };
