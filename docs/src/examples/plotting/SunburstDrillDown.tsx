import { derive, draw, hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Sunburst } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Sunburst drill-down",
	description:
		"Zooming into one branch of a sunburst and back out: the focus is a transition between two nodes driven by one track, so the zoom scrubs like any other animation. The chosen branch becomes the centre and its children open out round the whole turn.",
	uses: [
		"Stage",
		"Sunburst",
		"track",
		"derive",
		"draw",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
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

export default function SunburstDrillDown() {
	const { play, signal } = usePlayer();
	const progress = track(0);
	const zoom = track(0);
	const focus = derive(zoom, (t) => ({ from: [], to: ["src"], t }));

	onSettled(() => {
		void (async () => {
			await play(draw(progress, { duration: 2 }));
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.8),
						valueTo(zoom, 1, { duration: 1.4 }),
						hold(1.4),
						valueTo(zoom, 0, { duration: 1.4 }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<Sunburst
				data={repo}
				value="kb"
				label="name"
				radius={2.5}
				labelFontSize={0.18}
				progress={progress}
				focus={focus}
				tooltip
			/>
		</Stage>
	);
}
