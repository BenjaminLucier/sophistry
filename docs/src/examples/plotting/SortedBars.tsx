import { createSlots, derive, hold, sequence } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Sorting bars with slots",
	description:
		"A slots model owns the order; the chart's band axis reads each category's slot through `slot`, so bars and their names slide together. Each sort is one seekable `permute`, staggered.",
	uses: [
		"Stage",
		"Chart",
		"Bars",
		"createSlots",
		"derive",
		"sequence",
		"hold",
		"usePlayer",
	],
};

const fruit = [
	{ name: "fig", sold: 4 },
	{ name: "kiwi", sold: 9 },
	{ name: "lime", sold: 2 },
	{ name: "pear", sold: 7 },
	{ name: "plum", sold: 5 },
	{ name: "yuzu", sold: 8 },
];
const names = fruit.map((d) => d.name);
const bySales = [...fruit].sort((a, b) => b.sold - a.sold).map((d) => d.name);

export default function SortedBars() {
	const { play, signal } = usePlayer();
	// Slot i laid out at x = i: the chart turns slots into band positions.
	const slots = createSlots(names, {
		layout: (i) => ({ x: i, y: 0 }),
		duration: 0.7,
		lag: 0.08,
	});
	// The axis rebuilds whenever any slot position moves.
	const xAxis = derive(
		names.flatMap((name) => slots.item(name)?.position ?? []),
		() => ({
			slot: (key: string | number) =>
				slots.item(String(key))?.position.peek().x,
		}),
	);
	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(sequence(hold(0.8), slots.plan().permute(bySales)));
				await play(sequence(hold(1.2), slots.plan().permute(names)));
			}
		})();
	});

	return (
		<Stage units={10}>
			<Chart width={8} height={4} yLabel="sold" xAxis={xAxis}>
				<Bars data={fruit} category="name" value="sold" labels />
			</Chart>
		</Stage>
	);
}
