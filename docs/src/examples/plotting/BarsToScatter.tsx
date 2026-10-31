import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Bars into a scatter",
	description:
		"One blend track turns a bar chart into a scatter plot: the bars shrink away, the category axis cross-fades into a number line, and the dots on the bars' tops slide to their new places in scene units while the y axis glides to the new axis's zero. Played forward, then back.",
	uses: [
		"Stage",
		"Chart",
		"Bars",
		"Scatter",
		"track",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
};

const countries = [
	{ name: "Chile", life: 79, growth: 2.4 },
	{ name: "Ghana", life: 64, growth: 5.1 },
	{ name: "India", life: 70, growth: 6.8 },
	{ name: "Italy", life: 83, growth: -1.6 },
	{ name: "Peru", life: 76, growth: 3.3 },
];
// The dots sit on the bars' tops (slot `i` is centred at `i + 0.5`), then
// on a number line of GDP growth (%), which spans 0.
const onBars = countries.map((c, i) => ({
	name: c.name,
	x: i + 0.5,
	y: c.life,
}));
const spread = countries.map((c) => ({ name: c.name, x: c.growth, y: c.life }));

export default function BarsToScatter() {
	const { play, signal } = usePlayer();
	const blend = track(0);
	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.8),
						valueTo(blend, 1, { duration: 2.6, easing: "linear" }),
						hold(1.2),
						valueTo(blend, 0, { duration: 2.6, easing: "linear" }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={12}>
			<Chart width={9.4} height={4.4} yLabel="life expectancy">
				<Bars
					data={countries}
					to={[]}
					blend={blend}
					key="name"
					category="name"
					value="life"
				/>
				<Scatter
					data={onBars}
					to={spread}
					blend={blend}
					key="name"
					x="x"
					y="y"
					radius={0.13}
				/>
			</Chart>
		</Stage>
	);
}
