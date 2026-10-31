import { describe, expect, it } from "vitest";
import { voxelFaces } from "./voxels";

describe("voxelFaces", () => {
	it("returns [] for an empty grid", () => {
		expect(voxelFaces([])).toEqual([]);
	});

	it("emits exactly 6 faces for a single filled voxel", () => {
		const filled = [[[true]]];
		expect(voxelFaces(filled)).toHaveLength(6);
	});

	it("emits 10, not 12, faces for two adjacent filled voxels sharing one face", () => {
		const filled: boolean[][][] = [];
		filled[0] = [[]];
		filled[0][0][0] = true;
		filled[1] = [[]];
		filled[1][0][0] = true;
		expect(voxelFaces(filled)).toHaveLength(10);
	});

	it("every face is a quad", () => {
		const filled = [[[true]]];
		for (const face of voxelFaces(filled)) expect(face.points).toHaveLength(4);
	});

	it("treats ragged/undefined entries as not filled", () => {
		const filled: boolean[][][] = [];
		filled[0] = [];
		filled[0][1] = [];
		filled[0][1][1] = true;
		expect(voxelFaces(filled)).toHaveLength(6);
	});
});
