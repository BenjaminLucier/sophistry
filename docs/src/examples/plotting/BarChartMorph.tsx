import { derive, hold, sequence, track, valueTo } from "@sophistry/core";
import { Label, Stage, usePlayer } from "@sophistry/solidjs";
import { BarChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Morphing chart data",
	description:
		"Charts redraw from their data, so animating the data animates the chart: one blend track mixes two datasets and every bar follows.",
	uses: [
		"Stage",
		"Label",
		"BarChart",
		"track",
		"derive",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
};

const before = [3, 7, 4, 9, 6];
const after = [8, 2, 9, 3, 5];

export default function BarChartMorph() {
	const { play, signal } = usePlayer();
	const blend = track(0);
	// The chart binds this derived array, so every change to `blend` redraws the bars.
	const data = derive(blend, (t) =>
		before.map((v, i) => v + (after[i] - v) * t),
	);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.8),
						valueTo(blend, 1, { duration: 1.5 }),
						hold(0.8),
						valueTo(blend, 0, { duration: 1.5 }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<BarChart
				data={data}
				label={(_, i) => "abcde"[i]}
				yRange={[0, 10, 2]}
				width={8}
				height={4}
			/>
			<Label text="same chart, new data" y={2.5} fontSize={0.4} />
		</Stage>
	);
}
