import { hold, track, unwrite, write } from "@sophistry/core";
import {
	Circle,
	Text,
	Polygon,
	Square,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Write and unwrite",
	description:
		"Three outlines are drawn one after another with write, held for a moment, then erased in reverse order with unwrite.",
};

export default function WriteAndErase() {
	const { play, signal } = usePlayer();
	const drawn = [track(0), track(0), track(0)];
	const caption = track("write");

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				caption.set("write");
				await play(write(drawn, { lag: 0.5, duration: 1 }));
				await play(hold(1));
				caption.set("unwrite");
				await play(unwrite(drawn, { lag: 0.5, duration: 1 }));
				await play(hold(0.6));
			}
		})();
	});

	return (
		<Stage units={10}>
			<Circle center={{ x: -3.5, y: 0 }} radius={1.2} progress={drawn[0]} />
			<Square size={2.4} progress={drawn[1]} />
			<Polygon
				center={{ x: 3.5, y: 0 }}
				radius={1.4}
				sides={3}
				progress={drawn[2]}
			/>
			<Text text={caption} y={-2.4} />
		</Stage>
	);
}
