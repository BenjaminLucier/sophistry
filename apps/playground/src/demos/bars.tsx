import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { BarChart } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

/**
 * A bar chart revealed by one `progress` track.
 * The track itself is the prop (it binds in core).
 */
export function BarsDemo() {
	const progress = track(0);
	const player = usePlayer();

	onSettled(() => {
		void player.play(draw(progress, { duration: 1.5 }));
	});

	return (
		<Stage units={10}>
			<BarChart
				data={[3, 7, 4, 9, 6]}
				label={(_, i) => "abcde"[i]}
				yRange={[0, 10, 2]}
				width={8}
				height={4}
				center={{ x: -4, y: -2 }}
				progress={progress}
			/>
		</Stage>
	);
}
