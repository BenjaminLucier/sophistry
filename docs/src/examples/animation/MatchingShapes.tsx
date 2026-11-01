import { hold, sequence, track, valueTo } from "@sophistry/core";
import type { ShapePart } from "@sophistry/core/geometry";
import { circlePolyline, rectPolyline } from "@sophistry/core/geometry";
import { Stage, TransformMatchingShapes, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Matching shapes",
	description:
		"A square and a circle become a larger circle and a long bar. TransformMatchingShapes pairs each shape with the one it most resembles, so nothing crosses over.",
};

const FROM: ShapePart[] = [
	{ polylines: [rectPolyline(-3.5, -1, 2, 2)] },
	{ polylines: [circlePolyline(2.5, 0, 1)] },
];
const TO: ShapePart[] = [
	{ polylines: [circlePolyline(-2.5, 0, 1.4)] },
	{ polylines: [rectPolyline(1, -0.5, 3.5, 1)] },
];

export default function MatchingShapes() {
	const { play, signal } = usePlayer();
	const blend = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						hold(0.8),
						valueTo(blend, 1, { duration: 1.6 }),
						hold(0.8),
						valueTo(blend, 0, { duration: 1.6 }),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<TransformMatchingShapes from={FROM} to={TO} blend={blend} />
		</Stage>
	);
}
