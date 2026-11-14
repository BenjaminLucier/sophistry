import {
	animation,
	derive,
	parallel,
	sequence,
	type Track,
	track,
	valueTo,
} from "@sophistry/core";
import { Circle, Stage, Text, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "A custom animation leaf",
	description:
		"animation({...}) builds a seekable leaf from begin and seek. This one makes a counter tick in whole numbers while a built-in valueTo slides the dot, and both obey scrubbing and composites.",
};

/** Counts `value` up by `amount` in whole steps, relative to where it starts. */
function countUp(value: Track<number>, amount: number, duration: number) {
	let from = 0;
	return animation({
		duration,
		begin: () => {
			from = value.peek();
		},
		// Pure function of t plus what begin() captured, so seeking is safe either way.
		seek: (t) => value.set(from + Math.round(amount * (t / duration))),
	});
}

export default function CustomAnimationLeaf() {
	const { play, signal } = usePlayer();
	const x = track(-3);
	const count = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				x.set(-3);
				count.set(0);
				await play(
					sequence(
						parallel(valueTo(x, 3, { duration: 2 }), countUp(count, 12, 2)),
						parallel(valueTo(x, -3, { duration: 2 }), countUp(count, 12, 2)),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<Circle
				center={derive(x, (x) => ({ x, y: 0.4 }))}
				radius={0.5}
				fill="#58c4dd"
			/>
			<Text
				text={derive(count, (count) => `ticks: ${count}`)}
				y={-1.2}
				fontSize={0.5}
			/>
		</Stage>
	);
}
