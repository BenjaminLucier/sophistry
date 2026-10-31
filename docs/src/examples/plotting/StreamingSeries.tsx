import { derive, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, LinePlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Streaming series",
	description:
		"New samples arrive off-screen right and the x domain slides left under a clip; the leaving tick fades out. Everything is a function of one time track, so it scrubs.",
	uses: [
		"Stage",
		"Chart",
		"LinePlot",
		"track",
		"derive",
		"valueTo",
		"usePlayer",
	],
};

const WINDOW = 10;
/** The same sample at the same x however the timeline is scrubbed. */
const sample = (x: number) => 5 + 2 * Math.sin(x * 0.9) + Math.sin(x * 2.3);

export default function StreamingSeries() {
	const { play } = usePlayer();
	const time = track(0);
	onSettled(() => {
		void play(valueTo(time, 40, { duration: 40, easing: "linear" }));
	});

	// Whole steps change the data; the fraction slides the x domain.
	const step = derive(time, (t) => Math.floor(t));
	// One sample past the right edge, so it slides in rather than popping.
	const data = derive(step, (step) =>
		Array.from({ length: step + WINDOW + 2 }, (_, x) => ({
			x,
			y: sample(x),
		})),
	);
	const xRange = derive(time, (t) => {
		const step = Math.floor(t);
		return {
			from: [step, step + WINDOW] as [number, number],
			to: [step + 1, step + WINDOW + 1] as [number, number],
			t: t - step,
		};
	});

	return (
		<Stage units={12}>
			<Chart
				width={9}
				height={4.5}
				clip
				grid="y"
				yRange={[0, 10]}
				xRange={xRange}
			>
				<LinePlot data={data} x="x" y="y" />
			</Chart>
		</Stage>
	);
}
