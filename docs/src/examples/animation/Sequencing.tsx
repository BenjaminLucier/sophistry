import {
	derive,
	hold,
	lagged,
	parallel,
	sequence,
	track,
	valueTo,
} from "@sophistry/core";
import { Circle, Text, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Sequencing animations",
	description:
		"The same three lifts played one after another, all together, and staggered, using sequence, parallel and lagged.",
};

const XS = [-2.5, 0, 2.5];

export default function Sequencing() {
	const { play, signal } = usePlayer();
	const ys = XS.map(() => track(-0.5));
	const caption = track("");
	const up = () => ys.map((y) => valueTo(y, 0.8, { duration: 0.6 }));
	const down = parallel(...ys.map((y) => valueTo(y, -0.5, { duration: 0.4 })));

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				caption.set("sequence: one after another");
				await play(sequence(...up(), hold(0.5), down, hold(0.5)));
				caption.set("parallel: all at once");
				await play(sequence(parallel(...up()), hold(0.5), down, hold(0.5)));
				caption.set("lagged: staggered starts");
				await play(sequence(lagged(up(), { lag: 0.2 }), hold(0.5), down));
				await play(hold(1));
			}
		})();
	});

	return (
		<Stage units={10}>
			{XS.map((x, i) => (
				<Circle center={derive(ys[i], (y) => ({ x, y }))} radius={0.6} />
			))}
			<Text text={caption} y={-2.4} />
		</Stage>
	);
}
