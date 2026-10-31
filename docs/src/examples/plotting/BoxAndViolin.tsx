import { draw, track } from "@sophistry/core";
import { Label, Stage, usePlayer } from "@sophistry/solidjs";
import { BoxPlot, ViolinPlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Box and violin plots",
	description:
		"The same three samples summarised two ways: quartile boxes that open out of their medians, and kernel-density violins that widen out of their centre lines.",
	uses: [
		"Stage",
		"Label",
		"BoxPlot",
		"ViolinPlot",
		"track",
		"draw",
		"usePlayer",
	],
};

// Deterministic, roughly bell-shaped samples: sums of a few sine-hash "uniforms".
const sample = (seed: number, center: number, spread: number, n = 60) =>
	Array.from({ length: n }, (_, i) => {
		let sum = 0;
		for (let k = 1; k <= 4; k++) {
			sum += (Math.sin((i + 1) * k * 12.9898 + seed * 78.233) + 1) / 2;
		}
		return center + (sum - 2) * spread;
	});

const groups = [
	{ name: "control", values: sample(1, 5, 2) },
	{ name: "dose A", values: [...sample(2, 7, 1.5), 12.5] },
	{ name: "dose B", values: sample(3, 6, 3) },
];

export default function BoxAndViolin() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 2.5 }));
	});

	return (
		<Stage units={16}>
			<BoxPlot
				data={groups}
				values="values"
				label="name"
				yRange={[0, 14, 2]}
				width={6}
				height={4.2}
				center={{ x: -4.2, y: 0 }}
				progress={progress}
				stagger={0.4}
			/>
			<ViolinPlot
				data={groups}
				values="values"
				label="name"
				yRange={[0, 14, 2]}
				width={6}
				height={4.2}
				center={{ x: 4.2, y: 0 }}
				progress={progress}
				stagger={0.4}
			/>
			<Label text="BoxPlot" x={-4.2} y={-3.2} fontSize={0.4} />
			<Label text="ViolinPlot" x={4.2} y={-3.2} fontSize={0.4} />
		</Stage>
	);
}
