import { track, valueTo } from "@sophistry/core";
import { Integer, Stage, Text, usePlayer, Variable } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

/**
 * `value` is bound to a track that `valueTo`
 * animates; `minIntegerDigits` holds columns open so the centred counter does
 * not shimmer as it grows.
 */
export function NumbersDemo() {
	const count = track(0);
	const price = track(1);
	const player = usePlayer();

	onSettled(() => {
		void (async () => {
			await player.play(valueTo(count, 2048, { duration: 2 }));
			await player.play(valueTo(price, 9.99, { duration: 1.5 }));
		})();
	});

	return (
		<Stage units={10}>
			<Text text="bytes written" y={2.6} />
			<Integer
				value={count}
				x={0}
				y={1.5}
				fontSize={1.2}
				minIntegerDigits={4}
			/>
			<Variable label="price" value={price} y={-1.4} fontSize={0.8} />
		</Stage>
	);
}
