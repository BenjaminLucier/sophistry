import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, LinePlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Line morph in data space",
	description:
		"Each line morphs on one shared x grid, so values move vertically and a line that gains data grows at its end; the old forecast fades out, the new series sweeps in, and the axes rescale with them.",
};

const wave = (n: number, f: (x: number) => number) =>
	Array.from({ length: n }, (_, x) => f(x));
const rows = (name: string, ys: number[]) =>
	ys.map((y, month) => ({ name, month, y }));

const before = [
	...rows(
		"north",
		wave(7, (x) => 20 + 6 * Math.sin(x / 1.6)),
	),
	...rows(
		"south",
		wave(7, (x) => 12 + x * 1.5),
	),
	...rows(
		"forecast",
		wave(7, (x) => 16 + x),
	),
];
const after = [
	...rows(
		"north",
		wave(11, (x) => 24 + 10 * Math.sin(x / 1.8)),
	),
	...rows(
		"south",
		wave(11, (x) => 10 + x * 2.6),
	),
	...rows(
		"east",
		wave(11, (x) => 30 - x * 1.4),
	),
];

export default function LineMorph() {
	const { play, signal } = usePlayer();
	const blend = track(0);
	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.6),
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
			<Chart width={10} height={4.4} clip grid="y" xLabel="month">
				<LinePlot
					data={before}
					to={after}
					blend={blend}
					x="month"
					y="y"
					series="name"
					strokeWidth={0.05}
				/>
			</Chart>
		</Stage>
	);
}
