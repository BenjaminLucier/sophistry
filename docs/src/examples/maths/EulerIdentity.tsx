import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { MathTex } from "@sophistry/solidjs/text";
import type { MathTexNode } from "@sophistry/text";
import { onSettled } from "solid-js";

export const meta = {
	title: "Euler's identity",
	description:
		"LaTeX is geometry: two formulas are written out stroke by stroke.",
	uses: ["Stage", "MathTex", "track", "draw", "usePlayer"],
};

export default function EulerIdentity() {
	const { play } = usePlayer();
	const progress = track(0);

	// Typesetting is async: write only once both formulas exist, or the
	// reveal could run to its end before anything is on screen.
	const formulas: MathTexNode[] = [];
	onSettled(() => {
		// `ready()` rejects (AbortError) if the scene goes away first.
		void Promise.all(formulas.map((f) => f.ready()))
			.then(() => play(draw(progress, { duration: 2 })))
			.catch(() => {});
	});

	return (
		<Stage units={10}>
			<MathTex
				tex="e^{i\pi} + 1 = 0"
				fontSize={0.9}
				progress={progress}
				ref={(f) => formulas.push(f)}
				y={1.2}
			/>
			<MathTex
				tex="\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}"
				fontSize={0.7}
				progress={progress}
				ref={(f) => formulas.push(f)}
				y={-1.2}
			/>
		</Stage>
	);
}
