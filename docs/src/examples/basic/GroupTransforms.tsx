import { hold, track, valueTo } from "@sophistry/core";
import {
	Circle,
	Group,
	Line,
	Square,
	Stage,
	usePlayer,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Group transforms",
	description:
		"A Group moves, rotates and scales everything inside it at once; here two scaled copies of a small figure turn together.",
	uses: [
		"Stage",
		"Group",
		"Square",
		"Circle",
		"Line",
		"track",
		"valueTo",
		"usePlayer",
		"hold",
	],
};

function Figure() {
	return (
		<>
			<Square size={1.2} />
			<Circle center={{ x: 1.2, y: 0 }} radius={0.3} />
			<Line from={{ x: 0.6, y: 0 }} to={{ x: 0.9, y: 0 }} />
		</>
	);
}

export default function GroupTransforms() {
	const { play, signal } = usePlayer();
	const angle = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(valueTo(angle, Math.PI * 2, { duration: 4 }));
				angle.set(0);
				await play(hold(0.5));
			}
		})();
	});

	return (
		<Stage units={10}>
			<Group x={-2.8} rotation={angle}>
				<Figure />
			</Group>
			<Group x={2.3} rotation={angle} scale={1.6} opacity={0.6}>
				<Figure />
			</Group>
		</Stage>
	);
}
