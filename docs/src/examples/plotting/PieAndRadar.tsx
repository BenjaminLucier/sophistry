import { draw, track } from "@sophistry/core";
import { Stage, Text, usePlayer } from "@sophistry/solidjs";
import { PieChart, RadarChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Pie and radar charts",
	description:
		"A doughnut chart and a two-series radar chart, both built from plain data and revealed together: the doughnut's slices open together from 12 o'clock, each pushed round by the ones before, while the radar's polygons grow out of the centre. ariaLabel gives each slice an accessible name.",
};

const share = [
	{ name: "Solid", pct: 42 },
	{ name: "Svelte", pct: 23 },
	{ name: "Vue", pct: 20 },
	{ name: "Other", pct: 15 },
];

const skills = [
	{ who: "Ada", scores: [8, 5, 7, 9, 6] },
	{ who: "Grace", scores: [6, 9, 5, 7, 8] },
];

export default function PieAndRadar() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2 }));
	});

	return (
		<Stage units={14}>
			<PieChart
				data={share}
				value="pct"
				label="name"
				ariaLabel="Framework share"
				center={{ x: -3.6, y: 0.2 }}
				radius={2.2}
				innerRadius={1}
				progress={progress}
			/>
			<RadarChart
				data={skills}
				axisValues="scores"
				axisLabels={["Speed", "Craft", "Docs", "Tests", "Design"]}
				maxValue={10}
				center={{ x: 3.6, y: 0.2 }}
				radius={2.2}
				progress={progress}
			/>
			<Text text="doughnut" x={-3.6} y={-3.1} fontSize={0.4} />
			<Text text="radar, two series" x={3.6} y={-3.1} fontSize={0.4} />
		</Stage>
	);
}
