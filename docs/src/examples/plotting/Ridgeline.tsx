import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Density } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Ridgeline",
	description:
		'One Density over long-format rows, with series="month" and row: each month\'s curve stands on its own row of a band y axis and rises into the one above, so the shift in the distribution month by month reads as a landscape. The month axis stands at the left edge, clear of the curves, though the temperatures cross zero, and reveal="x" uncovers every ridge behind one shared front.',
	uses: ["Stage", "Chart", "Density", "track", "draw", "usePlayer"],
};

const months = ["Jan", "Mar", "May", "Jul", "Sep", "Nov"];
// Daily highs in °C for a continental climate: winter months straddle zero.
const centre = [-4, 3, 15, 24, 16, 2];
// A deterministic, roughly bell-shaped sample around each month's centre.
const rows = months.flatMap((month, m) =>
	Array.from({ length: 60 }, (_, i) => {
		let sum = 0;
		for (let k = 1; k <= 3; k++)
			sum += Math.sin((i + 1) * k * 12.9898 + m * 4.1);
		return { month, temp: centre[m] + sum * 2.5 };
	}),
);
const palette = [
	"#4c78a8",
	"#72b7b2",
	"#54a24b",
	"#eeca3b",
	"#f58518",
	"#b279a2",
];

export default function Ridgeline() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={8}
				height={4.5}
				xLabel="°C"
				// One clip front sweeps left to right across every ridge.
				reveal="x"
				// The rows already name the months, so no legend.
				color={{ domain: months, range: palette }}
				legend={false}
				progress={shown}
			>
				<Density
					data={rows}
					x="temp"
					series="month"
					row
					rowHeight={1.5}
					fillOpacity={0.6}
				/>
			</Chart>
		</Stage>
	);
}
