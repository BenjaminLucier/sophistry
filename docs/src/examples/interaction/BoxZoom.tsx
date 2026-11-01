import {
	derive,
	draw,
	parallel,
	sequence,
	track,
	trackPoint,
	valueTo,
} from "@sophistry/core";
import { PanZoom, Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, ChartZoom, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Drag a box to zoom",
	description:
		"Drag a rectangle over the plot to zoom into it (a thin one zooms one axis), hold Shift to pan instead, Backspace to step back out, and 0 or a double tap to reset; Escape mid-drag cancels. The toolbar in the corner switches between panning and box zoom and resets, and each button is a tab stop. The x axis is logarithmic: zooms and the bounds work in decades. The wheel over the plot zooms the chart, and anywhere else it zooms the stage's own PanZoom camera.",
};

/** A deterministic scatter: income on a log scale against a score. */
const people = Array.from({ length: 260 }, (_, i) => {
	const u = ((i * 0.618034) % 1) * 3;
	const income = 10 ** (3 + u);
	const wobble = Math.sin(i * 12.9898) * 43758.5453;
	const noise = wobble - Math.floor(wobble) - 0.5;
	return { income, score: 20 + 18 * u + 22 * noise };
});

export default function BoxZoom() {
	const player = usePlayer();
	const units = track(12);
	const center = trackPoint(0, 0);
	const shown = track(0);
	const x = [track(1e3), track(1e6)] as const;
	const y = [track(0), track(100)] as const;
	onSettled(() => {
		void player.play(
			sequence(
				draw(shown, { duration: 1.5 }),
				parallel(
					valueTo(x[0], 1e4, { duration: 1.6 }),
					valueTo(x[1], 1e5, { duration: 1.6 }),
					valueTo(y[0], 25, { duration: 1.6 }),
					valueTo(y[1], 85, { duration: 1.6 }),
				),
			),
		);
	});

	return (
		<Stage units={units} center={center}>
			<PanZoom units={units} center={center} minUnits={6} maxUnits={30} />
			<Chart
				width={8.4}
				height={5}
				center={{ x: -0.3, y: 0 }}
				xRange={derive(x, (start, end) => [start, end])}
				yRange={derive(y, (start, end) => [start, end])}
				xAxis={{ scale: "log", position: "bottom" }}
				yAxis={{ position: "left" }}
				xLabel="income"
				yLabel="score"
				clip
				progress={shown}
			>
				<ChartZoom
					x={x}
					y={y}
					dragMode="box"
					toolbar
					bounds={{ x: [1e3, 1e6], y: [0, 100] }}
					label="income against score"
				/>
				<Scatter data={people} x="income" y="score" radius={0.05} />
			</Chart>
		</Stage>
	);
}
