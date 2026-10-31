import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Density, Rug } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Density with a rug",
	description:
		"One kernel density estimate per series (morning and evening waits, from one long-format sample), both sweeping in along x behind one front, with the raw sample as a rug of ticks standing on the axis, in the same series colours, drawn in value order.",
	uses: ["Stage", "Chart", "Density", "Rug", "track", "draw", "usePlayer"],
};

// Two overlapping clusters, from a deterministic sine hash.
const waits = Array.from({ length: 80 }, (_, i) => {
	const u = (Math.sin((i + 1) * 12.9898) + Math.sin((i + 1) * 78.233)) / 2;
	return i % 3 === 0
		? { when: "evening", minutes: 7.5 + u * 1.5 }
		: { when: "morning", minutes: 3.5 + u * 1.8 };
});

export default function DensityAndRug() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={8}
				height={4}
				xLabel="minutes"
				grid="y"
				legend="top"
				progress={shown}
			>
				<Density data={waits} x="minutes" series="when" />
				<Rug data={waits} value="minutes" series="when" stagger={0.6} />
			</Chart>
		</Stage>
	);
}
