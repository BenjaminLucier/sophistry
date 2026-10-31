import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, StackPlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Stacked areas",
	description:
		"Wide-format rows (one object per x) become stacked bands: y takes one channel per band, mixing keys and functions, and series names them, so the bands take the chart's colours and legend.",
	uses: ["Stage", "Chart", "StackPlot", "track", "draw", "usePlayer"],
};

const rows = Array.from({ length: 13 }, (_, month) => ({
	month,
	web: 3 + Math.sin(month / 2) * 1.2,
	mobile: 2 + month * 0.25,
	api: 1.5 + Math.cos(month / 3) * 0.6,
}));

export default function StackedAreas() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2 }));
	});

	return (
		<Stage units={12}>
			<Chart
				xRange={[0, 12, 2]}
				yRange={[0, 10, 2]}
				width={9}
				height={4.6}
				// The top legend sits above height: leave it room.
				center={{ x: 0, y: -0.3 }}
				xLabel="month"
				legend="top"
				progress={progress}
			>
				<StackPlot
					data={rows}
					x="month"
					y={["web", "mobile", (row) => row.api]}
					series={["web", "mobile", "api"]}
				/>
			</Chart>
		</Stage>
	);
}
