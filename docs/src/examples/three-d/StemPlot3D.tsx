import { track } from "@sophistry/core";
import { Stage } from "@sophistry/solidjs";
import { Axes3D, Camera3D, useOrbitControls3D } from "@sophistry/solidjs/3d";
import { Stem3D } from "@sophistry/solidjs/charts/3d";

export const meta = {
	title: "3D stem plot",
	description:
		"Points on a circle with drop lines falling along y to the floor, each stem as tall as its y value.",
	uses: [
		"Stage",
		"track",
		"Camera3D",
		"useOrbitControls3D",
		"Axes3D",
		"Stem3D",
	],
};

const ANGLES = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8);

function Stems() {
	const eye = track({ x: 5, y: 4, z: 7 });
	useOrbitControls3D({ eye });

	return (
		<Camera3D eye={eye}>
			<Axes3D length={3} />
			<Stem3D
				data={ANGLES}
				x={(a) => 2 * Math.cos(a)}
				y={(a) => 1.5 + Math.sin(2 * a)}
				z={(a) => 2 * Math.sin(a)}
				markerRadius={0.1}
			/>
		</Camera3D>
	);
}

export default function StemPlot3D() {
	return (
		<Stage units={10}>
			<Stems />
		</Stage>
	);
}
