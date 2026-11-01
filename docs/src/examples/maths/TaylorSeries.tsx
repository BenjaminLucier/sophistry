import { BLUE, GREEN, ORANGE, RED, track, write } from "@sophistry/core";
import { Axes, FunctionGraph, Stage, usePlayer } from "@sophistry/solidjs";
import { MathTex } from "@sophistry/solidjs/text";
import { onSettled } from "solid-js";

export const meta = {
	title: "Taylor series",
	description:
		"Polynomial approximations of sin x of degree 1, 3, 5 and 7 are drawn in turn, each hugging the curve for longer.",
};

/** The Taylor polynomial of sin x with terms up to x^degree. */
const taylor = (degree: number) => (x: number) => {
	let sum = 0;
	let term = x;
	for (let n = 1; n <= degree; n += 2) {
		sum += term;
		term *= (-x * x) / ((n + 1) * (n + 2));
	}
	return sum;
};

const DEGREES = [1, 3, 5, 7];
const COLORS = [RED, ORANGE, GREEN, BLUE];

export default function TaylorSeries() {
	const { play } = usePlayer();
	const drawn = DEGREES.map(() => track(0));

	onSettled(() => {
		void play(write(drawn, { duration: 1.5, lag: 1.2 }));
	});

	return (
		<Stage units={14}>
			<MathTex
				tex="\sin x = x - \frac{x^3}{3!} + \frac{x^5}{5!} - \cdots"
				fontSize={0.5}
				y={3.1}
			/>
			<Axes
				xRange={[-7, 7, 2]}
				yRange={[-3, 3, 1]}
				width={11}
				height={5}
				center={{ x: 0, y: -0.6 }}
			>
				<FunctionGraph function={Math.sin} strokeWidth={0.07} />
				{DEGREES.map((degree, i) => (
					<FunctionGraph
						function={taylor(degree)}
						stroke={COLORS[i]}
						progress={drawn[i]}
					/>
				))}
			</Axes>
		</Stage>
	);
}
