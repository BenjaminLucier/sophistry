import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Waterfall } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Waterfall",
	description:
		"How a starting figure became a final one: each change grows from where the last left off.",
	uses: ["Stage", "Waterfall", "track", "draw", "usePlayer"],
};

const quarter = [
	{ name: "Q1 start", change: 120 },
	{ name: "Sales", change: 64 },
	{ name: "Services", change: 22 },
	{ name: "Refunds", change: -18 },
	{ name: "Salaries", change: -71 },
	{ name: "Rent", change: -24 },
	{ name: "Q1 end", change: 0, total: true },
];

export default function WaterfallSteps() {
	const { play } = usePlayer();
	const shown = track(0);

	onSettled(() => {
		void play(draw(shown, { duration: 3.5 }));
	});

	return (
		<Stage units={13}>
			<Waterfall
				data={quarter}
				value="change"
				label="name"
				total={(d) => d.total === true}
				width={10}
				height={4.5}
				progress={shown}
				tooltip
			/>
		</Stage>
	);
}
