import { hold, morph, track } from "@sophistry/core";
import {
	circlePolyline,
	rectPolyline,
	starPolygon,
} from "@sophistry/core/geometry";
import { Polygon, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

const CIRCLE = circlePolyline(0, 0, 2);
const SQUARE = rectPolyline(-1.8, -1.8, 3.6, 3.6);
const STAR = starPolygon(0, 0, 2, 0.9, 5);

/** One polyline track morphed circle → square → star → circle. */
export function MorphDemo() {
	const shape = track(CIRCLE);
	const player = usePlayer();

	onSettled(() => {
		void (async () => {
			for (const to of [SQUARE, STAR, CIRCLE]) {
				await player.play(morph(shape, to, { closed: true, duration: 1.2 }));
				await player.play(hold(0.4));
			}
		})();
	});

	return (
		<Stage units={8}>
			<Polygon points={shape} />
		</Stage>
	);
}
