import {
	derive,
	draw,
	parallel,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, RangeBrush, Scatter } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Brushing a box on both axes",
	description:
		"A two-dimensional brush on the left selects a box of the cloud and the chart on the right zooms to it. Drag the box, an edge or a corner, or Tab to it and use the arrow keys; the four tracks it writes are the right chart's ranges, animated here.",
};

const hash = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
const cloud = Array.from({ length: 160 }, (_, i) => {
	const a = hash(i + 1) * Math.PI * 2;
	const r = 1 + 3 * hash(i + 400);
	return { x: 5 + r * Math.cos(a), y: 5 + 0.6 * r * Math.sin(a) + hash(i) };
});

export default function BoxBrush() {
	const { play } = usePlayer();
	const shown = track(0);
	const x = [track(2), track(5)] as const;
	const y = [track(4), track(6.5)] as const;
	onSettled(() => {
		void play(
			sequence(
				draw(shown, { duration: 1.5 }),
				parallel(
					valueTo(x[0], 5, { duration: 1.4 }),
					valueTo(x[1], 8.5, { duration: 1.4 }),
					valueTo(y[0], 3, { duration: 1.4 }),
				),
			),
		);
	});

	return (
		<Stage units={12}>
			<Chart
				width={4.6}
				height={4.6}
				center={{ x: -3, y: -0.2 }}
				progress={shown}
			>
				<Scatter data={cloud} x="x" y="y" radius={0.04} />
				<RangeBrush x={x} y={y} label="selection" />
			</Chart>
			<Chart
				width={4.6}
				height={4.6}
				center={{ x: 3.2, y: -0.2 }}
				xRange={derive(x, (low, high) => [low, high])}
				yRange={derive(y, (low, high) => [low, high])}
				clip
				progress={shown}
			>
				<Scatter data={cloud} x="x" y="y" radius={0.07} />
			</Chart>
		</Stage>
	);
}
