import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Treemap } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Treemap",
	description:
		"A squarified treemap of a source tree: tiles fade in folder by folder, coloured by top-level folder.",
	uses: ["Stage", "Treemap", "track", "draw", "usePlayer"],
};

type Node = { name: string; lines?: number; children?: Node[] };

const repo: Node = {
	name: "repo",
	children: [
		{
			name: "scene",
			children: [
				{ name: "shape", lines: 900 },
				{ name: "Label", lines: 420 },
				{ name: "Arc", lines: 380 },
				{ name: "Rect", lines: 210 },
			],
		},
		{
			name: "charts",
			children: [
				{ name: "Chart", lines: 760 },
				{ name: "Bars", lines: 400 },
				{ name: "tip", lines: 230 },
			],
		},
		{
			name: "anim",
			children: [
				{ name: "timeline", lines: 520 },
				{ name: "draw", lines: 160 },
			],
		},
		{ name: "color", lines: 450 },
	],
};

export default function TreemapExample() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2 }));
	});

	return (
		<Stage units={10}>
			<Treemap
				data={repo}
				value="lines"
				label="name"
				width={9}
				height={5}
				paddingTop={0.32}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
