import { track, write } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { MathTex } from "@sophistry/solidjs/text";
import type { MathTexNode } from "@sophistry/text";
import { onSettled } from "solid-js";

export const meta = {
	title: "Quadratic formula",
	description:
		"An equation and its solution are written out one after the other with write().",
	uses: ["Stage", "MathTex", "track", "write", "usePlayer"],
};

export default function QuadraticFormula() {
	const { play } = usePlayer();
	const equation = track(0);
	const solution = track(0);

	// Wait for both formulas to be typeset before writing them out.
	const formulas: MathTexNode[] = [];
	onSettled(() => {
		// `ready()` rejects (AbortError) if the scene goes away first.
		void Promise.all(formulas.map((f) => f.ready()))
			.then(() =>
				play(write([equation, solution], { duration: 2.5, lag: 0.8 })),
			)
			.catch(() => {});
	});

	return (
		<Stage units={10}>
			<MathTex
				tex="ax^2 + bx + c = 0"
				fontSize={0.65}
				progress={equation}
				ref={(f) => formulas.push(f)}
				y={1.6}
			/>
			<MathTex
				tex="x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
				fontSize={0.75}
				progress={solution}
				ref={(f) => formulas.push(f)}
				y={-0.6}
			/>
		</Stage>
	);
}
