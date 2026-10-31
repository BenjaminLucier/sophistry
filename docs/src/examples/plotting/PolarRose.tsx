import { draw, track } from "@sophistry/core";
import {
	Label,
	ParametricGraph,
	PolarPlane,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Polar rose",
	description:
		"Trace the curve r = 3 cos 5θ on a polar grid by sweeping θ from 0 to π.",
	uses: [
		"Stage",
		"PolarPlane",
		"ParametricGraph",
		"Label",
		"track",
		"draw",
		"usePlayer",
	],
};

const rose = (theta: number) => {
	const r = 3 * Math.cos(5 * theta);
	return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
};

export default function PolarRose() {
	const { play } = usePlayer();
	const drawn = track(0);

	onSettled(() => {
		void play(draw(drawn, { duration: 4 }));
	});

	return (
		<Stage units={14}>
			<PolarPlane size={6} maxRadius={3} radiusStep={1}>
				<ParametricGraph
					function={rose}
					from={0}
					to={Math.PI}
					progress={drawn}
				/>
			</PolarPlane>
			<Label text="r = 3 cos 5θ" x={5} y={0} />
		</Stage>
	);
}
