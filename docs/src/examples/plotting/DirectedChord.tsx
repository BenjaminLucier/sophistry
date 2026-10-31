import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chord } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Directed chord diagram",
	description:
		"Who emails whom: one chord per direction, each as wide at both ends as its flow, ending in an arrowhead on the team it reaches. A team that only receives still gets its arc.",
	uses: ["Stage", "Chord", "track", "draw", "usePlayer"],
};

const mail = [
	{ from: "Sales", to: "Support", n: 14 },
	{ from: "Support", to: "Sales", n: 6 },
	{ from: "Sales", to: "Legal", n: 5 },
	{ from: "Product", to: "Support", n: 9 },
	{ from: "Product", to: "Sales", n: 7 },
	{ from: "Support", to: "Product", n: 11 },
	{ from: "Product", to: "Legal", n: 3 },
];

export default function DirectedChord() {
	const { play } = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void play(draw(progress, { duration: 3 }));
	});

	return (
		<Stage units={10}>
			<Chord
				data={mail}
				source="from"
				target="to"
				value="n"
				directed
				arrows
				radius={2.2}
				padAngle={0.06}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
