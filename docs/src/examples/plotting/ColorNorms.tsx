import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Heatmap, Imshow } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Log and diverging colour norms",
	description:
		"A field spanning four decades on a log norm, and temperature anomalies on a diverging norm centred on zero, each with a colour bar that follows its norm.",
};

// A peak over a floor: 1 at the edges to 10,000 at the centre.
const n = 24;
const field = Array.from({ length: n }, (_, row) =>
	Array.from({ length: n }, (_, col) => {
		const dx = (col - n / 2) / (n / 4);
		const dy = (row - n / 2) / (n / 4);
		return 10 ** (4 * Math.exp(-(dx * dx + dy * dy)));
	}),
);

// Monthly anomalies (°C) that run warmer than they run cold.
const months = ["Jan", "Mar", "May", "Jul", "Sep", "Nov"];
const years = ["2020", "2021", "2022", "2023", "2024"];
const anomalies = years.flatMap((year, i) =>
	months.map((month, j) => ({
		year,
		month,
		anomaly:
			Math.round((0.6 * i - 0.6 + 1.1 * Math.sin(i * 1.7 + j * 1.8)) * 10) / 10,
	})),
);

export default function ColorNorms() {
	const { play } = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void play(draw(progress, { duration: 2 }));
	});

	return (
		<Stage units={14}>
			<Chart
				width={3.6}
				height={3.6}
				center={{ x: -3.6, y: 0 }}
				xRange={[0, n]}
				yRange={[0, n]}
				title={'rampScale="log"'}
				colorbar
				progress={progress}
			>
				<Imshow
					values={field}
					xRange={[0, n]}
					yRange={[0, n]}
					ramp="magma"
					rampScale="log"
				/>
			</Chart>
			<Heatmap
				data={anomalies}
				x="month"
				y="year"
				value="anomaly"
				labels={false}
				ramp="coolwarm"
				rampMidpoint={0}
				colorbar
				colorbarLabel="°C"
				title="rampMidpoint={0}"
				width={4.4}
				height={2.4}
				center={{ x: 3, y: -0.4 }}
				progress={progress}
			/>
		</Stage>
	);
}
