import { draw, hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Treemap } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Treemap transition that keeps its rows",
	description:
		'The values reorder, so a fresh squarify would re-row the tiles and slide them across each other. tile="resquarify" lays the new values out in the old rows instead: every tile keeps its neighbours and every frame is a clean tiling, at the cost of the end not being the plain squarified layout.',
};

type Item = { name: string; k?: number; children?: Item[] };
const shares = (...entries: [string, number][]): Item => ({
	name: "market",
	children: entries.map(([name, k]) => ({ name, k })),
});

const before = shares(
	["Alder", 30],
	["Birch", 24],
	["Cedar", 16],
	["Dogwood", 12],
	["Elm", 8],
	["Fir", 6],
	["Gum", 4],
);
const after = shares(
	["Alder", 8],
	["Birch", 12],
	["Cedar", 14],
	["Dogwood", 16],
	["Elm", 18],
	["Fir", 20],
	["Gum", 12],
);

export default function TreemapResquarify() {
	const { play, signal } = usePlayer();
	const progress = track(0);
	const blend = track(0);

	onSettled(() => {
		void (async () => {
			await play(draw(progress, { duration: 1.5 }));
			while (!signal.aborted) {
				await play(
					sequence(
						hold(1),
						valueTo(blend, 1, { duration: 1.8, easing: "linear" }),
						hold(1.2),
						valueTo(blend, 0, { duration: 1.8, easing: "linear" }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<Treemap
				data={before}
				to={after}
				blend={blend}
				tile="resquarify"
				value="k"
				label="name"
				width={8}
				height={4.6}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
