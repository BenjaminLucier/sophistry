import { draw, hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { RadarChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Radar with a changing axis set",
	description:
		"Two phones rated on five axes, then on a new set of five. Axes are matched by name: Weight and Price fold away, every polygon's corner on them flattening into its edge, the shared axes turn to their new places, then Camera and Repair unfold. The polygons blend axis by axis on the same track.",
};

const axes = ["Battery", "Screen", "Weight", "Speed", "Price"];
const nextAxes = ["Battery", "Camera", "Screen", "Speed", "Repair"];
const ratings = [
	{ phone: "Aster", v: [8, 7, 6, 9, 4] },
	{ phone: "Birch", v: [6, 9, 8, 6, 7] },
];
const nextRatings = [
	{ phone: "Aster", v: [7, 9, 8, 9, 3] },
	{ phone: "Birch", v: [9, 6, 9, 7, 8] },
];

export default function RadarAxes() {
	const { play, signal } = usePlayer();
	const progress = track(0);
	const blend = track(0);

	onSettled(() => {
		void (async () => {
			await play(draw(progress, { duration: 1.5 }));
			while (!signal.aborted) {
				await play(
					sequence(
						hold(1),
						// Staged transitions ease each stage themselves: drive them linearly.
						valueTo(blend, 1, { duration: 1.8, easing: "linear" }),
						hold(1.2),
						valueTo(blend, 0, { duration: 1.8, easing: "linear" }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<RadarChart
				data={ratings}
				to={nextRatings}
				blend={blend}
				axisValues="v"
				key="phone"
				axisLabels={axes}
				toAxisLabels={nextAxes}
				maxValue={10}
				radius={2}
				progress={progress}
			/>
		</Stage>
	);
}
