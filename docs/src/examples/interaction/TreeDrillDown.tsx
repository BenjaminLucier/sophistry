import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Tree } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Tap to zoom into a tree",
	description:
		"Tap a node to spread its subtree over the chart, tap it again (or the back arrow, or a crumb) to zoom out; Tab and Enter do the same. Deep trails collapse their middle into an ellipsis that climbs back up.",
	uses: ["Stage", "Tree", "track", "draw", "usePlayer"],
};

type Item = { name: string; children?: Item[] };
const leaves = (...names: string[]) => names.map((name) => ({ name }));

const repo: Item = {
	name: "repo",
	children: [
		{
			name: "packages",
			children: [
				{
					name: "core",
					children: [
						{
							name: "charts",
							children: leaves("bars", "pie", "tree", "facet"),
						},
						{ name: "scene", children: leaves("shape", "text") },
						{ name: "anim", children: leaves("tween", "clock") },
					],
				},
				{ name: "three", children: leaves("mesh", "camera") },
			],
		},
		{ name: "docs", children: leaves("guides", "api", "gallery") },
		{ name: "e2e", children: leaves("visual", "bench") },
	],
};

export default function TreeDrillDown() {
	const player = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void player.play(draw(progress, { duration: 1.5 }));
	});

	return (
		<Stage units={10}>
			<Tree
				data={repo}
				label="name"
				width={8}
				height={4.2}
				center={{ x: 0, y: -0.3 }}
				progress={progress}
				drill
				breadcrumbs={{ back: true, maxWidth: 3.2 }}
				tooltip
			/>
		</Stage>
	);
}
