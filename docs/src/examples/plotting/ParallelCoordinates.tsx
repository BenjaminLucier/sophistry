import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { ParallelCoordinates } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Parallel coordinates",
	description:
		"Four car measurements side by side: each car is a line across the axes, drawn left to right once the axes are in.",
	uses: ["Stage", "ParallelCoordinates", "track", "draw", "usePlayer"],
};

const cars = [
	{ mpg: 18, hp: 150, kg: 1590, s: 11.5 },
	{ mpg: 15, hp: 198, kg: 1950, s: 10.0 },
	{ mpg: 24, hp: 95, kg: 1160, s: 15.0 },
	{ mpg: 27, hp: 88, kg: 1020, s: 14.5 },
	{ mpg: 31, hp: 67, kg: 900, s: 19.0 },
	{ mpg: 36, hp: 58, kg: 800, s: 18.5 },
	{ mpg: 21, hp: 110, kg: 1300, s: 14.0 },
	{ mpg: 13, hp: 215, kg: 2100, s: 9.5 },
];

export default function ParallelCoordinatesExample() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={10}>
			<ParallelCoordinates
				data={cars}
				axes={[
					{ value: "mpg", label: "mpg" },
					{ value: "hp", label: "horsepower" },
					{ value: "kg", label: "weight (kg)" },
					{ value: "s", label: "0–60 (s)" },
				]}
				color={(d) => (d.mpg >= 25 ? "#3fb68b" : "#e07a5f")}
				width={7}
				height={3.6}
				center={{ x: 0.3, y: -0.3 }}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
