import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { MathTex } from "@sophistry/solidjs/text";
import type { MathTexNode } from "@sophistry/text";
import { onSettled } from "solid-js";

/** `ready()` rejects with an AbortError when the formula unmounts first. */
function ignoreAbort(error: unknown): void {
	if (error instanceof DOMException && error.name === "AbortError") return;
	throw error;
}

/**
 * Two formulas written on together once both are
 * typeset. `ref` hands over the node itself (a `MathTexNode`, whose
 * `ready()` resolves once it is typeset).
 */
export function MathDemo() {
	const progress = track(0);
	const player = usePlayer();

	// Typesetting is async: write once both formulas are ready.
	const formulas: MathTexNode[] = [];
	onSettled(() => {
		void Promise.all(formulas.map((formula) => formula.ready()))
			.then(() => player.play(draw(progress, { duration: 2 })))
			.catch(ignoreAbort);
	});

	return (
		<Stage units={10}>
			<MathTex
				tex="e^{i\pi} + 1 = 0"
				fontSize={0.9}
				progress={progress}
				ref={(formula) => formulas.push(formula)}
				y={1.2}
			/>
			<MathTex
				tex="\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}"
				fontSize={0.7}
				progress={progress}
				ref={(formula) => formulas.push(formula)}
				y={-1.2}
			/>
		</Stage>
	);
}
