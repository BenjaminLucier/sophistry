import { track } from "@sophistry/core";
import { Stage } from "@sophistry/solidjs";
import {
	Axes3D,
	Camera3D,
	SurfacePlot3D,
	useOrbitControls3D,
} from "@sophistry/solidjs/3d";

export const meta = {
	title: "Surface plot",
	description:
		"A rippling surface y = f(x, z) sampled from a function of two parameters; drag to orbit around it.",
};

function Ripple() {
	const eye = track({ x: 5, y: 4, z: 7 });
	useOrbitControls3D({ eye });

	return (
		<Camera3D eye={eye}>
			<Axes3D length={3} />
			<SurfacePlot3D
				resolution={32}
				function={(u, v) => {
					const x = (u - 0.5) * 5;
					const z = (v - 0.5) * 5;
					return { x, y: Math.cos(1.6 * Math.hypot(x, z)) * 0.8, z };
				}}
			/>
		</Camera3D>
	);
}

export default function SurfacePlot3DExample() {
	return (
		<Stage units={10}>
			<Ripple />
		</Stage>
	);
}
