import { derive, forever, sequence, track, valueTo } from "@sophistry/core";
import { Angle, Dot, Line, Stage, Text, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Moving angle",
	description:
		"One ray swings around a fixed one while an Angle arc and a Text readout follow it, all driven by a single tracked number.",
};

const VERTEX = { x: -1.75, y: -1.5 };
const FIXED = { x: 1.75, y: -1.5 };
const LENGTH = 3.5;

export default function MovingAngle() {
	const { play } = usePlayer();
	const theta = track(0.4);
	const tip = derive(theta, (theta) => ({
		x: VERTEX.x + LENGTH * Math.cos(theta),
		y: VERTEX.y + LENGTH * Math.sin(theta),
	}));

	onSettled(() => {
		void play(
			forever(
				sequence(
					valueTo(theta, 2.4, { duration: 2.5 }),
					valueTo(theta, 0.4, { duration: 2.5 }),
				),
			),
		);
	});

	return (
		<Stage units={10}>
			<Line from={VERTEX} to={FIXED} />
			<Line from={VERTEX} to={tip} />
			<Dot center={tip} radius={0.12} />
			<Angle vertex={VERTEX} from={FIXED} to={tip} radius={0.9} />
			<Text
				text={derive(
					theta,
					(theta) => `θ = ${Math.round((theta * 180) / Math.PI)}°`,
				)}
				x={-4.5}
				align="left"
				y={2.2}
				fontSize={0.6}
			/>
		</Stage>
	);
}
