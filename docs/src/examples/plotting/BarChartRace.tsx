import { rankRace } from "@sophistry/charts";
import { derive, track, valueTo } from "@sophistry/core";
import { Stage, Text, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Bar chart race",
	description:
		"Values interpolate between yearly keyframes, ranks come from the interpolated values, and each overtake slides on its own short ease. The category axis follows the ranks through its `slot`, so names ride with their bars, and only the top five are shown: whoever drops out slides under the last place and out of view.",
};

const NAMES = ["Ada", "Basil", "Cleo", "Dara", "Esme", "Farid", "Greta"];
const YEARS = Array.from({ length: 11 }, (_, k) => 2010 + k);
const rows = NAMES.flatMap((name, i) =>
	YEARS.map((year, k) => ({
		name,
		year,
		score: Math.round(
			20 + (i % 3) * 6 + k * (3 + i) + 9 * Math.sin(k * 0.8 + i * 1.7),
		),
	})),
);
const race = rankRace(rows, {
	key: "name",
	time: "year",
	value: "score",
	swap: 0.35,
	top: 5,
});
const MAX = Math.max(...rows.map((d) => d.score));

export default function BarChartRace() {
	const { play } = usePlayer();
	const year = track(YEARS[0]);
	onSettled(() => {
		// Playback through time is linear; the swaps ease on their own.
		void play(valueTo(year, 2020.4, { duration: 10.4, easing: "linear" }));
	});
	// Five slots on the axis; entries past them slide out under the last.
	// They come and go, so the colours are pinned to every name below.
	const view = derive(year, (time) => race.view(time));
	const yAxis = derive(view, (frame) => ({
		categories: frame.categories,
		slot: frame.slot,
	}));
	const entries = derive(view, (frame) => frame.entries);
	const caption = derive(year, (time) =>
		String(Math.min(2020, Math.floor(time))),
	);

	return (
		<Stage units={12}>
			<Chart
				width={9}
				height={4.6}
				center={{ x: -0.4, y: -0.2 }}
				clip
				grid="x"
				legend={false}
				color={{ domain: race.keys }}
				xRange={[0, Math.ceil(MAX / 20) * 20]}
				yAxis={yAxis}
			>
				<Bars
					data={entries}
					category="key"
					value="value"
					key="key"
					series="key"
					orientation="horizontal"
					labels={(d) => d.value.toFixed(0)}
				/>
			</Chart>
			<Text text={caption} x={3.6} y={-1.9} fontSize={0.9} opacity={0.5} />
		</Stage>
	);
}
