import { derive, rotateBy, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Axes3D, Camera3D, Cube3D, Sphere3D } from "@sophistry/solidjs/3d";
import { onSettled } from "solid-js";

export const meta = {
	title: "Camera motion",
	description:
		"The camera eye is derived from an angle track, so a plain rotateBy() loop turns the camera around the scene.",
};

export default function CameraMotion() {
	const { play, signal } = usePlayer();
	const angle = track(0.6);
	const eye = derive(angle, (angle) => ({
		x: 9 * Math.cos(angle),
		y: 4,
		z: 9 * Math.sin(angle),
	}));

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					rotateBy(angle, 2 * Math.PI, { duration: 10, easing: "linear" }),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<Camera3D eye={eye}>
				<Axes3D length={3} />
				<Cube3D center={{ x: -1.5, y: 0.5, z: 0 }} size={1} />
				<Sphere3D center={{ x: 1.5, y: 0.7, z: 0 }} radius={0.8} />
			</Camera3D>
		</Stage>
	);
}
