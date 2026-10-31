import { describe, expect, it } from "vitest";
import { createMat4, createScratch, createVec3, mat4, vec3 } from "./mat";

describe("createVec3 / createMat4", () => {
	it("createVec3 defaults to the zero vector", () => {
		const v = createVec3();
		expect(Array.from(v)).toEqual([0, 0, 0]);
	});

	it("createVec3 accepts explicit components", () => {
		const v = createVec3(1, 2, 3);
		expect(Array.from(v)).toEqual([1, 2, 3]);
	});

	it("createMat4 is the identity matrix", () => {
		const m = createMat4();
		// wgpu-matrix mat4 is column-major 4x4 (16 floats)
		expect(m.length).toBe(16);
		const identityDiagonal = [m[0], m[5], m[10], m[15]];
		expect(identityDiagonal).toEqual([1, 1, 1, 1]);
		// off-diagonals are all zero
		const offDiagonalSum = Array.from(m).reduce((sum, v, i) => {
			const isDiagonal = i === 0 || i === 5 || i === 10 || i === 15;
			return isDiagonal ? sum : sum + Math.abs(v);
		}, 0);
		expect(offDiagonalSum).toBe(0);
	});
});

describe("createScratch", () => {
	it("provides independent buffers, not shared references", () => {
		const scratch = createScratch();
		expect(scratch.vecA).not.toBe(scratch.vecB);
		expect(scratch.vecA).not.toBe(scratch.vecC);
		expect(scratch.matA).not.toBe(scratch.matB);
	});

	it("scratch vectors start at zero, matrices start at identity", () => {
		const scratch = createScratch();
		expect(Array.from(scratch.vecA)).toEqual([0, 0, 0]);
		expect(scratch.matA[0]).toBe(1);
		expect(scratch.matA[5]).toBe(1);
	});
});

describe("caller-owned-buffer contract (writes into dst, no hidden allocation)", () => {
	it("mat4.translation writes into the provided dst and returns that same buffer", () => {
		const dst = createMat4();
		const result = mat4.translation([1, 2, 3], dst);
		expect(result).toBe(dst);
		expect(dst[12]).toBeCloseTo(1, 9);
		expect(dst[13]).toBeCloseTo(2, 9);
		expect(dst[14]).toBeCloseTo(3, 9);
	});

	it("vec3.add writes into dst rather than allocating a new vector", () => {
		const a = createVec3(1, 2, 3);
		const b = createVec3(4, 5, 6);
		const dst = createVec3();
		const result = vec3.add(a, b, dst);
		expect(result).toBe(dst);
		expect(Array.from(dst)).toEqual([5, 7, 9]);
	});

	it("mat4.multiply of two identities into dst yields identity", () => {
		const a = createMat4();
		const b = createMat4();
		const dst = createMat4();
		mat4.multiply(a, b, dst);
		expect(dst[0]).toBeCloseTo(1, 9);
		expect(dst[5]).toBeCloseTo(1, 9);
		expect(dst[10]).toBeCloseTo(1, 9);
		expect(dst[15]).toBeCloseTo(1, 9);
	});

	it("mat4.lookAt followed by vec3.transformMat4 matches a hand-computed camera-space point", () => {
		const eye = createVec3(0, 0, 5);
		const target = createVec3(0, 0, 0);
		const up = createVec3(0, 1, 0);
		const view = createMat4();
		mat4.lookAt(eye, target, up, view);

		const world = createVec3(0, 0, 0);
		const camSpace = createVec3();
		vec3.transformMat4(world, view, camSpace);
		// The target point, transformed into camera space, sits on the -Z axis
		// at the eye-to-target distance (right-handed lookAt).
		expect(camSpace[0]).toBeCloseTo(0, 5);
		expect(camSpace[1]).toBeCloseTo(0, 5);
		expect(camSpace[2]).toBeCloseTo(-5, 5);
	});
});
