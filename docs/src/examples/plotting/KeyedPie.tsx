import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { PieChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Keyed pie morph",
	description:
		"One blend track joins two years of browser share by name: IE's slice closes and its neighbours take the room, the shares change in data space, then Edge opens where the new year has it. Every frame is a whole pie.",
	uses: [
		"Stage",
		"PieChart",
		"track",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
};

const before = [
	{ name: "Chrome", share: 45 },
	{ name: "IE", share: 25 },
	{ name: "Firefox", share: 20 },
	{ name: "Safari", share: 10 },
];
const after = [
	{ name: "Chrome", share: 64 },
	{ name: "Edge", share: 5 },
	{ name: "Firefox", share: 8 },
	{ name: "Safari", share: 19 },
];

export default function KeyedPie() {
	const { play, signal } = usePlayer();
	const blend = track(0);
	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.6),
						// Staged transitions ease each stage themselves: drive them linearly.
						valueTo(blend, 1, { duration: 2.4, easing: "linear" }),
						hold(0.8),
						valueTo(blend, 0, { duration: 2.4, easing: "linear" }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={11}>
			<PieChart
				data={before}
				to={after}
				blend={blend}
				value="share"
				label="name"
				radius={2.6}
				innerRadius={1.1}
				labelFontSize={0.26}
			/>
		</Stage>
	);
}
