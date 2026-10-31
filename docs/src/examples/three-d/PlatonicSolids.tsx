import { derive, track } from "@sophistry/core";
import { Stage, useScene } from "@sophistry/solidjs";
import {
	Camera3D,
	Cube3D,
	Dodecahedron3D,
	Icosahedron3D,
	Octahedron3D,
	Tetrahedron3D,
	useOrbitControls3D,
} from "@sophistry/solidjs/3d";

export const meta = {
	title: "The platonic solids",
	description:
		"All five regular solids side by side, outlined so their faces read. Drag to orbit.",
	uses: [
		"Stage",
		"track",
		"derive",
		"useScene",
		"Camera3D",
		"useOrbitControls3D",
		"Tetrahedron3D",
		"Cube3D",
		"Octahedron3D",
		"Icosahedron3D",
		"Dodecahedron3D",
	],
};

const at = (x: number) => ({ x, y: 0, z: 0 });

function Solids() {
	const eye = track({ x: 2, y: 4, z: 10 });
	useOrbitControls3D({ eye });
	// Derived from the scene's theme, so the colours follow it.
	const theme = useScene().theme;
	const color = (i: number) => derive(theme, (t) => t.palette.series[i]);
	const edges = {
		stroke: derive(theme, (t) => t.palette.foreground),
		strokeWidth: 0.015,
	};
	return (
		<Camera3D eye={eye}>
			<Tetrahedron3D
				center={at(-5)}
				edgeLength={2}
				fill={color(0)}
				{...edges}
			/>
			<Cube3D center={at(-2.6)} size={1.6} fill={color(1)} {...edges} />
			<Octahedron3D
				center={at(0)}
				edgeLength={1.6}
				fill={color(2)}
				{...edges}
			/>
			<Icosahedron3D
				center={at(2.6)}
				edgeLength={1.2}
				fill={color(3)}
				{...edges}
			/>
			<Dodecahedron3D
				center={at(5.3)}
				edgeLength={0.8}
				fill={color(4)}
				{...edges}
			/>
		</Camera3D>
	);
}

export default function PlatonicSolids() {
	return (
		<Stage units={12}>
			<Solids />
		</Stage>
	);
}
