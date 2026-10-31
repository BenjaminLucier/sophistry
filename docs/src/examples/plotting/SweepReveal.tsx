import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import {
	Chart,
	FillBetween,
	LinePlot,
	Scatter,
} from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "One reveal front",
	description:
		'reveal="x" sweeps a single clip edge across the plot, so the band, the line and its markers enter together, at a constant rate along x.',
	uses: [
		"Stage",
		"Chart",
		"FillBetween",
		"LinePlot",
		"Scatter",
		"track",
		"draw",
		"usePlayer",
	],
};

const runs = [3.1, 4.2, 3.8, 5.6, 6.1, 5.4, 7.2, 7.9, 7.1, 8.6].map((y, x) => ({
	x,
	y,
	lo: y - 0.8,
	hi: y + 0.8,
}));

export default function SweepReveal() {
	const { play } = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void play(draw(progress, { duration: 3 }));
	});

	return (
		<Stage units={12}>
			<Chart width={9} height={4.5} grid="y" reveal="x" progress={progress}>
				<FillBetween data={runs} x="x" y1="lo" y2="hi" />
				<LinePlot data={runs} x="x" y="y" />
				<Scatter data={runs} x="x" y="y" radius={0.07} />
			</Chart>
		</Stage>
	);
}
