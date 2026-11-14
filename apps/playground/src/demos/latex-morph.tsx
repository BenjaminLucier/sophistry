import { hold, track, valueTo } from "@sophistry/core";
import { Stage, Text, usePlayer } from "@sophistry/solidjs";
import { MathTransform } from "@sophistry/solidjs/text";
import type { MathTransformNode } from "@sophistry/text";
import { onSettled } from "solid-js";

/**
 * Every character present in both formulas
 * travels to its new place, the rest cross-fades. `blend` is a plain 0..1
 * track, passed as the prop itself. `ref` hands over the node (a
 * `MathTransformNode`, whose `ready()` resolves once it is typeset).
 */
export function LatexMorphDemo() {
	const blend = track(0);
	const player = usePlayer();

	let formula: MathTransformNode | undefined;
	onSettled(() => {
		void (async () => {
			try {
				await formula?.ready();
				await player.play(valueTo(blend, 1, { duration: 2 }));
				await player.play(hold(0.6));
				await player.play(valueTo(blend, 0, { duration: 2 }));
			} catch (error) {
				// `ready()` rejects with an AbortError when the formula unmounts first.
				if (!(error instanceof DOMException && error.name === "AbortError"))
					throw error;
			}
		})();
	});

	return (
		<Stage units={10}>
			<Text text="completing the square" y={2.4} />
			<MathTransform
				from="x^2 + 2x + 1"
				to="(x + 1)^2"
				blend={blend}
				ref={(node) => {
					formula = node;
				}}
				fontSize={1.1}
			/>
		</Stage>
	);
}
