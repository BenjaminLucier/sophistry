import { draw, hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Treemap } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Treemap data transition",
	description:
		"One budget, two years. Tiles are matched by their path of names: the team that was cut fades out, the others resize into place, the new team fades in. One blend track drives it, so it scrubs. Data order and an order-keeping tile keep every frame a clean tiling.",
};

type Item = { name: string; k?: number; children?: Item[] };
const teams = (...entries: [string, number][]) =>
	entries.map(([name, k]) => ({ name, k }));

const lastYear: Item = {
	name: "budget",
	children: [
		{
			name: "Product",
			children: teams(["Web", 30], ["Mobile", 22], ["Labs", 12]),
		},
		{ name: "Sales", children: teams(["EMEA", 18], ["Americas", 26]) },
		{ name: "Ops", children: teams(["Infra", 16], ["Support", 10]) },
	],
};
const thisYear: Item = {
	name: "budget",
	children: [
		{
			name: "Product",
			children: teams(["Web", 26], ["Mobile", 30], ["AI", 20]),
		},
		{ name: "Sales", children: teams(["EMEA", 22], ["Americas", 24]) },
		{ name: "Ops", children: teams(["Infra", 12], ["Support", 10]) },
	],
};

export default function TreemapTransition() {
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
				data={lastYear}
				to={thisYear}
				blend={blend}
				value="k"
				label="name"
				tile="sliceDice"
				sort={false}
				width={8}
				height={4.2}
				paddingTop={0.3}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
