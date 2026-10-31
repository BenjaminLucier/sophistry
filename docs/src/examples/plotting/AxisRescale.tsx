import { derive, hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, LinePlot, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Animated axis rescale",
	description:
		"One track drives the y domain and the data together, shared by the axis, the grid and the marks: the values grow tenfold as the axis rescales under them, so the points barely move while the numbers change. Ticks on both ends slide, the rest cross-fade, and labels that would crowd fade out as they close up.",
	uses: [
		"Stage",
		"Chart",
		"LinePlot",
		"Scatter",
		"track",
		"derive",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
};

const before = [2, 6, 4, 8, 5];
const after = [20, 65, 35, 90, 55];

export default function AxisRescale() {
	const { play, signal } = usePlayer();
	const blend = track(0);
	// Data and domain on one track: they move together.
	const data = derive(blend, (t) =>
		before.map((v, i) => v + (after[i] - v) * t),
	);
	const yRange = derive(blend, (t) => ({
		from: [0, 10] as [number, number],
		to: [0, 100] as [number, number],
		t,
	}));

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.6),
						valueTo(blend, 1, { duration: 1.6 }),
						hold(0.6),
						valueTo(blend, 0, { duration: 1.6 }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={12}>
			<Chart
				width={9}
				height={4.5}
				clip
				grid="y"
				xRange={[0, 4, 1]}
				yRange={yRange}
			>
				<LinePlot data={data} />
				<Scatter data={data} x={(_, i) => i} y={(d) => d} radius={0.08} />
			</Chart>
		</Stage>
	);
}
