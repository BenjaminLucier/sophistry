import { hold, morph, track } from "@sophistry/core";
import {
	circlePolyline,
	rectPolyline,
	starPolygon,
} from "@sophistry/core/geometry";
import { Polygon, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Morph shapes",
	description: "A circle morphs into a square, a star, and back again.",
};

const CIRCLE = circlePolyline(0, 0, 2);
const SQUARE = rectPolyline(-1.8, -1.8, 3.6, 3.6);
const STAR = starPolygon(0, 0, 2, 0.9, 5);

export default function MorphShapes() {
	const { play, signal } = usePlayer();
	const shape = track(CIRCLE);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				for (const to of [SQUARE, STAR, CIRCLE]) {
					await play(morph(shape, to, { closed: true, duration: 1.2 }));
					await play(hold(0.4));
				}
			}
		})();
	});

	return (
		<Stage units={9}>
			<Polygon points={shape} />
		</Stage>
	);
}
