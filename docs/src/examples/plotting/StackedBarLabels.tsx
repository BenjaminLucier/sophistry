import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Value labels in stacked bars",
	description:
		"labels={{ position: \"inside\", total: true }} centres each segment's value in it, in whichever of dark and light text reads on its fill, and writes each stack's total past its end. Labels count up and grow in with their segments; one too small for its segment (the 1 in Q2) is left out.",
};

const sales = ["Q1", "Q2", "Q3", "Q4"].flatMap((quarter, q) =>
	["north", "south", "east"].map((region, r) => ({
		quarter,
		region,
		units: [
			[4, 6, 5, 8],
			[3, 1, 4, 5],
			[2, 4, 3, 4],
		][r][q],
	})),
);

export default function StackedBarLabels() {
	const { play } = usePlayer();
	const shown = track(0);
	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={8}
				height={4.5}
				grid="y"
				color={{ range: ["#1f3b73", "#f58518", "#c9e3b2"] }}
				legend="top"
				progress={shown}
			>
				<Bars
					data={sales}
					category="quarter"
					value="units"
					series="region"
					layout="stack"
					labels={{ position: "inside", total: true }}
					stagger={0.4}
				/>
			</Chart>
		</Stage>
	);
}
