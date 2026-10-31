import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Tree } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Radial dendrogram",
	description:
		"A small family of languages as a radial cluster tree: the root in the centre, every language on the outer ring, links growing out level by level.",
	uses: ["Stage", "Tree", "track", "draw", "usePlayer"],
};

type Lang = { name: string; children?: Lang[] };
const leaves = (...names: string[]) => names.map((name) => ({ name }));

const family: Lang = {
	name: "Indo-European",
	children: [
		{
			name: "Germanic",
			children: [
				{ name: "West", children: leaves("English", "Dutch", "German") },
				{ name: "North", children: leaves("Swedish", "Danish", "Icelandic") },
			],
		},
		{
			name: "Romance",
			children: leaves(
				"French",
				"Spanish",
				"Italian",
				"Portuguese",
				"Romanian",
			),
		},
		{
			name: "Slavic",
			children: [
				{ name: "East", children: leaves("Russian", "Ukrainian") },
				{ name: "West S.", children: leaves("Polish", "Czech") },
			],
		},
		{ name: "Indo-Iranian", children: leaves("Hindi", "Persian", "Bengali") },
	],
};

export default function RadialTree() {
	const { play } = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={10}>
			<Tree
				data={family}
				label="name"
				orientation="radial"
				layout="cluster"
				width={5}
				height={5}
				labelFontSize={0.15}
				nodeRadius={0.04}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
