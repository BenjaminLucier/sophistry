import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { BarChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Bar chart reveal",
	description: "A bar chart whose bars grow in as draw() drives its progress.",
};

export default function BarChartReveal() {
	const { play } = usePlayer();
	const progress = track(0);

	onSettled(() => {
		void play(draw(progress, { duration: 1.5 }));
	});

	return (
		<Stage units={10}>
			<BarChart
				data={[3, 7, 4, 9, 6]}
				label={(_, i) => "abcde"[i]}
				yRange={[0, 10, 2]}
				width={8}
				height={4}
				progress={progress}
			/>
		</Stage>
	);
}
