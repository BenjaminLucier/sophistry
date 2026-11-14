import { draw, RED, TEAL, track } from "@sophistry/core";
import {
	Axes,
	FunctionGraph,
	Text,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Sine and cosine",
	description:
		"Plot two functions on one set of axes and draw them in with draw().",
};

export default function SinAndCosFunctionPlot() {
	const { play } = usePlayer();
	const drawn = track(0);

	onSettled(() => {
		void play(draw(drawn, { duration: 2.5 }));
	});

	return (
		<Stage units={14}>
			<Axes xRange={[-7, 7, 1]} yRange={[-1.5, 1.5, 0.5]} width={12} height={4}>
				<FunctionGraph function={Math.sin} stroke={RED} progress={drawn} />
				<FunctionGraph function={Math.cos} stroke={TEAL} progress={drawn} />
			</Axes>
			<Text text="sin x" x={2} y={2.6} color={RED} />
			<Text text="cos x" x={-0.6} y={2.6} color={TEAL} />
		</Stage>
	);
}
