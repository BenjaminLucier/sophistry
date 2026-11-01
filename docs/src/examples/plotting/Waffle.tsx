import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Waffle } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Waffle chart",
	description:
		"A 10 × 10 waffle where each cell is one percent, filling from the bottom-left like a container. Counts use largest-remainder rounding, so they always add up to 100.",
};

const commute = [
	{ mode: "Bike", share: 41.6 },
	{ mode: "Bus", share: 30.1 },
	{ mode: "Car", share: 18.9 },
	{ mode: "Walk", share: 9.4 },
];

export default function WaffleExample() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={10}>
			<Waffle
				data={commute}
				value="share"
				label="mode"
				width={4}
				height={4}
				center={{ x: 0, y: 0.5 }}
				legend
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
