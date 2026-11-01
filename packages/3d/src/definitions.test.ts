import { describe, expect, it } from "vitest";
import { definitions } from "./entries/definitions.js";

describe("@sophistry/3d/definitions", () => {
	it("collects every 3D definition by export name", () => {
		expect(Object.keys(definitions)).toEqual([
			"axes3D",
			"camera3D",
			"cone3D",
			"convexHull3D",
			"cube3D",
			"curve3D",
			"cylinder3D",
			"dodecahedron3D",
			"dot3D",
			"grid3D",
			"icosahedron3D",
			"line3D",
			"meshFaces",
			"octahedron3D",
			"polyhedron3D",
			"prism3D",
			"sphere3D",
			"surfacePlot3D",
			"tetrahedron3D",
			"torus3D",
			"vector3D",
		]);
		expect(definitions.camera3D.container).toBe(true);
		expect(definitions.cube3D.name).toBe("Cube3D");
	});
});
