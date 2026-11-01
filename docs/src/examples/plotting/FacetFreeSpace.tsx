import { bars } from "@sophistry/charts";
import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Facet } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Facet panels sized by their categories",
	description:
		'Each department has its own teams, so the x axes are independent; space="free" makes each panel as wide as its number of bars, so every bar is the same width and the panels read as one row of bars. The value axis is shared.',
};

const teams: [string, [string, number][]][] = [
	[
		"Product",
		[
			["Web", 30],
			["App", 22],
		],
	],
	[
		"Sales",
		[
			["EU", 18],
			["US", 26],
			["Asia", 14],
			["Retail", 9],
			["Online", 12],
		],
	],
	[
		"Ops",
		[
			["Infra", 16],
			["Help", 10],
			["IT", 7],
		],
	],
];
const budget = teams.flatMap(([department, list]) =>
	list.map(([team, k]) => ({ department, team, k })),
);

export default function FacetFreeSpace() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2 }));
	});

	return (
		<Stage units={12}>
			<Facet
				data={budget}
				column="department"
				scales={{ x: "independent" }}
				space={{ x: "free" }}
				gap={{ x: 0.3 }}
				autosize="contain"
				width={11.4}
				height={5.6}
				yLabel="budget (k)"
				grid="y"
				progress={shown}
				panel={(panel) => [
					bars.create({ data: panel.data, category: "team", value: "k" }),
				]}
			/>
		</Stage>
	);
}
