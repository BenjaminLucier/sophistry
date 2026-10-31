import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import {
	Axes3D,
	Camera3D,
	Curve3D,
	useOrbitControls3D,
} from "@sophistry/solidjs/3d";
import { onSettled } from "solid-js";

export const meta = {
	title: "Helix curve",
	description:
		"A parametric 3D curve drawn in by draw(); drag to orbit around the helix.",
	uses: [
		"Stage",
		"track",
		"draw",
		"usePlayer",
		"Camera3D",
		"useOrbitControls3D",
		"Axes3D",
		"Curve3D",
	],
};

function Helix() {
	const { play } = usePlayer();
	const eye = track({ x: 6, y: 3, z: 7 });
	const drawn = track(0);
	useOrbitControls3D({ eye });

	onSettled(() => {
		void play(draw(drawn, { duration: 3 }));
	});

	return (
		<Camera3D eye={eye}>
			<Axes3D length={3} />
			<Curve3D
				samples={200}
				progress={drawn}
				function={(t) => ({
					x: 1.5 * Math.cos(t * 6 * Math.PI),
					y: t * 4 - 2,
					z: 1.5 * Math.sin(t * 6 * Math.PI),
				})}
			/>
		</Camera3D>
	);
}

export default function HelixCurve() {
	return (
		<Stage units={10}>
			<Helix />
		</Stage>
	);
}
