import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Sunburst } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Sunburst",
	description:
		"A sunburst of a monthly budget, revealed by one clockwise sweep from 12 o'clock.",
	uses: ["Stage", "Sunburst", "track", "draw", "usePlayer"],
};

type Item = { name: string; cost?: number; children?: Item[] };

const budget: Item = {
	name: "Budget",
	children: [
		{
			name: "Home",
			children: [
				{ name: "Rent", cost: 1200 },
				{ name: "Power", cost: 150 },
				{ name: "Net", cost: 60 },
			],
		},
		{
			name: "Food",
			children: [
				{ name: "Shop", cost: 420 },
				{ name: "Out", cost: 180 },
			],
		},
		{
			name: "Travel",
			children: [
				{ name: "Train", cost: 120 },
				{ name: "Bike", cost: 40 },
			],
		},
		{ name: "Save", cost: 500 },
	],
};

export default function SunburstExample() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2 }));
	});

	return (
		<Stage units={10}>
			<Sunburst
				data={budget}
				value="cost"
				label="name"
				radius={2.6}
				labelFontSize={0.18}
				progress={progress}
				tooltip
			/>
		</Stage>
	);
}
