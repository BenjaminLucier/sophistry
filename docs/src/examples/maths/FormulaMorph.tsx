import { hold, track, valueTo } from "@sophistry/core";
import { Stage, Text, usePlayer } from "@sophistry/solidjs";
import { MathTransform } from "@sophistry/solidjs/text";
import type { MathTransformNode } from "@sophistry/text";
import { onSettled } from "solid-js";

export const meta = {
	title: "Formula morph",
	description:
		"Symbols shared by two equations glide to their new places while the rest fade, so completing the square reads as algebra.",
};

export default function FormulaMorph() {
	const { play, signal } = usePlayer();
	const blend = track(0);

	let formula: MathTransformNode | undefined;
	onSettled(() => {
		void (async () => {
			// Both outlines must exist before the first blend means anything.
			// `ready()` rejects (AbortError) if the scene goes away first.
			if (
				await formula?.ready().then(
					() => false,
					() => true,
				)
			)
				return;
			while (!signal.aborted) {
				await play(hold(0.8));
				await play(valueTo(blend, 1, { duration: 2 }));
				await play(hold(1));
				await play(valueTo(blend, 0, { duration: 2 }));
			}
		})();
	});

	return (
		<Stage units={10}>
			<Text text="completing the square" y={2} />
			<MathTransform
				from="x^2 + 2x + 1"
				to="(x + 1)^2"
				blend={blend}
				ref={(f) => (formula = f)}
				fontSize={1.1}
			/>
		</Stage>
	);
}
