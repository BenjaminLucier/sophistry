import { describe, expect, it } from "vitest";
import type { Camera3DState } from "./camera";
import { createProjected, Projection } from "./camera";

const straightOn: Camera3DState = {
	eye: { x: 0, y: 0, z: 5 },
	target: { x: 0, y: 0, z: 0 },
	up: { x: 0, y: 1, z: 0 },
	fovY: Math.PI / 2,
};

describe("Projection.project", () => {
	it("returns null before update() has been called", () => {
		const projection = new Projection();
		const out = createProjected();
		expect(projection.project({ x: 0, y: 0, z: 0 }, out)).toBeNull();
	});

	it("the target point projects to the origin (on the optical axis)", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const out = createProjected();
		const result = projection.project({ x: 0, y: 0, z: 0 }, out);
		expect(result).not.toBeNull();
		expect(result?.x).toBeCloseTo(0, 6);
		expect(result?.y).toBeCloseTo(0, 6);
		expect(result?.depth).toBeCloseTo(5, 6);
	});

	it("returns null for a point behind the eye", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const out = createProjected();
		// Same side as the eye, well behind it along the view direction.
		expect(projection.project({ x: 0, y: 0, z: 10 }, out)).toBeNull();
	});

	it("is idempotent: repeated calls with the same inputs give the same output", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const a = createProjected();
		const b = createProjected();
		projection.project({ x: 1, y: 2, z: 0 }, a);
		projection.project({ x: 1, y: 2, z: 0 }, b);
		expect(a).toEqual(b);
	});

	it("update() again with the same state reproduces the same projection", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const before = createProjected();
		projection.project({ x: 2, y: -1, z: 0 }, before);

		projection.update(straightOn, 10);
		const after = createProjected();
		projection.project({ x: 2, y: -1, z: 0 }, after);

		expect(after).toEqual(before);
	});

	it("a point farther off-axis produces a larger magnitude on screen", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const near = createProjected();
		const far = createProjected();
		projection.project({ x: 1, y: 0, z: 0 }, near);
		projection.project({ x: 2, y: 0, z: 0 }, far);
		expect(Math.abs(far?.x)).toBeGreaterThan(Math.abs(near?.x));
	});

	it("a degenerate fovY (0) doesn't produce a non-finite focal length", () => {
		const projection = new Projection();
		projection.update({ ...straightOn, fovY: 0 }, 10);
		const out = createProjected();
		const result = projection.project({ x: 0, y: 0, z: 0 }, out);
		expect(result).not.toBeNull();
		expect(Number.isFinite(result?.x)).toBe(true);
		expect(Number.isFinite(result?.y)).toBe(true);
	});
});

describe("Projection.scaleAt", () => {
	it("returns 0 for a non-positive depth", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		expect(projection.scaleAt(1, 0)).toBe(0);
		expect(projection.scaleAt(1, -5)).toBe(0);
	});

	it("scales inversely with depth", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const near = projection.scaleAt(1, 2);
		const far = projection.scaleAt(1, 10);
		expect(near).toBeGreaterThan(far);
	});

	it("scales linearly with world length", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const one = projection.scaleAt(1, 5);
		const two = projection.scaleAt(2, 5);
		expect(two).toBeCloseTo(one * 2, 9);
	});
});

describe("Projection.depthOf", () => {
	it("matches project()'s depth for a visible point", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const out = createProjected();
		projection.project({ x: 3, y: 1, z: 0 }, out);
		expect(projection.depthOf({ x: 3, y: 1, z: 0 })).toBeCloseTo(out.depth, 9);
	});

	it("is an affine (linear + offset) function of world position", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		const p0 = { x: 0, y: 0, z: 0 };
		const p1 = { x: 4, y: 4, z: 4 };
		const mid = { x: 2, y: 2, z: 2 };
		const d0 = projection.depthOf(p0);
		const d1 = projection.depthOf(p1);
		const dMid = projection.depthOf(mid);
		expect(dMid).toBeCloseTo((d0 + d1) / 2, 6);
	});

	it("reports a non-positive value for a point behind the eye, where project() returns null", () => {
		const projection = new Projection();
		projection.update(straightOn, 10);
		expect(projection.depthOf({ x: 0, y: 0, z: 10 })).toBeLessThan(0);
	});
});

describe("Projection.update degenerate states", () => {
	const out = createProjected();

	it("eye == target projects nothing", () => {
		const projection = new Projection();
		projection.update(
			{
				...straightOn,
				eye: { x: 1, y: 1, z: 1 },
				target: { x: 1, y: 1, z: 1 },
			},
			10,
		);
		expect(projection.project({ x: 0, y: 0, z: 0 }, out)).toBeNull();
	});

	it("an up vector parallel to the view direction still gives a finite projection", () => {
		const projection = new Projection();
		projection.update(
			{
				eye: { x: 0, y: 5, z: 0 },
				target: { x: 0, y: 0, z: 0 },
				up: { x: 0, y: 1, z: 0 },
				fovY: Math.PI / 2,
			},
			10,
		);
		const result = projection.project({ x: 1, y: 0, z: 0 }, out);
		expect(result).not.toBeNull();
		expect(Number.isFinite(result?.x)).toBe(true);
		expect(Number.isFinite(result?.y)).toBe(true);
		expect(result?.depth).toBeCloseTo(5, 5);
	});

	it("a zero up vector falls back instead of collapsing", () => {
		const projection = new Projection();
		projection.update({ ...straightOn, up: { x: 0, y: 0, z: 0 } }, 10);
		const result = projection.project({ x: 1, y: 0, z: 0 }, out);
		expect(result?.x).toBeCloseTo(1 * (5 / 5), 5);
	});

	it("clamps fovY below pi", () => {
		const projection = new Projection();
		projection.update({ ...straightOn, fovY: Math.PI * 2 }, 10);
		const result = projection.project({ x: 1, y: 0, z: 0 }, out);
		expect(result).not.toBeNull();
		expect(Number.isFinite(result?.x)).toBe(true);
		expect(result?.x ?? 0).toBeGreaterThan(0);
	});
});
