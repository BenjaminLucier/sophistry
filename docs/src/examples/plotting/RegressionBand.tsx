import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Regression, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Regression with a confidence band",
	description:
		"One least-squares fit per series, each with the 95% band of its mean, narrowest at the centre of its data. The series channel splits the fits and colours fits and points alike, keyed by one legend; every line and band sweeps in along x behind one front.",
};

const students = Array.from({ length: 24 }, (_, i) => {
	const online = i >= 12;
	const hours = 1 + (i % 12) * 0.7 + (online ? 0.3 : 0);
	const noise = Math.sin((i + 1) * 12.9898) * 5;
	return online
		? { course: "online", hours, score: 40 + hours * 5.5 + noise }
		: { course: "lecture", hours, score: 52 + hours * 3.5 + noise };
});

export default function RegressionBand() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={8}
				height={4.2}
				// The top legend and the y title sit above height: leave them room.
				center={{ x: 0, y: -0.4 }}
				xLabel="hours"
				yLabel="score"
				grid="y"
				legend="top"
				progress={shown}
			>
				<Regression data={students} x="hours" y="score" series="course" />
				<Scatter
					data={students}
					x="hours"
					y="score"
					series="course"
					stagger={0.5}
				/>
			</Chart>
		</Stage>
	);
}
