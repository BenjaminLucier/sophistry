import {
	circumscribe,
	flash,
	hold,
	indicate,
	sequence,
	track,
	wiggle,
} from "@sophistry/core";
import {
	Circle,
	Dot,
	Label,
	Rect,
	Square,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Emphasis effects",
	description:
		"Four ways to draw the eye in turn: indicate swells a dot, wiggle shakes a square, flash sends out a ring, circumscribe boxes a label.",
};

export default function EmphasisEffects() {
	const { play, signal } = usePlayer();
	const scale = track(1);
	const rotation = track(0);
	const radius = track(0.4);
	const opacity = track(0);
	const drawn = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						indicate(scale, { factor: 1.6 }),
						wiggle(rotation, { amplitude: 0.3 }),
						flash(radius, opacity, { from: 0.4, to: 1.2 }),
						circumscribe(drawn),
						hold(1),
					),
				);
			}
		})();
	});

	return (
		<Stage units={12}>
			<Dot center={{ x: -4.2, y: 0 }} radius={0.5} scale={scale} />
			<Square center={{ x: -1.4, y: 0 }} size={1.2} rotation={rotation} />
			<Dot center={{ x: 1.4, y: 0 }} radius={0.15} />
			<Circle center={{ x: 1.4, y: 0 }} radius={radius} opacity={opacity} />
			<Label text="emphasis" x={4.2} fontSize={0.45} />
			<Rect
				center={{ x: 4.2, y: 0 }}
				width={3.2}
				height={1.2}
				progress={drawn}
			/>
			<Label text="indicate" x={-4.2} y={-2} />
			<Label text="wiggle" x={-1.4} y={-2} />
			<Label text="flash" x={1.4} y={-2} />
			<Label text="circumscribe" x={4.2} y={-2} />
		</Stage>
	);
}
