import { forever, moveAlong, trackPoint } from "@sophistry/core";
import { circlePolyline } from "@sophistry/core/geometry";
import { Circle, Dot, Line, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Point moving on a shape",
	description:
		"A dot travels around a circle at constant speed by following the circle's outline with moveAlong.",
	uses: [
		"Stage",
		"Circle",
		"Dot",
		"Line",
		"trackPoint",
		"circlePolyline",
		"moveAlong",
		"forever",
		"usePlayer",
	],
};

const RING = circlePolyline(0, 0, 2.2);

export default function PointMovingOnShapes() {
	const { play } = usePlayer();
	const dot = trackPoint(2.2, 0);

	onSettled(() => {
		void play(forever(moveAlong(dot, RING, { duration: 4 })));
	});

	return (
		<Stage units={9}>
			<Circle radius={2.2} />
			<Line from={{ x: 0, y: 0 }} to={dot} dash={[0.15, 0.1]} />
			<Dot center={dot} radius={0.15} />
		</Stage>
	);
}
