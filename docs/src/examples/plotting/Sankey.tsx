import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Sankey } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Sankey diagram",
	description:
		"Energy flowing from sources to uses: nodes appear column by column, then the flows draw left to right.",
};

const flows = [
	{ from: "Solar", to: "Electricity", twh: 3 },
	{ from: "Wind", to: "Electricity", twh: 5 },
	{ from: "Gas", to: "Electricity", twh: 4 },
	{ from: "Gas", to: "Heat", twh: 3 },
	{ from: "Electricity", to: "Homes", twh: 5 },
	{ from: "Electricity", to: "Industry", twh: 6 },
	{ from: "Electricity", to: "Losses", twh: 1 },
	{ from: "Heat", to: "Homes", twh: 3 },
];

export default function SankeyExample() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 3 }));
	});

	return (
		<Stage units={10}>
			<Sankey
				data={flows}
				source="from"
				target="to"
				value="twh"
				width={7}
				height={4}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
