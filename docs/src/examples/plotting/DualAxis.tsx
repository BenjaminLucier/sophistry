import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import {
	Bars,
	Chart,
	LinePlot,
	Scatter,
	SecondaryY,
} from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Two y axes",
	description:
		"Rainfall as bars on the left axis and temperature as a line on a secondary axis on the right. Layers inside SecondaryY share the month axis and the reveal but fit their own scale, aligned with alignTicks so its ticks sit on the left axis's grid lines, and the frame makes room for the right-hand numbers inside its width.",
	uses: [
		"Stage",
		"Chart",
		"Bars",
		"LinePlot",
		"Scatter",
		"SecondaryY",
		"track",
		"draw",
		"usePlayer",
	],
};

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const rain = [78, 61, 55, 52, 49, 41];
const temp = [3.1, 4.2, 7.0, 10.6, 14.4, 18.2];
const climate = months.map((m, i) => ({
	m,
	rain: rain[i],
	temp: temp[i],
	// A band axis centres category i at i + 0.5: the line's x.
	at: i + 0.5,
}));
const warm = "#e07a5f";

export default function DualAxis() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={9}
				height={4}
				center={{ x: 0, y: -0.4 }}
				yLabel="rain (mm)"
				y2Label="°C"
				// The temperature ticks sit on the rain axis's grid lines.
				y2Axis={{ zero: true, alignTicks: true }}
				grid="y"
				progress={shown}
			>
				<Bars data={climate} category="m" value="rain" />
				<SecondaryY>
					<LinePlot data={climate} x="at" y="temp" stroke={warm} />
					<Scatter data={climate} x="at" y="temp" color={warm} radius={0.07} />
				</SecondaryY>
			</Chart>
		</Stage>
	);
}
