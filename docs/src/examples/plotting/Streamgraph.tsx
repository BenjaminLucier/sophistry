import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, StackPlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Streamgraph",
	description:
		'StackPlot with offset="wiggle" and order="insideOut": the layers float around a centre line chosen to keep them as level as possible, and the whole stream grows out of it. The week axis sits at the bottom edge (xAxis position) rather than through the stream, and series names the bands for the legend.',
};

// Five smooth bumps peaking at different weeks.
const bump = (week: number, peak: number, width: number, height: number) =>
	height * Math.exp(-(((week - peak) / width) ** 2)) + 0.3;
const genres = ["jazz", "folk", "rock", "soul", "funk"] as const;
const rows = Array.from({ length: 41 }, (_, week) => ({
	week,
	jazz: bump(week, 8, 6, 4),
	folk: bump(week, 16, 7, 3),
	rock: bump(week, 22, 5, 5),
	soul: bump(week, 28, 8, 3),
	funk: bump(week, 34, 5, 4),
}));

export default function Streamgraph() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				// The legend's room comes out of width (autosize="fit").
				width={10.5}
				height={4.5}
				// A stream floats around zero, mid-chart: draw the week axis
				// along the bottom edge instead of through the stream. Its
				// y values are offsets, not quantities, so that axis is hidden.
				xAxis={{ position: "bottom" }}
				yAxis={{ visible: false }}
				xLabel="week"
				grid="x"
				progress={shown}
			>
				<StackPlot
					data={rows}
					x="week"
					y={genres}
					series={genres}
					offset="wiggle"
					order="insideOut"
				/>
			</Chart>
		</Stage>
	);
}
