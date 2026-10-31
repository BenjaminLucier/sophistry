import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Bars, Chart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Horizontal bars",
	description:
		"<Bars> on a categorical y axis: names laid out top-down, bars growing from zero one after another, values counting up. Hover a bar.",
	uses: ["Stage", "Chart", "Bars", "track", "draw", "usePlayer"],
};

const langs = [
	{ name: "TypeScript", share: 38 },
	{ name: "Python", share: 31 },
	{ name: "Rust", share: 14 },
	{ name: "Go", share: 11 },
	{ name: "Zig", share: 3 },
];

export default function HorizontalBars() {
	const { play } = usePlayer();
	const shown = track(0);

	onSettled(() => {
		void play(draw(shown, { duration: 2 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={7}
				height={4.5}
				center={{ x: 0.6, y: 0 }}
				xAxis={{ tickFormat: (v) => `${v}%` }}
				grid="x"
				progress={shown}
			>
				<Bars
					data={langs}
					category="name"
					value="share"
					orientation="horizontal"
					labels={(d) => `${d.share}%`}
					stagger={0.5}
					tooltip
				/>
			</Chart>
		</Stage>
	);
}
