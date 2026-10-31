import { draw, track } from "@sophistry/core";
import { Axes, Stage, usePlayer } from "@sophistry/solidjs";
import { ErrorBar, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Scatter with error bars",
	description:
		"Measurements as points with a symmetric error bar on each: every point fades in where it stands and its bar grows out of it, left to right.",
	uses: ["Stage", "Axes", "Scatter", "ErrorBar", "track", "draw", "usePlayer"],
};

const measurements = [
	{ x: 1, y: 2.1, err: 0.5 },
	{ x: 2, y: 3.4, err: 0.8 },
	{ x: 3, y: 3.9, err: 0.4 },
	{ x: 4, y: 5.2, err: 0.9 },
	{ x: 5, y: 5.6, err: 0.6 },
	{ x: 6, y: 7.1, err: 0.7 },
];

export default function ScatterWithErrorBars() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2 }));
	});

	return (
		<Stage units={12}>
			<Axes xRange={[0, 7, 1]} yRange={[0, 10, 2]} width={9} height={5}>
				<ErrorBar
					data={measurements}
					x="x"
					y="y"
					yError="err"
					progress={progress}
					stagger={0.5}
				/>
				<Scatter
					data={measurements}
					x="x"
					y="y"
					radius={0.12}
					progress={progress}
					stagger={0.5}
				/>
			</Axes>
		</Stage>
	);
}
