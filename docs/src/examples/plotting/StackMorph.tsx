import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, StackPlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Stacked area morph",
	description:
		"Each end is stacked on its own and every band's two edges morph together on one shared x grid, so each frame is still a stack: a leaving band shrinks and the bands above settle onto it, a new one grows in its place.",
};

const rows = (source: string, f: (week: number) => number, weeks = 9) =>
	Array.from({ length: weeks }, (_, week) => ({ source, week, gw: f(week) }));

const before = [
	...rows("coal", (w) => 14 - w * 0.8),
	...rows("gas", (w) => 10 + 2 * Math.sin(w / 1.5)),
	...rows("wind", (w) => 4 + w * 0.6),
];
const after = [
	...rows("gas", (w) => 8 + 1.5 * Math.cos(w / 2), 12),
	...rows("wind", (w) => 7 + w * 0.9, 12),
	...rows("solar", (w) => 3 + 4 * Math.sin(w / 3.5), 12),
];

export default function StackMorph() {
	const { play, signal } = usePlayer();
	const blend = track(0);
	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.6),
						valueTo(blend, 1, { duration: 3, easing: "linear" }),
						hold(0.8),
						valueTo(blend, 0, { duration: 3, easing: "linear" }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={12}>
			<Chart
				width={10}
				height={4.4}
				xLabel="week"
				yLabel="GW"
				// Weeks 0–11 fit 0–11, not 0–15: the axis stops at the data
				// rather than running most of a tick step past it.
				xAxis={{ nice: "tight" }}
				color={{ domain: ["coal", "gas", "wind", "solar"] }}
			>
				<StackPlot
					data={before}
					to={after}
					blend={blend}
					x="week"
					y="gw"
					series="source"
				/>
			</Chart>
		</Stage>
	);
}
