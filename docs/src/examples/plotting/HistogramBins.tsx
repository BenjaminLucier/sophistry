import { derive, track, valueTo } from "@sophistry/core";
import { Axes, Label, Stage, usePlayer } from "@sophistry/solidjs";
import { Histogram } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Histogram bins",
	description:
		"The same 120 samples regrouped into more and more bins, from coarse to fine.",
};

// 120 bell-shaped samples in [0, 6]: each is the sum of six uniform numbers from a tiny generator.
let seed = 7;
const uniform = () => {
	seed = (seed * 16807) % 2147483647;
	return seed / 2147483647;
};
const samples = Array.from({ length: 120 }, () =>
	Array.from({ length: 6 }, uniform).reduce((a, b) => a + b),
);

export default function HistogramBins() {
	const { play } = usePlayer();
	const bins = track(4);

	onSettled(() => {
		void play(valueTo(bins, 20, { duration: 4 }));
	});

	return (
		<Stage units={14}>
			<Axes xRange={[0, 6, 1]} yRange={[0, 70, 10]} width={10} height={5}>
				<Histogram
					data={samples}
					binCount={derive(bins, Math.round)}
					range={[0, 6]}
				/>
			</Axes>
			<Label
				text={derive(bins, (value) => `${Math.round(value)} bins`)}
				y={3.5}
			/>
		</Stage>
	);
}
