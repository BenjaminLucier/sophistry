import { okabeIto } from "@sophistry/charts";
import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { PairPlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Pair plot",
	description:
		"Every pair of three measurements against each other, each measurement's density on the diagonal. Panels in a column share x and panels in a row share y, so a flower lines up across the matrix; only the bottom row and left column write numbers and names.",
	uses: ["Stage", "PairPlot", "okabeIto", "track", "draw", "usePlayer"],
};

const hash = (n: number) => Math.abs((Math.sin(n * 78.233) * 43758.5453) % 1);
const species = [
	{ name: "setosa", sepal: 5.0, petal: 1.5, width: 0.25 },
	{ name: "versicolor", sepal: 5.9, petal: 4.3, width: 1.3 },
	{ name: "virginica", sepal: 6.6, petal: 5.5, width: 2.0 },
];
const flowers = species.flatMap((s, k) =>
	Array.from({ length: 18 }, (_, i) => {
		const seed = k * 100 + i;
		const size = hash(seed) - 0.5;
		return {
			species: s.name,
			sepal: s.sepal + 0.9 * size + 0.3 * (hash(seed + 1) - 0.5),
			petal: s.petal + 0.8 * size + 0.3 * (hash(seed + 2) - 0.5),
			width: s.width + 0.3 * size + 0.15 * (hash(seed + 3) - 0.5),
		};
	}),
);

export default function PairPlotMatrix() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 3 }));
	});

	return (
		<Stage units={12}>
			<PairPlot
				data={flowers}
				variables={["sepal", "petal", "width"]}
				variableLabels={{
					sepal: "sepal (cm)",
					petal: "petal (cm)",
					width: "width (cm)",
				}}
				series="species"
				color={{ range: okabeIto }}
				// Everything, names and legend included, fits the stage.
				autosize="contain"
				width={9}
				height={6.4}
				progress={shown}
			/>
		</Stage>
	);
}
