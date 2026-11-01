import { derive, track, valueTo } from "@sophistry/core";
import {
	Axes,
	FunctionGraph,
	Label,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Fourier square wave",
	description:
		"Adding odd sine harmonics one at a time turns a plain sine wave into a square wave.",
};

/** Partial Fourier sum of a square wave: (4/pi) * sum of sin((2k-1)x) / (2k-1). */
const squareWave = (harmonics: number) => (x: number) => {
	let sum = 0;
	for (let k = 1; k <= harmonics; k++) {
		sum += Math.sin((2 * k - 1) * x) / (2 * k - 1);
	}
	return (4 / Math.PI) * sum;
};

export default function FourierSquareWave() {
	const { play } = usePlayer();
	const harmonics = track(1);
	const count = derive(harmonics, Math.round);

	onSettled(() => {
		void play(valueTo(harmonics, 25, { duration: 8, easing: "linear" }));
	});

	return (
		<Stage units={14}>
			<Axes
				xRange={[-7, 7, 2]}
				yRange={[-2, 2, 1]}
				width={11}
				height={5}
				center={{ x: 0, y: -0.4 }}
			>
				<FunctionGraph function={derive(count, squareWave)} samples={600} />
			</Axes>
			<Label
				text={derive(
					count,
					(n) => `${n} ${n === 1 ? "harmonic" : "harmonics"}`,
				)}
				y={3.2}
			/>
		</Stage>
	);
}
