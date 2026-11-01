import { okabeIto } from "@sophistry/charts";
import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Keyed scatter update",
	description:
		"One blend track joins two datasets by key: Lima shrinks away where it stood, the fitted y axis grows, matched cities move in data space, then Oslo grows in. Played forward, then scrubbed back.",
};

const before = [
	{ city: "Accra", region: "Africa", income: 2.1, life: 61 },
	{ city: "Dhaka", region: "Asia", income: 1.6, life: 70 },
	{ city: "Hanoi", region: "Asia", income: 3.4, life: 72 },
	{ city: "Lima", region: "Americas", income: 6.6, life: 74 },
	{ city: "Nairobi", region: "Africa", income: 2.0, life: 63 },
];
const after = [
	{ city: "Accra", region: "Africa", income: 4.4, life: 66 },
	{ city: "Dhaka", region: "Asia", income: 2.7, life: 73 },
	{ city: "Hanoi", region: "Asia", income: 8.3, life: 76 },
	{ city: "Nairobi", region: "Africa", income: 3.1, life: 67 },
	{ city: "Oslo", region: "Europe", income: 9.5, life: 83 },
];

export default function KeyedScatter() {
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
		<Stage units={12}>
			<Chart
				width={10}
				height={4.4}
				clip
				grid
				xLabel="income"
				yLabel="life"
				color={{
					range: okabeIto,
					domain: ["Africa", "Asia", "Americas", "Europe"],
				}}
			>
				<Scatter
					data={before}
					to={after}
					blend={blend}
					key="city"
					x="income"
					y="life"
					series="region"
					radius={0.14}
				/>
			</Chart>
		</Stage>
	);
}
