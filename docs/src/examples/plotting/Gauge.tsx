import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Gauge, RadialBarChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "KPI gauge and radial bars",
	description:
		"A gauge with threshold bands and a needle, beside activity rings. Each draws its track first, then sweeps clockwise while the readout counts up.",
};

const rings = [
	{ goal: "Move", pct: 82 },
	{ goal: "Exercise", pct: 64 },
	{ goal: "Stand", pct: 45 },
];

export default function GaugeExample() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Gauge
				value={72.4}
				unit="%"
				label="CPU load"
				bands={[
					{ to: 60, color: "#83c167" },
					{ to: 85, color: "#f0ac5f" },
					{ to: 100, color: "#fc6255" },
				]}
				needle
				center={{ x: -2.8, y: 0 }}
				radius={2.2}
				progress={progress}
				tooltip
			/>
			<RadialBarChart
				data={rings}
				value="pct"
				label="goal"
				maxValue={100}
				center={{ x: 2.8, y: 0 }}
				radius={2.2}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
