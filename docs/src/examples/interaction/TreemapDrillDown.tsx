import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Treemap } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Tap to drill into a treemap",
	description:
		"Tap a tile to zoom into its folder, tap a crumb above to zoom back out; Tab and Enter do the same. The zoom is a tween of the chart's focus, so it is exactly the scrubbable drill-down transition, and under reduced motion it dissolves instead.",
};

type Item = { name: string; kb?: number; children?: Item[] };
const files = (...entries: [string, number][]) =>
	entries.map(([name, kb]) => ({ name, kb }));

const repo: Item = {
	name: "repo",
	children: [
		{
			name: "src",
			children: [
				{
					name: "charts",
					children: files(["bars", 40], ["pie", 22], ["tree", 30]),
				},
				{ name: "scene", children: files(["shape", 35], ["text", 18]) },
				{ name: "anim", kb: 26 },
			],
		},
		{ name: "docs", children: files(["guides", 30], ["api", 24]) },
		{ name: "tests", children: files(["unit", 28], ["e2e", 14]) },
	],
};

export default function TreemapDrillDown() {
	const player = usePlayer();
	const progress = track(0);
	onSettled(() => {
		void player.play(draw(progress, { duration: 1.5 }));
	});

	return (
		<Stage units={10}>
			<Treemap
				data={repo}
				value="kb"
				label="name"
				width={8}
				height={3.9}
				center={{ x: 0, y: -0.4 }}
				paddingTop={0.3}
				labelFontSize={0.2}
				progress={progress}
				drill
				breadcrumbs
				tooltip
			/>
		</Stage>
	);
}
