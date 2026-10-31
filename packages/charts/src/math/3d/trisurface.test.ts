import { describe, expect, it } from "vitest";
import { trisurfaceFaces } from "./trisurface";

describe("trisurfaceFaces", () => {
	it("returns [] for degenerate input", () => {
		expect(trisurfaceFaces([0, 1], [0, 1], [0, 1])).toEqual([]);
	});

	it("carries each triangle's matching z through to its 3 world points", () => {
		const xs = [0, 1, 0, 1, 0.5];
		const ys = [0, 0, 1, 1, 0.5];
		const zs = [1, 2, 3, 4, 5];
		const faces = trisurfaceFaces(xs, ys, zs);
		expect(faces.length).toBeGreaterThan(0);
		for (const face of faces) {
			expect(face.points).toHaveLength(3);
			for (const p of face.points) {
				const i = xs.findIndex(
					(x, idx) => x === p.x && ys[idx] === p.y && zs[idx] === p.z,
				);
				expect(i).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
