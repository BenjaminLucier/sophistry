import { okabeIto } from "@sophistry/charts";
import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Keyed bubbles with a staggered entrance",
	description:
		"Bubbles sized by population through the `size` channel (area ∝ value), keyed by the frame's size legend, blend to a later year by key: Lima shrinks away, the others move and resize, then three new cities grow in one after another, left to right (`enterStagger`). Only the entrance is staggered; the moves stay together, so they are easy to follow.",
};

const before = [
	{ city: "Accra", region: "Africa", income: 2.1, life: 61, pop: 2.5 },
	{ city: "Dhaka", region: "Asia", income: 1.6, life: 70, pop: 10 },
	{ city: "Hanoi", region: "Asia", income: 3.4, life: 72, pop: 4 },
	{ city: "Lima", region: "Americas", income: 6.6, life: 74, pop: 9 },
	{ city: "Nairobi", region: "Africa", income: 2.0, life: 63, pop: 3.5 },
];
const after = [
	{ city: "Accra", region: "Africa", income: 4.4, life: 66, pop: 4 },
	{ city: "Dhaka", region: "Asia", income: 2.7, life: 73, pop: 16 },
	{ city: "Hanoi", region: "Asia", income: 8.3, life: 76, pop: 6 },
	{ city: "Nairobi", region: "Africa", income: 3.1, life: 67, pop: 5 },
	{ city: "Oslo", region: "Europe", income: 9.5, life: 83, pop: 1 },
	{ city: "Quito", region: "Americas", income: 6.1, life: 77, pop: 2.8 },
	{ city: "Lagos", region: "Africa", income: 5.2, life: 62, pop: 15 },
];

export default function KeyedBubbles() {
	const { play, signal } = usePlayer();
	const blend = track(0);
	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.6),
						// Staged transitions ease each stage themselves: drive them linearly.
						valueTo(blend, 1, { duration: 3, easing: "linear" }),
						hold(0.8),
						valueTo(blend, 0, { duration: 3, easing: "linear" }),
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
				// A size key for `size`, under the legend: two reference circles.
				sizeLegend={{ title: "pop (M)", values: [4, 16] }}
			>
				<Scatter
					data={before}
					to={after}
					blend={blend}
					key="city"
					x="income"
					y="life"
					series="region"
					size="pop"
					sizeRange={[0, 0.42]}
					sizeMaxValue={16}
					enterStagger={0.6}
					fillOpacity={0.85}
				/>
			</Chart>
		</Stage>
	);
}
