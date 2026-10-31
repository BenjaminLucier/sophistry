import { okabeIto, scatter } from "@sophistry/charts";
import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Facet } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Small multiples with shared scales",
	description:
		"One panel per island from a single long-format table. The panels share both scales, so the clusters compare across the row, and only the outer panels write numbers; the species colours come from one scale with one legend. Every frame draws first, then the panels fill left to right.",
	uses: ["Stage", "Facet", "scatter", "okabeIto", "track", "draw", "usePlayer"],
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
const birds = islands.flatMap(([island, species], k) =>
	species.flatMap((name, s) =>
		Array.from({ length: 14 }, (_, i) => {
			const seed = k * 1000 + s * 100 + i;
			return {
				island,
				species: name,
				bill: centres[name][0] + 6 * (hash(seed) - 0.5),
				depth: centres[name][1] + 2.4 * (hash(seed + 7) - 0.5),
			};
		}),
	),
);

export default function FacetGrid() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 3 }));
	});

	return (
		<Stage units={12}>
			<Facet
				data={birds}
				column="island"
				// Everything, titles and legend included, fits the stage.
				autosize="contain"
				width={11.4}
				height={5.8}
				xLabel="bill length (mm)"
				yLabel="bill depth (mm)"
				grid
				color={{ domain: Object.keys(centres), range: okabeIto }}
				progress={shown}
				stagger={0.5}
				panel={(panel) => [
					scatter.create({
						data: panel.data,
						x: "bill",
						y: "depth",
						series: "species",
						radius: 0.06,
					}),
				]}
			/>
		</Stage>
	);
}
