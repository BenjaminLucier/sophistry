import { draw, track } from "@sophistry/core";
import { Axes, Stage, usePlayer } from "@sophistry/solidjs";
import { LinePlot } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

const POINTS = [4, 12, 24, 40, 51, 68, 75, 82, 90, 96, 99].map((y, x) => ({
	x,
	y,
}));

/** A `LinePlot` inside core's `Axes`, drawn on by `progress`. */
export function LinePlotDemo() {
	const progress = track(0);
	const player = usePlayer();

	onSettled(() => {
		void player.play(draw(progress, { duration: 2 }));
	});

	return (
		<Stage units={10}>
			<Axes xRange={[0, 10]} yRange={[0, 100]} width={8} height={5}>
				<LinePlot data={POINTS} x="x" y="y" progress={progress} />
			</Axes>
		</Stage>
	);
}
