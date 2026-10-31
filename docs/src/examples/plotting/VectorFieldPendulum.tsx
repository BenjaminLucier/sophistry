import { draw, track } from "@sophistry/core";
import { Axes, Stage, usePlayer, VectorField } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Vector field",
	description:
		"The phase portrait of a pendulum as arrows colored by their length.",
	uses: ["Stage", "Axes", "VectorField", "track", "draw", "usePlayer"],
};

export default function VectorFieldPendulum() {
	const { play } = usePlayer();
	const drawn = track(0);

	onSettled(() => {
		void play(draw(drawn, { duration: 2 }));
	});

	return (
		<Stage units={14}>
			<Axes
				xRange={[-5, 5, 1]}
				yRange={[-3, 3, 1]}
				width={11}
				height={6}
				xLabel="angle"
				yLabel="speed"
			>
				<VectorField
					function={({ x, y }) => ({ x: y, y: -Math.sin(x) })}
					progress={drawn}
				/>
			</Axes>
		</Stage>
	);
}
