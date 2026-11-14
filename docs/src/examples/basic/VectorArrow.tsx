import { derive, draw, track } from "@sophistry/core";
import {
	DashedLine,
	NumberPlane,
	Stage,
	Text,
	usePlayer,
	Vector,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Vector with components",
	description:
		"A Vector grows out of the origin of a NumberPlane, then dashed lines drop to the axes to show its x and y components.",
};

export default function VectorArrow() {
	const { play } = usePlayer();
	const arrow = track(0);
	const parts = track(0);

	onSettled(() => {
		void (async () => {
			await play(draw(arrow, { duration: 1.2 }));
			await play(draw(parts, { duration: 0.8 }));
		})();
	});

	return (
		<Stage units={12}>
			<NumberPlane xRange={[-4, 4]} yRange={[-3, 3]} width={8} height={6} />
			<Vector to={{ x: 3, y: 2 }} strokeWidth={0.08} progress={arrow} />
			{/* Dropped from the tip to each axis. */}
			<DashedLine from={{ x: 3, y: 2 }} to={{ x: 3, y: 0 }} progress={parts} />
			<DashedLine from={{ x: 3, y: 2 }} to={{ x: 0, y: 2 }} progress={parts} />
			{/* Each beside its own dashed line, clear of the axes' numbers and the shaft. */}
			<Text text="x = 3" x={3.65} y={1} opacity={parts} />
			<Text text="y = 2" x={1.5} y={2.35} opacity={parts} />
			{/* Arrives with the tip it names. */}
			<Text
				text="v = (3, 2)"
				x={3.95}
				y={2.45}
				opacity={derive(arrow, (drawn) => Math.max(0, (drawn - 0.7) / 0.3))}
			/>
		</Stage>
	);
}
