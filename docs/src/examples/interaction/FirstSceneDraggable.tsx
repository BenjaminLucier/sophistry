import {
	angleParam,
	derive,
	draggable,
	draw,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import {
	Arc,
	Circle,
	Dot,
	Label,
	Line,
	Stage,
	usePlayer,
	useTheme,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "First scene: make it draggable",
	description:
		"Step three of the first-scene tutorial: the same theta track that the animation writes is now also written by dragging the dot around the ring.",
	uses: [
		"Stage",
		"Circle",
		"Line",
		"Arc",
		"Dot",
		"Label",
		"track",
		"derive",
		"draw",
		"valueTo",
		"sequence",
		"usePlayer",
		"draggable",
		"angleParam",
		"useTheme",
	],
};

const R = 2.4;

function Scene() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const player = usePlayer();
	const drawn = track(0);
	const theta = track(0);
	const tip = derive(theta, (angle) => ({
		x: R * Math.cos(angle),
		y: R * Math.sin(angle),
	}));
	const degrees = derive(theta, (angle) => Math.round((angle * 180) / Math.PI));

	onSettled(() => {
		void player.play(
			sequence(
				draw(drawn, { duration: 1.2 }),
				valueTo(theta, 1.1, { duration: 1.6, easing: "smooth" }),
			),
		);
	});

	return (
		<>
			<Circle radius={R} stroke={palette().grid} progress={drawn} />
			<Line from={{ x: 0, y: 0 }} to={tip} stroke={palette().series[0]} />
			<Arc radius={0.8} angle={theta} stroke={palette().series[1]} />
			<Dot
				center={tip}
				radius={0.16}
				label="angle"
				{...draggable(theta, {
					param: angleParam({ x: 0, y: 0 }, { radius: R }),
				})}
			/>
			{/* Beside the circle: below it would fall off the 16:9 stage. */}
			<Label
				text={derive(degrees, (value) => `θ = ${value}°`)}
				x={3.8}
				y={-2.2}
				color={palette().muted}
			/>
		</>
	);
}

export default function FirstSceneDraggable() {
	return (
		<Stage units={10}>
			<Scene />
		</Stage>
	);
}
