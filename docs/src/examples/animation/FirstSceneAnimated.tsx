import { derive, draw, sequence, track, valueTo } from "@sophistry/core";
import {
	Arc,
	Circle,
	Dot,
	Line,
	Stage,
	Text,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "First scene: animate with a player",
	description:
		"Step two of the first-scene tutorial: tracks drive the ring, the radius and the angle, and usePlayer runs the script on the stage clock.",
};

const RADIUS = 2.4;
const THETA = 1.1;

function Scene() {
	const theme = useScene().theme;
	const palette = derive(theme, (t) => t.palette);
	const { play } = usePlayer();
	const drawn = track(0);
	const theta = track(0);
	const tip = derive(theta, (theta) => ({
		x: RADIUS * Math.cos(theta),
		y: RADIUS * Math.sin(theta),
	}));

	onSettled(() => {
		void play(
			sequence(
				draw(drawn, { duration: 1.2 }),
				valueTo(theta, THETA, { duration: 1.6, easing: "smooth" }),
			),
		);
	});

	return (
		<>
			<Circle
				radius={RADIUS}
				stroke={derive(palette, (p) => p.grid)}
				progress={drawn}
			/>
			<Line
				from={{ x: 0, y: 0 }}
				to={tip}
				stroke={derive(palette, (p) => p.series[0])}
			/>
			<Arc
				radius={0.8}
				angle={theta}
				stroke={derive(palette, (p) => p.series[1])}
			/>
			{/* On the angle's bisector, fading in as the angle opens. */}
			<Text
				text="θ"
				x={derive(theta, (theta) => 1.15 * Math.cos(theta / 2))}
				y={derive(theta, (theta) => 1.15 * Math.sin(theta / 2))}
				opacity={derive(theta, (theta) => Math.min(1, theta / THETA))}
				color={derive(palette, (p) => p.series[1])}
			/>
			<Dot center={tip} />
		</>
	);
}

export default function FirstSceneAnimated() {
	return (
		<Stage units={10}>
			<Scene />
		</Stage>
	);
}
