import { derive, sequence, track, valueTo } from "@sophistry/core";
import { Circle, Group, Line, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Clipping a group",
	description:
		"A <Group clip> paints its children only inside a region. Here the clip's right edge follows a track, wiping a coloured copy over a grey one.",
};

const dots = Array.from({ length: 35 }, (_, i) => ({
	x: (i % 7) - 3,
	y: Math.floor(i / 7) - 2,
}));

export default function ClipWipe() {
	const { play, signal } = usePlayer();
	const edge = track(-4);
	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						valueTo(edge, 4, { duration: 2 }),
						valueTo(edge, -4, { duration: 2 }),
					),
				);
			}
		})();
	});

	const picture = (color: string) =>
		dots.map((d) => (
			<Circle center={d} radius={0.35} fill={color} stroke="none" />
		));

	return (
		<Stage units={10}>
			{picture("#8a8a8a")}
			<Group
				clip={derive(edge, (x) => ({ minX: -4, minY: -3, maxX: x, maxY: 3 }))}
			>
				{picture("#58c4dd")}
			</Group>
			<Line
				from={derive(edge, (x) => ({ x, y: -3 }))}
				to={derive(edge, (x) => ({ x, y: 3 }))}
			/>
		</Stage>
	);
}
