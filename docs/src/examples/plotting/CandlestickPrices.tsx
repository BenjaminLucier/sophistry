import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Candlestick, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Candlesticks",
	description:
		"Prices on a time axis (inferred from Dates): each wick draws low to high, then the body grows from the open to the close.",
	uses: ["Stage", "Chart", "Candlestick", "track", "draw", "usePlayer"],
};

// A deterministic random walk, one candle per day.
const days = Array.from({ length: 20 }, (_, i) => i).reduce<
	{ t: Date; o: number; h: number; l: number; c: number }[]
>((list, i) => {
	const open = list.at(-1)?.c ?? 100;
	const close = open + Math.sin(i * 1.7) * 3 + Math.cos(i * 0.6) * 1.5;
	const high = Math.max(open, close) + 1 + Math.abs(Math.sin(i * 2.3)) * 2;
	const low = Math.min(open, close) - 1 - Math.abs(Math.cos(i * 1.1)) * 2;
	list.push({
		t: new Date(Date.UTC(2026, 2, 2 + i)),
		o: open,
		h: high,
		l: low,
		c: close,
	});
	return list;
}, []);

export default function CandlestickPrices() {
	const { play } = usePlayer();
	const shown = track(0);

	onSettled(() => {
		void play(draw(shown, { duration: 3 }));
	});

	return (
		<Stage units={13}>
			<Chart width={10} height={4.5} grid="y" progress={shown}>
				<Candlestick
					data={days}
					x="t"
					open="o"
					high="h"
					low="l"
					close="c"
					stagger={0.7}
					tooltip
				/>
			</Chart>
		</Stage>
	);
}
