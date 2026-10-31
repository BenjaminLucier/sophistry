import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, LinePlot, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "A chart that fits itself",
	description:
		"<Chart> ranges its axes from the layers inside it, then draws the frame before the data.",
	uses: ["Stage", "Chart", "LinePlot", "Scatter", "track", "draw", "usePlayer"],
};

const runs = [
	{ minutes: 12, km: 2.1 },
	{ minutes: 19, km: 3.2 },
	{ minutes: 25, km: 4.4 },
	{ minutes: 33, km: 5.6 },
	{ minutes: 41, km: 7.2 },
];

export default function ChartAutoFit() {
	const { play } = usePlayer();
	const shown = track(0);

	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	// No ranges: the frame fits both axes to the runs, rounded to nice ticks.
	return (
		<Stage units={13}>
			<Chart
				width={9}
				height={4.5}
				center={{ x: -0.3, y: -0.4 }}
				grid
				title="Weekly runs"
				xLabel="min"
				yLabel="km"
				progress={shown}
			>
				<LinePlot data={runs} x="minutes" y="km" />
				<Scatter data={runs} x="minutes" y="km" />
			</Chart>
		</Stage>
	);
}
