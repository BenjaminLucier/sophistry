import { track } from "@sophistry/core";
import { Stage } from "@sophistry/solidjs";
import {
	Axes3D,
	Camera3D,
	Cube3D,
	Sphere3D,
	useOrbitControls3D,
} from "@sophistry/solidjs/3d";

export const meta = {
	title: "Orbit a 3D scene",
	description:
		"Drag to orbit a cube and a sphere; the camera eye is a plain track.",
};

function Scene() {
	const eye = track({ x: 6, y: 4, z: 8 });
	// Dragging empty space writes `eye`; the camera is bound to it.
	useOrbitControls3D({ eye });

	return (
		<Camera3D eye={eye}>
			<Axes3D length={3} />
			<Cube3D center={{ x: -1.5, y: 0.5, z: 0 }} size={1} />
			<Sphere3D center={{ x: 1.5, y: 0.7, z: 0 }} radius={0.8} />
		</Camera3D>
	);
}

export default function OrbitScene() {
	return (
		<Stage units={10}>
			<Scene />
		</Stage>
	);
}
