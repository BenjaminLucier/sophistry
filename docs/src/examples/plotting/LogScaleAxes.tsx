import { draw, sequence, track } from "@sophistry/core";
import { Axes, FunctionGraph, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Log-scale axes",
	description:
		"A log y axis turns exponential growth into a straight line, with ticks on each decade. The graph plots through the same scale as the axis.",
	uses: [
		"Stage",
		"Axes",
		"FunctionGraph",
		"track",
		"draw",
		"sequence",
		"usePlayer",
	],
};

export default function LogScaleAxes() {
	const { play } = usePlayer();
	const axes = track(0);
	const graphs = track(0);

	// The axes first, then the curves over them.
	onSettled(() => {
		void play(
			sequence(draw(axes, { duration: 1 }), draw(graphs, { duration: 1.2 })),
		);
	});

	return (
		<Stage units={12}>
			<Axes
				xRange={[0, 6, 1]}
				yRange={[1, 10000]}
				width={8}
				height={5}
				yAxis={{ scale: "log" }}
				xLabel="t"
				yLabel="N"
				progress={axes}
			>
				<FunctionGraph function={(t) => 10 ** (0.65 * t)} progress={graphs} />
				<FunctionGraph
					function={(t) => 10 ** (0.4 * t + 1)}
					progress={graphs}
				/>
			</Axes>
		</Stage>
	);
}
