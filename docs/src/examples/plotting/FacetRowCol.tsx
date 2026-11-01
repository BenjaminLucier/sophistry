import { okabeIto, scatter } from "@sophistry/charts";
import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Facet } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "A row × column facet grid",
	description:
		"One table split two ways: years down the rows, islands across the columns. Each row's year is written once in the right margin and each island once over the top row, the panels share both scales, and one legend runs along the top.",
};

// Deterministic jitter around each species' centre, so the gallery is stable.
const hash = (n: number) => Math.abs((Math.sin(n * 12.9898) * 43758.5453) % 1);
const centres = {
	Adelie: [38.8, 18.3],
	Chinstrap: [48.8, 18.4],
	Gentoo: [47.5, 15.0],
} as const;
const islands: [string, (keyof typeof centres)[]][] = [
	["Biscoe", ["Adelie", "Gentoo"]],
	["Dream", ["Adelie", "Chinstrap"]],
	["Torgersen", ["Adelie"]],
];
const birds = [2008, 2009].flatMap((year, y) =>
	islands.flatMap(([island, species], k) =>
		species.flatMap((name, s) =>
			Array.from({ length: 9 }, (_, i) => {
				const seed = y * 5000 + k * 1000 + s * 100 + i;
				return {
					year,
					island,
					species: name,
					bill: centres[name][0] + y + 6 * (hash(seed) - 0.5),
					depth: centres[name][1] + 2.4 * (hash(seed + 7) - 0.5),
				};
			}),
		),
	),
);

export default function FacetRowCol() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Facet
				data={birds}
				row="year"
				column="island"
				legend="top"
				gap={{ y: 0.6 }}
				autosize="contain"
				width={11.4}
				height={6.2}
				xLabel="bill length (mm)"
				yLabel="bill depth (mm)"
				grid
				color={{ domain: Object.keys(centres), range: okabeIto }}
				progress={shown}
				panel={(panel) => [
					scatter.create({
						data: panel.data,
						x: "bill",
						y: "depth",
						series: "species",
						radius: 0.05,
					}),
				]}
			/>
		</Stage>
	);
}
