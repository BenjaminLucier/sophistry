import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { PieChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

/** A labelled pie chart revealed by one `progress` track. */
export function PieDemo() {
	const progress = track(0);
	const player = usePlayer();

	onSettled(() => {
		void player.play(draw(progress, { duration: 1.5 }));
	});

	return (
		<Stage units={10}>
			<PieChart
				data={[
					{ language: "rust", share: 14 },
					{ language: "typescript", share: 26 },
					{ language: "python", share: 22 },
					{ language: "go", share: 38 },
				]}
				value="share"
				label="language"
				radius={3.6}
				progress={progress}
			/>
		</Stage>
	);
}
