import { describe, expect, it } from "vitest";
import { surfaceGridFaces, surfaceGridWireframe } from "./surfaceGrid3d.js";

function grid(
	nrows: number,
	ncols: number,
	z: (r: number, c: number) => number,
) {
	const X: number[][] = [];
	const Y: number[][] = [];
	const Z: number[][] = [];
	for (let r = 0; r < nrows; r++) {
		const xs: number[] = [];
		const ys: number[] = [];
		const zs: number[] = [];
		for (let c = 0; c < ncols; c++) {
			xs.push(c);
			ys.push(r);
			zs.push(z(r, c));
		}
		X.push(xs);
		Y.push(ys);
		Z.push(zs);
	}
	return { X, Y, Z };
}

describe("surfaceGridFaces", () => {
	it("emits (nrows - 1) * (ncols - 1) quads for a flat grid", () => {
		const { X, Y, Z } = grid(3, 4, () => 0);
		expect(surfaceGridFaces(X, Y, Z)).toHaveLength(2 * 3);
	});

	it("winds each quad in the reversed [p0, p3, p2, p1] order", () => {
		const { X, Y, Z } = grid(2, 2, () => 0);
		const faces = surfaceGridFaces(X, Y, Z);
		expect(faces).toHaveLength(1);
		expect(faces[0].points).toEqual([
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
			{ x: 1, y: 1, z: 0 },
			{ x: 1, y: 0, z: 0 },
		]);
	});

	it("throws when X/Y/Z row counts disagree", () => {
		const { X, Z } = grid(3, 4, () => 0);
		const Y = grid(2, 4, () => 0).Y;
		expect(() => surfaceGridFaces(X, Y, Z)).toThrow();
	});

	it("throws when a row's length disagrees across X/Y/Z", () => {
		const { X, Y, Z } = grid(2, 3, () => 0);
		X[1] = [0, 1];
		expect(() => surfaceGridFaces(X, Y, Z)).toThrow();
	});

	it("returns no faces for an empty grid", () => {
		expect(surfaceGridFaces([], [], [])).toEqual([]);
	});
});

describe("surfaceGridWireframe", () => {
	it("returns nrows + ncols polylines", () => {
		const { X, Y, Z } = grid(3, 4, () => 0);
		expect(surfaceGridWireframe(X, Y, Z)).toHaveLength(3 + 4);
	});

	it("each row polyline walks that row's columns in order", () => {
		const { X, Y, Z } = grid(2, 3, (r, c) => r + c);
		const lines = surfaceGridWireframe(X, Y, Z);
		expect(lines[0]).toEqual([
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 1 },
			{ x: 2, y: 0, z: 2 },
		]);
	});

	it("each column polyline walks that column's rows in order", () => {
		const { X, Y, Z } = grid(3, 2, (r, c) => r + c);
		const lines = surfaceGridWireframe(X, Y, Z);
		// rows come first (3 of them), then columns
		expect(lines[3]).toEqual([
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: 1, z: 1 },
			{ x: 0, y: 2, z: 2 },
		]);
	});
});
