import { draw, moveTo, track, trackPoint } from "@sophistry/core";
import { Circle, Dot, Text, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Unit circle",
	description:
		"Draw a circle with draw(), then send a dot around it with moveTo().",
};

export default function UnitCircle() {
	const { play, signal } = usePlayer();
	const drawn = track(0);
	const dot = trackPoint(2, 0);

	onSettled(() => {
		void (async () => {
			await play(draw(drawn, { duration: 1.5 }));
			while (!signal.aborted) {
				for (const at of [
					{ x: 0, y: 2 },
					{ x: -2, y: 0 },
					{ x: 0, y: -2 },
					{ x: 2, y: 0 },
				]) {
					// A quarter-turn arc, at a steady speed: round the circle, not
					// across its chords, without stopping at each quarter.
					await play(
						moveTo(dot, at, {
							duration: 1,
							pathArc: Math.PI / 2,
							easing: "linear",
						}),
					);
				}
			}
		})();
	});

	return (
		<Stage units={10}>
			<Circle center={{ x: 0, y: 0 }} radius={2} progress={drawn} />
			{/* Both arrive with the circle they belong to. */}
			<Dot center={dot} opacity={drawn} />
			<Text text="unit circle" y={0} opacity={drawn} />
		</Stage>
	);
}
