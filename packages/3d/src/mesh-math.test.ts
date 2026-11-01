import { describe, expect, it } from "vitest";
import { isFrontFacing } from "./mesh-math.js";

describe("isFrontFacing", () => {
	it("is front-facing when the normal points toward the eye", () => {
		// Face at the origin with an outward normal along +x; eye is further
		// out along +x, so the face's outward side faces the camera.
		const normal = { x: 1, y: 0, z: 0 };
		const point = { x: 0, y: 0, z: 0 };
		const eye = { x: 5, y: 0, z: 0 };
		expect(isFrontFacing(normal, eye, point)).toBe(true);
	});

	it("is not front-facing when the normal points away from the eye", () => {
		// Same face, but the normal points away from the camera (a back face).
		const normal = { x: -1, y: 0, z: 0 };
		const point = { x: 0, y: 0, z: 0 };
		const eye = { x: 5, y: 0, z: 0 };
		expect(isFrontFacing(normal, eye, point)).toBe(false);
	});

	it("is not front-facing when the normal is exactly edge-on to the eye", () => {
		// Normal perpendicular to the eye direction: dot ≈ 0, and `> 0` (not
		// `>= 0`) means a grazing face culls rather than z-fights.
		const normal = { x: 0, y: 1, z: 0 };
		const point = { x: 0, y: 0, z: 0 };
		const eye = { x: 5, y: 0, z: 0 };
		expect(isFrontFacing(normal, eye, point)).toBe(false);
	});
});
