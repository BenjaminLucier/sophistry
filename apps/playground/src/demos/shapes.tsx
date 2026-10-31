import { draw, moveTo, track, trackPoint } from "@sophistry/core";
import { Circle, Dot, Label, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

/**
 * A circle drawn on, a dot walking round it, a
 * caption. Tracks are passed as props (they bind in core, no Solid work per
 * frame); runs go through `usePlayer()` so they stop on unmount.
 */
export function ShapesDemo() {
	const drawn = track(0);
	const dot = trackPoint(2, 0);
	const player = usePlayer();

	onSettled(() => {
		void (async () => {
			await player.play(draw(drawn, { duration: 1.5 }));
			await player.play(moveTo(dot, { x: 0, y: 2 }, { duration: 1 }));
			await player.play(moveTo(dot, { x: -2, y: 0 }, { duration: 1 }));
			await player.play(moveTo(dot, { x: 0, y: -2 }, { duration: 1 }));
			await player.play(moveTo(dot, { x: 2, y: 0 }, { duration: 1 }));
		})();
	});

	return (
		<Stage units={8}>
			<Circle center={{ x: 0, y: 0 }} radius={2} progress={drawn} />
			<Dot center={dot} />
			<Label text="unit circle" y={-3.2} />
		</Stage>
	);
}
