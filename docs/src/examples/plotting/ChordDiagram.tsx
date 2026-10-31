import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chord } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Chord diagram",
	description:
		"Migration between four regions: the ring sweeps round like a pie, then each chord fades in, as wide at each end as the flow leaving it.",
	uses: ["Stage", "Chord", "track", "draw", "usePlayer"],
};

const moves = [
	{ from: "North", to: "South", people: 12 },
	{ from: "South", to: "North", people: 7 },
	{ from: "North", to: "East", people: 5 },
	{ from: "East", to: "West", people: 9 },
	{ from: "West", to: "East", people: 4 },
	{ from: "West", to: "South", people: 6 },
	{ from: "South", to: "East", people: 3 },
	{ from: "East", to: "North", people: 4 },
];

export default function ChordDiagram() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 3 }));
	});

	return (
		<Stage units={10}>
			<Chord
				data={moves}
				source="from"
				target="to"
				value="people"
				radius={2.2}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
