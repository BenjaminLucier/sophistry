import { okabeIto } from "@sophistry/charts";
import { hold, sequence, track, valueTo } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { BoxPlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Keyed box plot update",
	description:
		"One blend track joins two years of trial arms by name: placebo closes into its median, the fitted axis grows, the matched arms' quartiles and whiskers move in data units, then a new arm opens. Played forward, then scrubbed back.",
	uses: [
		"Stage",
		"BoxPlot",
		"track",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
};

// A deterministic "uniform" in [0, 1): the fractional part of a sine hash.
const unit = (n: number) => {
	const v = Math.sin(n * 12.9898) * 43758.5453;
	return v - Math.floor(v);
};
// Deterministic, roughly bell-shaped samples: sums of four such uniforms.
const sample = (seed: number, center: number, spread: number, n = 40) =>
	Array.from({ length: n }, (_, i) => {
		let sum = 0;
		for (let k = 1; k <= 4; k++) sum += unit((i + 1) * 4 + k + seed * 997);
		return center + (sum - 2) * spread;
	});

const before = [
	{ arm: "placebo", scores: sample(1, 4, 2) },
	{ arm: "dose A", scores: [...sample(2, 6, 1.5), 11] },
	{ arm: "dose B", scores: sample(3, 5, 2.5) },
];
const after = [
	{ arm: "dose A", scores: sample(4, 8, 1.5) },
	{ arm: "dose B", scores: [...sample(5, 9, 2), 15.5] },
	{ arm: "dose C", scores: sample(6, 11, 2) },
];

/** One colour per arm, so an arm keeps its colour as it changes place. */
const colors: Record<string, string> = {
	placebo: okabeIto[7],
	"dose A": okabeIto[0],
	"dose B": okabeIto[2],
	"dose C": okabeIto[5],
};
const armColor = (d: { arm: string }) => colors[d.arm];

export default function KeyedBoxes() {
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
			<BoxPlot
				data={before}
				to={after}
				blend={blend}
				values="scores"
				label="arm"
				color={armColor}
				width={8}
				height={4.4}
			/>
		</Stage>
	);
}
