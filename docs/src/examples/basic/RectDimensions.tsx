import { derive, hold, sequence, track, valueTo } from "@sophistry/core";
import { DoubleArrow, Label, Rect, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Dimension annotation",
	description:
		"A double-headed arrow and a live readout measure the width of a rectangle as it stretches and shrinks.",
	uses: [
		"Stage",
		"Rect",
		"DoubleArrow",
		"Label",
		"track",
		"derive",
		"valueTo",
		"sequence",
		"hold",
		"usePlayer",
	],
};

export default function RectDimensions() {
	const { play, signal } = usePlayer();
	const width = track(2);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						valueTo(width, 6, { duration: 1.5 }),
						hold(0.8),
						valueTo(width, 2, { duration: 1.5 }),
						hold(0.8),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<Rect width={width} height={2} />
			<DoubleArrow
				from={derive(width, (w) => ({ x: -w / 2, y: -1.5 }))}
				to={derive(width, (w) => ({ x: w / 2, y: -1.5 }))}
			/>
			<Label text={derive(width, (w) => `width = ${w.toFixed(1)}`)} y={-2.1} />
		</Stage>
	);
}
