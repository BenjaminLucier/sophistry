import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Chart, TriContour, Tripcolor } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Contours from scattered samples",
	description:
		"Readings at scattered stations, triangulated: after the frame, the faces fade in as a wave from the top-left while the contour lines draw level by level, lowest first.",
	uses: [
		"Stage",
		"Chart",
		"Tripcolor",
		"TriContour",
		"track",
		"draw",
		"usePlayer",
	],
};

// 90 stations on a sunflower spiral (no grid), each reading a smooth field.
const stations = Array.from({ length: 90 }, (_, i) => {
	const r = Math.sqrt((i + 0.5) / 90);
	const x = 3 * r * Math.cos(i * 2.4);
	const y = 2 * r * Math.sin(i * 2.4);
	return { x, y, temp: Math.sin(x * 1.2) * Math.cos(y) + 0.3 * x };
});

export default function TriangulatedField() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 3 }));
	});

	return (
		<Stage units={12}>
			<Chart
				width={7.5}
				height={5}
				progress={progress}
				axis={{ position: "edge" }}
			>
				<Tripcolor
					data={stations}
					x="x"
					y="y"
					value="temp"
					ramp="viridis"
					stroke="white"
					strokeWidth={0.008}
				/>
				<TriContour
					data={stations}
					x="x"
					y="y"
					value="temp"
					levels={6}
					stroke="white"
				/>
			</Chart>
		</Stage>
	);
}
