import { okabeIto } from "@sophistry/charts";
import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, LinePlot, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Series and a generated legend",
	description:
		"One long-format dataset split by series: a line and markers per city, one colour per city from the chart's scale, and a legend that arrives after the data it explains.",
};

const normals: Record<string, number[]> = {
	Oslo: [-4, -4, 0, 5, 11, 15, 17, 16, 11, 6, 1, -3],
	Rome: [8, 9, 11, 14, 18, 22, 25, 25, 22, 17, 12, 9],
	Cairo: [14, 15, 18, 21, 25, 27, 28, 28, 26, 24, 19, 15],
};
const rows = Object.entries(normals).flatMap(([city, temps]) =>
	temps.map((c, i) => ({ city, month: i + 1, c })),
);

export default function SeriesLegend() {
	const { play } = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void play(draw(progress, { duration: 3.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				// The legend's room comes out of width (autosize="fit"), so the
				// plot and its key are centred together.
				width={10}
				height={4.2}
				center={{ x: 0, y: -0.2 }}
				grid="y"
				yLabel="°C"
				color={{ range: okabeIto }}
				legendTitle="City"
				progress={progress}
			>
				<LinePlot data={rows} x="month" y="c" series="city" />
				<Scatter data={rows} x="month" y="c" series="city" radius={0.06} />
			</Chart>
		</Stage>
	);
}
