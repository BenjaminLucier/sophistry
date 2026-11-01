import { track } from "@sophistry/core";
import { Stage } from "@sophistry/solidjs";
import { Camera3D, Grid3D, useOrbitControls3D } from "@sophistry/solidjs/3d";
import { SurfaceGrid3D, Wireframe3D } from "@sophistry/solidjs/charts/3d";

export const meta = {
	title: "Surface from coordinate grids",
	description:
		"A saddle z = x^2 - y^2 given as three matrices (xs, ys, zs, like numpy's meshgrid), drawn as shaded quads with a wireframe on top. viewHeight sets how large the scene projects.",
};

const axis = Array.from({ length: 21 }, (_, i) => -2 + i * 0.2);
// Row index runs along z, column index along x; height (world y) is the saddle.
const xs = axis.map(() => axis);
const zs = axis.map((z) => axis.map(() => z));
const ys = zs.map((row, i) =>
	row.map((z, j) => 0.35 * (xs[i][j] ** 2 - z * z)),
);

function Saddle() {
	const eye = track({ x: 6, y: 5, z: 7 });
	useOrbitControls3D({ eye });

	return (
		<Camera3D eye={eye} viewHeight={10}>
			<Grid3D extent={3} offset={-1.5} />
			<SurfaceGrid3D xs={xs} ys={ys} zs={zs} />
			<Wireframe3D xs={xs} ys={ys} zs={zs} stroke="#ffffff" />
		</Camera3D>
	);
}

export default function SurfaceGridWireframe() {
	return (
		<Stage units={10}>
			<Saddle />
		</Stage>
	);
}
