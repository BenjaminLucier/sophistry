import { okabeIto } from "@sophistry/charts";
import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Beeswarm, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Keyed beeswarm update",
	description:
		"Week 1 to week 6 of a trial on one blend track: participants who drop out shrink away, everyone else slides from their place in the first swarm to their place in the second (both ends packed), then a new arm's band opens and its dots grow in.",
	uses: [
		"Stage",
		"Chart",
		"Beeswarm",
		"okabeIto",
		"track",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
};

/** A participant's own spread around their arm's mean, the same every week. */
const spread = (id: number) => Math.sin(id * 12.9898) * 14;
const effect: Record<string, number> = { placebo: -2, "low dose": -10 };
const week1 = Array.from({ length: 40 }, (_, id) => ({
	id,
	arm: id % 2 ? "low dose" : "placebo",
	score: 50 + spread(id),
}));
const week6 = [
	// Every seventh participant drops out; the rest move by their arm's effect.
	...week1
		.filter((d) => d.id % 7 !== 3)
		.map((d) => ({ ...d, score: d.score + effect[d.arm] })),
	...Array.from({ length: 16 }, (_, k) => ({
		id: 100 + k,
		arm: "high dose",
		score: 34 + spread(100 + k),
	})),
];

export default function KeyedBeeswarm() {
	const { play } = usePlayer();
	const blend = track(0);
	onSettled(() => {
		// Staged transitions ease each stage themselves: drive them linearly.
		void play(
			sequence(hold(0.6), valueTo(blend, 1, { duration: 3, easing: "linear" })),
		);
	});

	return (
		<Stage units={12}>
			<Chart
				width={10}
				height={4.4}
				grid="y"
				// Pad the fitted range so the lowest dots clear the axis line.
				yAxis={{ margin: 0.05 }}
				yLabel="score"
				legend={false}
				color={{
					range: okabeIto,
					domain: ["placebo", "low dose", "high dose"],
				}}
			>
				<Beeswarm
					data={week1}
					to={week6}
					blend={blend}
					key="id"
					category="arm"
					value="score"
					series="arm"
					radius={0.09}
				/>
			</Chart>
		</Stage>
	);
}
