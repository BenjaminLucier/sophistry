import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Tree } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Dendrogram",
	description:
		"A cluster dendrogram of a small taxonomy: elbow links grow out of the root one level at a time, leaves aligned on the right.",
};

type Taxon = { name: string; children?: Taxon[] };

const leaves = (...names: string[]) => names.map((name) => ({ name }));
const life: Taxon = {
	name: "Animals",
	children: [
		{
			name: "Vertebrates",
			children: [
				{ name: "Mammals", children: leaves("Cat", "Whale", "Bat") },
				{ name: "Birds", children: leaves("Owl", "Penguin") },
				{ name: "Fish", children: leaves("Shark", "Salmon") },
			],
		},
		{
			name: "Invertebrates",
			children: [
				{ name: "Insects", children: leaves("Ant", "Bee", "Moth") },
				{ name: "Molluscs", children: leaves("Octopus", "Snail") },
			],
		},
	],
};

export default function TreeDendrogram() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={10}>
			<Tree
				data={life}
				label="name"
				layout="cluster"
				width={9}
				height={5}
				labelFontSize={0.2}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
