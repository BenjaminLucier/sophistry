import { track } from "@sophistry/core";
import { Stage } from "@sophistry/solidjs";
import { Axes3D, Camera3D, useOrbitControls3D } from "@sophistry/solidjs/3d";
import { BarChart3D } from "@sophistry/solidjs/charts/3d";

export const meta = {
	title: "3D bar chart",
	description:
		"A 3 by 3 grid of bars whose heights come from one array; each box is anchored at its corner and rises along y.",
};

const HEIGHTS = [1, 2, 1.5, 2.5, 3, 2, 1, 1.8, 0.8];
const TARGET = { x: 1.5, y: 1, z: 1.5 };

function Bars() {
	const eye = track({ x: 6, y: 5, z: 8 });
	// Orbit around the camera's target, the middle of the grid.
	useOrbitControls3D({ eye, target: TARGET });

	return (
		<Camera3D eye={eye} target={TARGET}>
			<Axes3D length={4} />
			<BarChart3D
				data={HEIGHTS}
				x={(_, i) => (i % 3) * 1.3}
				y={0}
				z={(_, i) => Math.floor(i / 3) * 1.3}
				height={(height) => height}
			/>
		</Camera3D>
	);
}

export default function BarChart3DExample() {
	return (
		<Stage units={10}>
			<Bars />
		</Stage>
	);
}
